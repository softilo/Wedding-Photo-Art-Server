import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  DeliverableStatus,
  PaymentType,
  ReservationStatus,
  ResourceType,
  SessionStatus,
  UserRole,
  VerificationState,
} from '../../generated/prisma/client.js';
import { formatTk } from '../../common/money/money.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export type NotificationCategory =
  | 'INQUIRY'
  | 'PAYMENT'
  | 'BOOKING'
  | 'SCHEDULE'
  | 'TASK'
  | 'DELIVERABLE';

export type NotificationSeverity = 'INFO' | 'ACTION' | 'URGENT' | 'SUCCESS';

export interface NotificationItem {
  id: string;
  recipientUserId: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface DispatchNotificationInput {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
}

interface RawNotificationRow {
  id: string;
  recipient_user_id: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly lastEscalationSync = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  private hasRawQuerySupport(): boolean {
    return (
      typeof this.prisma?.$executeRawUnsafe === 'function' &&
      typeof this.prisma?.$queryRawUnsafe === 'function'
    );
  }

  private serializeRow(row: RawNotificationRow): NotificationItem {
    return {
      id: row.id,
      recipientUserId: row.recipient_user_id,
      category: row.category as NotificationCategory,
      severity: row.severity as NotificationSeverity,
      title: row.title,
      body: row.body,
      href: row.href,
      entityType: row.entity_type,
      entityId: row.entity_id,
      isRead: row.is_read,
      readAt: row.read_at ? row.read_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  async notifyUsers(userIds: string[], input: DispatchNotificationInput): Promise<void> {
    if (!this.hasRawQuerySupport()) return;
    const uniqueIds = [...new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0))];
    if (uniqueIds.length === 0) return;

    try {
      await Promise.all(
        uniqueIds.map((recipientId) =>
          input.dedupeKey
            ? this.prisma.$executeRawUnsafe(
                `INSERT INTO "notifications" (
                  "recipient_user_id", "category", "severity", "title", "body", "href", "entity_type", "entity_id", "dedupe_key"
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT ("recipient_user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL
                DO NOTHING`,
                recipientId,
                input.category,
                input.severity,
                input.title,
                input.body,
                input.href ?? null,
                input.entityType ?? null,
                input.entityId ?? null,
                input.dedupeKey,
              )
            : this.prisma.$executeRawUnsafe(
                `INSERT INTO "notifications" (
                  "recipient_user_id", "category", "severity", "title", "body", "href", "entity_type", "entity_id"
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
                recipientId,
                input.category,
                input.severity,
                input.title,
                input.body,
                input.href ?? null,
                input.entityType ?? null,
                input.entityId ?? null,
              ),
        ),
      );
    } catch (err) {
      this.logger.warn(`Failed to dispatch notification: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  async notifyRoles(
    roles: UserRole[],
    input: DispatchNotificationInput,
    extraUserIds: string[] = [],
  ): Promise<void> {
    if (!this.hasRawQuerySupport() || typeof this.prisma?.user?.findMany !== 'function') return;
    try {
      const recipients = await this.prisma.user.findMany({
        where: { isActive: true, role: { in: roles } },
        select: { id: true },
      });
      await this.notifyUsers(
        [...recipients.map((u) => u.id), ...extraUserIds],
        input,
      );
    } catch (err) {
      this.logger.warn(`Failed role notification lookup: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /**
   * Automatically resolves actionable alerts when the underlying item is verified,
   * confirmed, scheduled, or delivered so users never get stale alerts.
   */
  async resolveByDedupeKeys(dedupeKeys: string[]): Promise<void> {
    if (!this.hasRawQuerySupport() || dedupeKeys.length === 0) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "notifications"
         SET "is_read" = true, "read_at" = COALESCE("read_at", NOW())
         WHERE "dedupe_key" = ANY($1::text[]) AND "is_read" = false`,
        dedupeKeys,
      );
    } catch (err) {
      this.logger.warn(`Failed resolving notifications by key: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  async resolveByEntity(entityType: string, entityId: string): Promise<void> {
    if (!this.hasRawQuerySupport()) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "notifications"
         SET "is_read" = true, "read_at" = COALESCE("read_at", NOW())
         WHERE "entity_type" = $1 AND "entity_id" = $2 AND "is_read" = false`,
        entityType,
        entityId,
      );
    } catch (err) {
      this.logger.warn(`Failed resolving notifications by entity: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /**
   * Computes time-sensitive operational escalations (un-scheduled confirmed bookings,
   * unstaffed shoots within 72h, overdue/due-soon deliverables, pending payments >12h)
   * using idempotent dedupe keys per recipient.
   */
  async syncEscalationsForUser(userId: string, role: UserRole): Promise<void> {
    if (!this.hasRawQuerySupport()) return;
    const nowMs = Date.now();
    const lastSync = this.lastEscalationSync.get(userId) ?? 0;
    if (nowMs - lastSync < 120_000) {
      return;
    }
    this.lastEscalationSync.set(userId, nowMs);

    const now = new Date(nowMs);
    const plus48h = new Date(nowMs + 48 * 3600_000);
    const plus72h = new Date(nowMs + 72 * 3600_000);
    const plus24h = new Date(nowMs + 24 * 3600_000);
    const minus12h = new Date(nowMs - 12 * 3600_000);
    const todayTag = now.toISOString().slice(0, 10);

    const isOpsRole = role === UserRole.OWNER || role === UserRole.COORDINATOR;
    const isFinanceRole = role === UserRole.OWNER || role === UserRole.ACCOUNTANT;

    try {
      const [
        unscheduledBookings,
        upcomingSessions,
        urgentDeliverables,
        pendingPayments,
        myShoots24h,
        myDeliverablesDue,
      ] = await Promise.all([
        isOpsRole
          ? this.prisma.booking.findMany({
              where: {
                status: BookingStatus.CONFIRMED,
                sessions: { none: { status: { not: SessionStatus.CANCELLED } } },
              },
              select: { id: true, reference: true, eventTitle: true, clientName: true },
              take: 15,
            })
          : Promise.resolve([]),
        isOpsRole
          ? this.prisma.eventSession.findMany({
              where: {
                status: SessionStatus.SCHEDULED,
                startAt: { gte: now, lte: plus72h },
                booking: { status: { not: BookingStatus.CANCELLED } },
              },
              select: {
                id: true,
                title: true,
                booking: { select: { id: true, reference: true, eventTitle: true } },
                reservations: {
                  where: { status: ReservationStatus.RESERVED },
                  select: { resource: { select: { type: true } } },
                },
              },
              take: 25,
            })
          : Promise.resolve([]),
        isOpsRole
          ? this.prisma.deliverable.findMany({
              where: {
                reviewStatus: { not: DeliverableStatus.DELIVERED },
                dueAt: { lte: plus48h },
                booking: { status: { not: BookingStatus.CANCELLED } },
              },
              select: {
                id: true,
                bookingId: true,
                label: true,
                dueAt: true,
                booking: { select: { id: true, reference: true, eventTitle: true } },
              },
              take: 20,
            })
          : Promise.resolve([]),
        isFinanceRole
          ? this.prisma.paymentEntry.findMany({
              where: {
                type: PaymentType.RECEIPT,
                verificationState: VerificationState.PENDING,
                createdAt: { lte: minus12h },
                booking: { status: { not: BookingStatus.CANCELLED } },
              },
              select: {
                id: true,
                bookingId: true,
                method: true,
                amountPoisha: true,
                currency: true,
                booking: { select: { id: true, reference: true, clientName: true } },
              },
              take: 20,
            })
          : Promise.resolve([]),
        this.prisma.eventSession.findMany({
          where: {
            status: SessionStatus.SCHEDULED,
            startAt: { gte: now, lte: plus24h },
            booking: { status: { not: BookingStatus.CANCELLED } },
            reservations: {
              some: {
                status: ReservationStatus.RESERVED,
                resource: { userId, isActive: true },
              },
            },
          },
          select: {
            id: true,
            title: true,
            location: true,
            booking: { select: { reference: true, eventTitle: true } },
          },
          take: 10,
        }),
        this.prisma.deliverable.findMany({
          where: {
            assigneeUserId: userId,
            reviewStatus: { not: DeliverableStatus.DELIVERED },
            dueAt: { lte: plus48h },
            booking: { status: { not: BookingStatus.CANCELLED } },
          },
          select: {
            id: true,
            label: true,
            dueAt: true,
            booking: { select: { reference: true, eventTitle: true } },
          },
          take: 10,
        }),
      ]);

      const batchRows: Array<{
        category: NotificationCategory;
        severity: NotificationSeverity;
        title: string;
        body: string;
        href: string;
        entity_type: string;
        entity_id: string;
        dedupe_key: string;
      }> = [];

      for (const b of unscheduledBookings) {
        batchRows.push({
          category: 'SCHEDULE',
          severity: 'ACTION',
          title: `Shoot Slot Needed (${b.reference})`,
          body: `Confirmed booking "${b.eventTitle}" for ${b.clientName} has no scheduled shoot session yet.`,
          href: `/admin/bookings/${b.id}?section=schedule`,
          entity_type: 'Booking',
          entity_id: b.id,
          dedupe_key: `BOOKING_UNSCHEDULED:${b.id}`,
        });
      }

      for (const s of upcomingSessions) {
        const crewCount = s.reservations.filter(
          (r) => r.resource?.type === ResourceType.CREW,
        ).length;
        if (crewCount === 0) {
          batchRows.push({
            category: 'SCHEDULE',
            severity: 'URGENT',
            title: `Unstaffed Shoot in <72h: ${s.title}`,
            body: `${s.booking?.reference ?? 'Session'} starts soon with 0 shoot crew reserved.`,
            href: `/admin/calendar`,
            entity_type: 'EventSession',
            entity_id: s.id,
            dedupe_key: `SESSION_UNSTAFFED:${s.id}`,
          });
        }
      }

      for (const d of urgentDeliverables) {
        const isOverdue = Boolean(d.dueAt && d.dueAt < now);
        batchRows.push({
          category: 'DELIVERABLE',
          severity: isOverdue ? 'URGENT' : 'ACTION',
          title: `${isOverdue ? 'Overdue' : 'Due Within 48h'}: ${d.label}`,
          body: `${d.booking.reference} — ${d.booking.eventTitle} needs file delivery.`,
          href: `/admin/bookings/${d.bookingId}?section=deliverables`,
          entity_type: 'Deliverable',
          entity_id: d.id,
          dedupe_key: `DELIVERABLE_DUE:${d.id}:${todayTag}`,
        });
      }

      for (const p of pendingPayments) {
        batchRows.push({
          category: 'PAYMENT',
          severity: 'ACTION',
          title: `Unverified Payment Waiting (${p.booking.reference})`,
          body: `${p.method} ${formatTk(p.amountPoisha, p.currency)} from ${p.booking.clientName} has been pending >12h.`,
          href: `/admin/bookings/${p.bookingId}`,
          entity_type: 'PaymentEntry',
          entity_id: p.id,
          dedupe_key: `PAYMENT_PENDING_REMINDER:${p.id}`,
        });
      }

      for (const s of myShoots24h) {
        batchRows.push({
          category: 'SCHEDULE',
          severity: 'ACTION',
          title: `Upcoming Shoot (<24h): ${s.title}`,
          body: `${s.booking?.reference ? `${s.booking.reference} — ` : ''}${s.location ? `${s.location}` : 'Check Crew Dispatch for schedule details.'}`,
          href: '/staff',
          entity_type: 'EventSession',
          entity_id: s.id,
          dedupe_key: `CREW_SHOOT_24H:${s.id}`,
        });
      }

      for (const d of myDeliverablesDue) {
        const isOverdue = Boolean(d.dueAt && d.dueAt < now);
        batchRows.push({
          category: 'DELIVERABLE',
          severity: isOverdue ? 'URGENT' : 'ACTION',
          title: `${isOverdue ? 'Overdue' : 'Due Soon'}: ${d.label}`,
          body: `${d.booking.reference} — ${d.booking.eventTitle}`,
          href: '/staff',
          entity_type: 'Deliverable',
          entity_id: d.id,
          dedupe_key: `MY_DELIVERABLE_DUE:${d.id}:${todayTag}`,
        });
      }

      if (batchRows.length > 0) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "notifications" (
            "recipient_user_id", "category", "severity", "title", "body", "href", "entity_type", "entity_id", "dedupe_key"
          )
          SELECT
            $1::uuid,
            x."category",
            x."severity",
            x."title",
            x."body",
            x."href",
            x."entity_type",
            x."entity_id",
            x."dedupe_key"
          FROM jsonb_to_recordset($2::jsonb) AS x(
            "category" text,
            "severity" text,
            "title" text,
            "body" text,
            "href" text,
            "entity_type" text,
            "entity_id" text,
            "dedupe_key" text
          )
          ON CONFLICT ("recipient_user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL
          DO NOTHING`,
          userId,
          JSON.stringify(batchRows),
        );
      }
    } catch (err) {
      this.logger.warn(`Failed syncing escalation alerts: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  async listForUser(
    userId: string,
    role: UserRole,
    options: { limit?: number; unreadOnly?: boolean; sync?: boolean } = {},
  ) {
    if (!this.hasRawQuerySupport()) {
      return { unreadCount: 0, urgentUnreadCount: 0, items: [] as NotificationItem[] };
    }

    if (options.sync !== false) {
      await this.syncEscalationsForUser(userId, role);
    }

    const limit = Math.min(Math.max(Number(options.limit) || 25, 1), 100);
    const unreadClause = options.unreadOnly ? 'AND "is_read" = false' : '';

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawNotificationRow[]>(
        `SELECT "id", "recipient_user_id", "category", "severity", "title", "body", "href", "entity_type", "entity_id", "is_read", "read_at", "created_at"
         FROM "notifications"
         WHERE "recipient_user_id" = $1::uuid ${unreadClause}
         ORDER BY "created_at" DESC
         LIMIT $2`,
        userId,
        limit,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total_unread: bigint | number; urgent_unread: bigint | number }>>(
        `SELECT
           COUNT(*) FILTER (WHERE "is_read" = false) AS total_unread,
           COUNT(*) FILTER (WHERE "is_read" = false AND "severity" = 'URGENT') AS urgent_unread
         FROM "notifications"
         WHERE "recipient_user_id" = $1::uuid`,
        userId,
      ),
    ]);

    return {
      unreadCount: Number(counts[0]?.total_unread ?? 0),
      urgentUnreadCount: Number(counts[0]?.urgent_unread ?? 0),
      items: rows.map((row) => this.serializeRow(row)),
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE "notifications"
       SET "is_read" = true, "read_at" = COALESCE("read_at", NOW())
       WHERE "id" = $1::uuid AND "recipient_user_id" = $2::uuid
       RETURNING "id"`,
      notificationId,
      userId,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Notification not found');
    }
    return { ok: true, id: notificationId };
  }

  async markAllAsRead(userId: string) {
    const updatedCount = await this.prisma.$executeRawUnsafe(
      `UPDATE "notifications"
       SET "is_read" = true, "read_at" = NOW()
       WHERE "recipient_user_id" = $1::uuid AND "is_read" = false`,
      userId,
    );
    return { ok: true, updatedCount: Number(updatedCount) };
  }
}
