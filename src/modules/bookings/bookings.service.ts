import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AdjustmentStatus,
  AdvancePolicyType,
  AssignmentStatus,
  BookingStatus,
  DeliverableStatus,
  InquiryStatus,
  PaymentType,
  Prisma,
  QuoteStatus,
  QuoteVersionStatus,
  ReservationStatus,
  SessionStatus,
  UserRole,
  VerificationState,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { computeRequiredAdvancePoisha, formatTk, toJsonPoisha } from '../../common/money/money.js';
import { toAgencyLocalDate } from '../../common/time/timezone.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
import { buildBookingInvoicePdf } from './invoice-pdf.js';
import { DEFAULT_STUDIO_ID, StudioService } from '../studio/studio.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  provisionDeliverablesFromQuoteAndTemplatesTx,
  QuoteDeliverableItemInput,
} from './deliverable-provisioning.js';
import {
  CancelBookingDto,
  ConfirmBookingDto,
  ListBookingsQueryDto,
} from './dto/bookings.dto.js';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly scheduleService: ScheduleService,
    private readonly studioService: StudioService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private addDaysUtc(baseDate: Date, days: number): Date {
    return new Date(baseDate.getTime() + days * 86_400_000);
  }

  private async autoProvisionOperationsTx(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      eventTypeId: string | null;
      eventDate: Date | null;
      actorId: string;
      createdSessionIds: string[];
      studioTimezone: string;
      quoteItems?: QuoteDeliverableItemInput[];
      autoProvisionDeliverables?: boolean;
      autoProvisionTasks?: boolean;
    },
  ) {
    const baseDate = params.eventDate ?? new Date();
    let createdDeliverables: Array<{ id: string }> = [];
    const createdAssignments = [];

    if (params.autoProvisionDeliverables !== false) {
      createdDeliverables = await provisionDeliverablesFromQuoteAndTemplatesTx(tx, {
        bookingId: params.bookingId,
        eventTypeId: params.eventTypeId,
        eventDate: params.eventDate,
        quoteItems: params.quoteItems,
      });
    }

    if (params.autoProvisionTasks !== false) {
      const existingAssignmentCount = await tx.assignment.count({
        where: { bookingId: params.bookingId },
      });

      if (existingAssignmentCount === 0) {
        const taskTemplates = await tx.taskTemplate.findMany({
          where: {
            isActive: true,
            eventTypeId: params.eventTypeId ?? null,
          },
          orderBy: { defaultOffsetDays: 'asc' },
        });

        if (taskTemplates.length > 0) {
          const [activeUsers, sessionCrew] = await Promise.all([
            tx.user.findMany({
              where: { isActive: true },
              select: { id: true, role: true },
              orderBy: { createdAt: 'asc' },
            }),
            params.createdSessionIds.length > 0
              ? tx.resourceReservation.findMany({
                  where: {
                    sessionId: { in: params.createdSessionIds },
                    status: ReservationStatus.RESERVED,
                    resource: { userId: { not: null } },
                  },
                  include: {
                    resource: { select: { userId: true } },
                  },
                })
              : Promise.resolve([]),
          ]);

          const activeUserIds = new Set(activeUsers.map((u) => u.id));
          const staffUser = activeUsers.find((u) => u.role === UserRole.STAFF);
          const coordinatorUser = activeUsers.find((u) => u.role === UserRole.COORDINATOR);
          const primaryCrewReservation = sessionCrew.find(
            (r) => r.resource.userId && activeUserIds.has(r.resource.userId),
          );

          const pendingAssignments = taskTemplates.map((tpl) => {
            const roleLower = tpl.roleLabel.toLowerCase();
            let assigneeUserId = params.actorId;
            let sessionId: string | null = null;

            if (tpl.defaultOffsetDays === 0 && primaryCrewReservation?.resource.userId) {
              assigneeUserId = primaryCrewReservation.resource.userId;
              sessionId = primaryCrewReservation.sessionId;
            } else if (roleLower.includes('coordinator') && coordinatorUser) {
              assigneeUserId = coordinatorUser.id;
            } else if (
              (roleLower.includes('photo') ||
                roleLower.includes('cinema') ||
                roleLower.includes('editor')) &&
              staffUser
            ) {
              assigneeUserId = staffUser.id;
            }

            if (!activeUserIds.has(assigneeUserId)) {
              assigneeUserId = params.actorId;
            }

            const targetDate = toAgencyLocalDate(
              this.addDaysUtc(baseDate, tpl.defaultOffsetDays),
              params.studioTimezone,
            );
            const offsetSign = tpl.defaultOffsetDays >= 0 ? '+' : '';
            return {
              bookingId: params.bookingId,
              sessionId,
              assigneeUserId,
              roleLabel: `${tpl.title} (${tpl.roleLabel})`,
              notes: `Auto-scheduled target: ${targetDate} (${offsetSign}${tpl.defaultOffsetDays}d)`,
            };
          });

          if (typeof tx.assignment.createManyAndReturn === 'function') {
            createdAssignments.push(
              ...(await tx.assignment.createManyAndReturn({
                data: pendingAssignments,
              })),
            );
          } else {
            createdAssignments.push(
              ...(await Promise.all(
                pendingAssignments.map((data) => tx.assignment.create({ data })),
              )),
            );
          }
        }
      }
    }

    return { createdDeliverables, createdAssignments };
  }

  async confirmBooking(bookingId: string, actorId: string, dto: ConfirmBookingDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [booking, studio] = await Promise.all([
        tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            quote: { select: { id: true, inquiryId: true } },
            acceptedQuoteVersion: {
              select: {
                id: true,
                status: true,
                items: {
                  orderBy: { sortOrder: 'asc' },
                  select: { description: true, quantity: true },
                },
              },
            },
          },
        }),
        tx.studioSettings.findUnique({
          where: { id: DEFAULT_STUDIO_ID },
          select: {
            advancePolicyType: true,
            advancePolicyValue: true,
            timezone: true,
          },
        }),
      ]);

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (dto.expectedVersion !== undefined && booking.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified by another request',
        });
      }
      if (booking.status === BookingStatus.CONFIRMED) {
        throw new ConflictException(`Booking ${booking.reference} is already confirmed.`);
      }
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(
          `Cannot confirm booking ${booking.reference} because it is already ${booking.status.toLowerCase()}.`,
        );
      }

      const policyType =
        booking.advancePolicyTypeOverride ?? studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
      const policyValue = booking.advancePolicyValueOverride ?? studio?.advancePolicyValue ?? 20n;
      const requiredAdvance = computeRequiredAdvancePoisha(
        booking.agreedTotalPoisha,
        policyType,
        policyValue,
      );

      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId, {
        booking,
        studio,
      });
      const verifiedReceipts = BigInt(ledger.verifiedReceiptsPoisha);
      const pendingReceipts = BigInt(ledger.pendingReceiptsPoisha);

      if (verifiedReceipts < requiredAdvance) {
        const pendingHint =
          pendingReceipts > 0n
            ? ` You have ${formatTk(pendingReceipts, booking.currency)} in unverified pending payments—please verify the receipt first.`
            : '';
        throw new ConflictException({
          code: 'ADVANCE_REQUIREMENT_NOT_MET',
          message: `Cannot confirm booking yet: verified advance paid (${formatTk(verifiedReceipts, booking.currency)}) is less than the required advance of ${formatTk(requiredAdvance, booking.currency)}.${pendingHint}`,
          requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
          verifiedReceiptsPoisha: ledger.verifiedReceiptsPoisha,
        });
      }

      const updateResult = await tx.booking.updateMany({
        where: { id: bookingId, version: booking.version },
        data: {
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actorId,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified concurrently',
        });
      }

      // Guarantee Inquiry -> Quote -> Booking pipeline sync on confirmation
      if (typeof tx.inquiry?.findFirst === 'function') {
        let linkedInquiryId = booking.quote?.inquiryId ?? null;
        if (!linkedInquiryId) {
          const matchingInquiry = await tx.inquiry.findFirst({
            where: {
              clientPhone: booking.clientPhone,
              eventTitle: { equals: booking.eventTitle, mode: 'insensitive' },
              status: { not: InquiryStatus.CONVERTED },
            },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          });
          if (matchingInquiry) {
            linkedInquiryId = matchingInquiry.id;
            await tx.quote.update({
              where: { id: booking.quoteId },
              data: { inquiryId: linkedInquiryId, status: QuoteStatus.ACCEPTED },
            });
          }
        }
        if (linkedInquiryId) {
          await tx.inquiry.update({
            where: { id: linkedInquiryId },
            data: { status: InquiryStatus.CONVERTED },
          });
          const siblingQuotes = await tx.quote.findMany({
            where: {
              inquiryId: linkedInquiryId,
              id: { not: booking.quoteId },
              status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT] },
            },
            select: { id: true },
          });
          const siblingIds = siblingQuotes.map((s) => s.id);
          if (siblingIds.length > 0) {
            await tx.quoteVersion.updateMany({
              where: {
                quoteId: { in: siblingIds },
                status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
              },
              data: { status: QuoteVersionStatus.SUPERSEDED },
            });
            await tx.quote.updateMany({
              where: { id: { in: siblingIds } },
              data: { status: QuoteStatus.SUPERSEDED },
            });
          }
        }
      }

      const createdSessions = [];
      if (dto.sessions && dto.sessions.length > 0) {
        for (const s of dto.sessions) {
          const startAt = new Date(s.startAt);
          const endAt = new Date(s.endAt);
          if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
            throw new BadRequestException('Invalid session startAt / endAt');
          }
          const session = await tx.eventSession.create({
            data: {
              bookingId,
              title: s.title.trim(),
              startAt,
              endAt,
              location: s.location ?? null,
              notes: s.notes ?? null,
            },
          });
          if (s.resourceIds && s.resourceIds.length > 0) {
            await this.scheduleService.reserveResourcesTx(
              tx,
              session.id,
              s.resourceIds,
              startAt,
              endAt,
            );
          }
          await tx.scheduleAuditLog.create({
            data: {
              bookingId,
              sessionId: session.id,
              action: 'SESSION_SCHEDULED_ON_CONFIRM',
              reason: s.reason?.trim() || 'Booking confirmation',
              changedById: actorId,
              newStartAt: startAt,
              newEndAt: endAt,
            },
          });
          createdSessions.push(session);
        }
      }

      const studioTimezone = studio?.timezone || 'Asia/Dhaka';
      const { createdDeliverables, createdAssignments } =
        await this.autoProvisionOperationsTx(tx, {
          bookingId,
          eventTypeId: booking.eventTypeId,
          eventDate: booking.eventDate ?? createdSessions[0]?.startAt ?? null,
          actorId,
          createdSessionIds: createdSessions.map((s) => s.id),
          studioTimezone,
          quoteItems: booking.acceptedQuoteVersion?.items ?? [],
          autoProvisionDeliverables: dto.autoProvisionDeliverables,
          autoProvisionTasks: dto.autoProvisionTasks,
        });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_CONFIRMED',
          details: {
            requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
            verifiedReceiptsPoisha: ledger.verifiedReceiptsPoisha,
            autoProvisionedDeliverables: createdDeliverables.length,
            autoProvisionedAssignments: createdAssignments.length,
          },
        },
      });

      const confirmedBooking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      return {
        booking: {
          ...confirmedBooking,
          agreedTotalPoisha: toJsonPoisha(confirmedBooking.agreedTotalPoisha),
        },
        sessions: createdSessions,
        deliverables: createdDeliverables,
        assignments: createdAssignments,
        ledger,
      };
    });

    if (this.notifications) {
      await this.notifications.resolveByDedupeKeys([`READY_TO_CONFIRM:${bookingId}`]);

      const assignedUserIds = [
        ...new Set(result.assignments.map((a) => a.assigneeUserId)),
      ];
      if (assignedUserIds.length > 0) {
        await this.notifications.notifyUsers(assignedUserIds, {
          category: 'TASK',
          severity: 'ACTION',
          title: `Confirmed Booking Tasks (${result.booking.reference})`,
          body: `You were assigned workflow tasks for "${result.booking.eventTitle}" (${result.booking.clientName}).`,
          href: '/staff',
          entityType: 'Booking',
          entityId: bookingId,
        });
      }

      if (result.sessions.length === 0) {
        await this.notifications.notifyRoles([UserRole.OWNER, UserRole.COORDINATOR], {
          category: 'SCHEDULE',
          severity: 'ACTION',
          title: `Shoot Slot Needed (${result.booking.reference})`,
          body: `"${result.booking.eventTitle}" is confirmed—schedule the shoot date and reserve crew.`,
          href: `/admin/bookings/${bookingId}?section=schedule`,
          entityType: 'Booking',
          entityId: bookingId,
          dedupeKey: `BOOKING_UNSCHEDULED:${bookingId}`,
        });
      }
    }

    return result;
  }

  async cancelBooking(bookingId: string, actorId: string, dto: CancelBookingDto) {
    const txResult = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (dto.expectedVersion !== undefined && booking.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified by another request',
        });
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ConflictException(`Booking ${booking.reference} is already cancelled.`);
      }
      if (booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(
          `Cannot cancel booking ${booking.reference} because it is already completed.`,
        );
      }

      const [existingAssignments, existingSessions] = await Promise.all([
        typeof tx.assignment?.findMany === 'function'
          ? tx.assignment.findMany({
              where: {
                bookingId,
                status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
              },
              select: { assigneeUserId: true },
            })
          : Promise.resolve([]),
        tx.eventSession.findMany({
          where: { bookingId, status: SessionStatus.SCHEDULED },
          select: {
            id: true,
            reservations: {
              where: { status: ReservationStatus.RESERVED },
              select: { resource: { select: { userId: true } } },
            },
          },
        }),
      ]);

      const affectedCrewIds = new Set<string>();
      for (const a of existingAssignments) {
        affectedCrewIds.add(a.assigneeUserId);
      }
      for (const s of existingSessions) {
        for (const r of s.reservations ?? []) {
          if (r.resource?.userId) affectedCrewIds.add(r.resource.userId);
        }
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      const sessionIds = existingSessions.map((s) => s.id);

      if (sessionIds.length > 0) {
        await tx.eventSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { status: SessionStatus.CANCELLED },
        });
        await tx.resourceReservation.updateMany({
          where: { sessionId: { in: sessionIds }, status: ReservationStatus.RESERVED },
          data: { status: ReservationStatus.RELEASED },
        });
      }

      if (typeof tx.assignment?.updateMany === 'function') {
        await tx.assignment.updateMany({
          where: {
            bookingId,
            status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
          },
          data: { status: AssignmentStatus.CANCELLED },
        });
      }

      if (typeof tx.paymentEntry?.updateMany === 'function') {
        await tx.paymentEntry.updateMany({
          where: {
            bookingId,
            type: PaymentType.RECEIPT,
            verificationState: VerificationState.PENDING,
          },
          data: {
            verificationState: VerificationState.REJECTED,
            reason: `Auto-rejected on booking cancellation: ${dto.reason.trim()}`,
          },
        });
      }

      await tx.scheduleAuditLog.create({
        data: {
          bookingId,
          action: 'BOOKING_CANCELLED',
          reason: dto.reason.trim(),
          changedById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_CANCELLED',
          details: { reason: dto.reason.trim() },
        },
      });

      return {
        booking: {
          ...updated,
          agreedTotalPoisha: toJsonPoisha(updated.agreedTotalPoisha),
        },
        affectedCrewIds: [...affectedCrewIds],
      };
    });

    if (this.notifications) {
      await this.notifications.resolveByDedupeKeys([
        `READY_TO_CONFIRM:${bookingId}`,
        `BOOKING_UNSCHEDULED:${bookingId}`,
      ]);
      await this.notifications.notifyRoles(
        [UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT],
        {
          category: 'BOOKING',
          severity: 'URGENT',
          title: `Booking Cancelled (${txResult.booking.reference})`,
          body: `"${txResult.booking.eventTitle}" (${txResult.booking.clientName}) was cancelled. Reason: ${dto.reason.trim()}.`,
          href: `/admin/bookings/${bookingId}`,
          entityType: 'Booking',
          entityId: bookingId,
        },
      );
      if (txResult.affectedCrewIds.length > 0) {
        await this.notifications.notifyUsers(txResult.affectedCrewIds, {
          category: 'SCHEDULE',
          severity: 'URGENT',
          title: `Shoot & Tasks Cancelled (${txResult.booking.reference})`,
          body: `"${txResult.booking.eventTitle}" was cancelled (${dto.reason.trim()}). Your shoot reservation has been released.`,
          href: '/staff',
          entityType: 'Booking',
          entityId: bookingId,
        });
      }
    }

    return txResult.booking;
  }

  async completeBooking(bookingId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException(
          `Only confirmed bookings can be marked as completed (current status: ${booking.status.replace(/_/g, ' ')}).`,
        );
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.COMPLETED,
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_COMPLETED',
        },
      });

      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId, {
        booking: updated,
      });
      return {
        booking: {
          ...updated,
          agreedTotalPoisha: toJsonPoisha(updated.agreedTotalPoisha),
        },
        ledger,
      };
    });
  }

  async listBookings(query: ListBookingsQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.BookingWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
      eventDate: query.eventDate ? new Date(`${query.eventDate}T00:00:00.000Z`) : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: items.map((b) => ({
        ...b,
        agreedTotalPoisha: toJsonPoisha(b.agreedTotalPoisha),
        advancePolicyValueOverride:
          b.advancePolicyValueOverride !== null
            ? toJsonPoisha(b.advancePolicyValueOverride)
            : null,
      })),
      meta: { page, limit, total },
    };
  }

  async getBooking(bookingId: string) {
    const hasDirectPrisma = typeof this.prisma.booking?.findUnique === 'function';

    if (hasDirectPrisma) {
      const studioPromise =
        typeof this.studioService?.getCachedStudioSettingsSummary === 'function'
          ? this.studioService.getCachedStudioSettingsSummary().then((s) => ({
              timezone: s.publicBranding.timezone,
              advancePolicyType: s.advancePolicyType,
              advancePolicyValue: s.advancePolicyValue,
            }))
          : this.prisma.studioSettings.findUnique({
              where: { id: DEFAULT_STUDIO_ID },
              select: {
                timezone: true,
                advancePolicyType: true,
                advancePolicyValue: true,
              },
            });

      const [booking, studio, scheduleAuditLogs, paymentEntries, priceAdjustments] =
        await Promise.all([
          this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
              eventType: { select: { id: true, name: true, slug: true } },
              quote: { select: { id: true, reference: true } },
              acceptedQuoteVersion: {
                include: {
                  items: { orderBy: { sortOrder: 'asc' } },
                },
              },
              sessions: {
                include: {
                  reservations: {
                    where: { status: ReservationStatus.RESERVED },
                    include: {
                      resource: { select: { id: true, name: true, type: true } },
                    },
                  },
                },
                orderBy: { startAt: 'asc' },
              },
              deliverables: { orderBy: { createdAt: 'asc' } },
              assignments: {
                include: {
                  assignee: { select: { id: true, name: true, email: true, role: true } },
                  session: { select: { id: true, title: true } },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          }),
          studioPromise,
          this.prisma.scheduleAuditLog.findMany({
            where: { bookingId },
            orderBy: { createdAt: 'desc' },
            take: 15,
          }),
          this.prisma.paymentEntry.findMany({
            where: { bookingId },
            select: { type: true, verificationState: true, amountPoisha: true },
          }),
          this.prisma.priceAdjustment.findMany({
            where: { bookingId, status: AdjustmentStatus.APPROVED },
            select: { type: true, amountPoisha: true },
          }),
        ]);

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (
        booking.deliverables.length === 0 &&
        booking.status !== BookingStatus.CANCELLED
      ) {
        const autoSeeded = await this.prisma.$transaction((tx) =>
          provisionDeliverablesFromQuoteAndTemplatesTx(tx, {
            bookingId: booking.id,
            eventTypeId: booking.eventTypeId,
            eventDate: booking.eventDate,
            quoteItems: booking.acceptedQuoteVersion?.items ?? [],
          }),
        );
        if (autoSeeded.length > 0) {
          booking.deliverables = autoSeeded;
        }
      }

      const studioTimezone = studio?.timezone || 'Asia/Dhaka';
      const ledger =
        typeof this.paymentsService.computeLedgerSummaryFromData === 'function'
          ? this.paymentsService.computeLedgerSummaryFromData(
              booking,
              studio,
              paymentEntries,
              priceAdjustments,
            )
          : await this.paymentsService.computeLedgerSummaryTx(
              this.prisma as unknown as Prisma.TransactionClient,
              bookingId,
            );

      const assigneeIds = [
        ...new Set(
          booking.deliverables
            .map((d) => d.assigneeUserId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const assigneeUsers =
        assigneeIds.length > 0
          ? await this.prisma.user.findMany({
              where: { id: { in: assigneeIds } },
              select: { id: true, name: true },
            })
          : [];
      const userNameMap = new Map(assigneeUsers.map((u) => [u.id, u.name]));

      return {
        ...booking,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        advancePolicyValueOverride:
          booking.advancePolicyValueOverride !== null
            ? toJsonPoisha(booking.advancePolicyValueOverride)
            : null,
        acceptedQuoteVersion: booking.acceptedQuoteVersion
          ? {
              ...booking.acceptedQuoteVersion,
              subtotalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.subtotalPoisha),
              discountPoisha: toJsonPoisha(booking.acceptedQuoteVersion.discountPoisha),
              totalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.totalPoisha),
              items: booking.acceptedQuoteVersion.items.map((item) => ({
                ...item,
                unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
                lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
              })),
            }
          : undefined,
        sessions: booking.sessions.map((s) => ({
          ...s,
          agencyLocalDate: toAgencyLocalDate(s.startAt, studioTimezone),
        })),
        deliverables: booking.deliverables.map((d) => ({
          ...d,
          assigneeName: d.assigneeUserId ? (userNameMap.get(d.assigneeUserId) ?? null) : null,
        })),
        scheduleAuditLogs,
        ledger,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const [booking, studio, scheduleAuditLogs] = await Promise.all([
        tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            eventType: { select: { id: true, name: true, slug: true } },
            quote: { select: { id: true, reference: true } },
            acceptedQuoteVersion: {
              include: {
                items: { orderBy: { sortOrder: 'asc' } },
              },
            },
            sessions: {
              include: {
                reservations: {
                  where: { status: ReservationStatus.RESERVED },
                  include: {
                    resource: { select: { id: true, name: true, type: true } },
                  },
                },
              },
              orderBy: { startAt: 'asc' },
            },
            deliverables: { orderBy: { createdAt: 'asc' } },
            assignments: {
              include: {
                assignee: { select: { id: true, name: true, email: true, role: true } },
                session: { select: { id: true, title: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        tx.studioSettings.findUnique({
          where: { id: DEFAULT_STUDIO_ID },
          select: { timezone: true },
        }),
        tx.scheduleAuditLog.findMany({
          where: { bookingId },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
      ]);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (
        booking.deliverables.length === 0 &&
        booking.status !== BookingStatus.CANCELLED
      ) {
        const autoSeeded = await provisionDeliverablesFromQuoteAndTemplatesTx(tx, {
          bookingId: booking.id,
          eventTypeId: booking.eventTypeId,
          eventDate: booking.eventDate,
          quoteItems: booking.acceptedQuoteVersion?.items ?? [],
        });
        if (autoSeeded.length > 0) {
          booking.deliverables = autoSeeded;
        }
      }

      const studioTimezone = studio?.timezone || 'Asia/Dhaka';
      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);

      const assigneeIds = [
        ...new Set(
          booking.deliverables
            .map((d) => d.assigneeUserId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const assigneeUsers =
        assigneeIds.length > 0
          ? await tx.user.findMany({
              where: { id: { in: assigneeIds } },
              select: { id: true, name: true },
            })
          : [];
      const userNameMap = new Map(assigneeUsers.map((u) => [u.id, u.name]));

      return {
        ...booking,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        advancePolicyValueOverride:
          booking.advancePolicyValueOverride !== null
            ? toJsonPoisha(booking.advancePolicyValueOverride)
            : null,
        acceptedQuoteVersion: booking.acceptedQuoteVersion
          ? {
              ...booking.acceptedQuoteVersion,
              subtotalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.subtotalPoisha),
              discountPoisha: toJsonPoisha(booking.acceptedQuoteVersion.discountPoisha),
              totalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.totalPoisha),
              items: booking.acceptedQuoteVersion.items.map((item) => ({
                ...item,
                unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
                lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
              })),
            }
          : undefined,
        sessions: booking.sessions.map((s) => ({
          ...s,
          agencyLocalDate: toAgencyLocalDate(s.startAt, studioTimezone),
        })),
        deliverables: booking.deliverables.map((d) => ({
          ...d,
          assigneeName: d.assigneeUserId ? (userNameMap.get(d.assigneeUserId) ?? null) : null,
        })),
        scheduleAuditLogs,
        ledger,
      };
    });
  }

  async getAutomationAlerts() {
    const now = new Date();
    const dueSoonCutoff = this.addDaysUtc(now, 5);

    const studioPromise =
      typeof this.studioService?.getCachedStudioSettingsSummary === 'function'
        ? this.studioService.getCachedStudioSettingsSummary().then((s) => ({
            advancePolicyType: s.advancePolicyType,
            advancePolicyValue: s.advancePolicyValue,
            timezone: s.publicBranding.timezone,
            currency: s.publicBranding.currency,
          }))
        : this.prisma.studioSettings.findUnique({
            where: { id: DEFAULT_STUDIO_ID },
            select: {
              advancePolicyType: true,
              advancePolicyValue: true,
              timezone: true,
              currency: true,
            },
          });

    const [
      studio,
      pendingPayments,
      pendingBookings,
      unscheduledConfirmedBookings,
      unassignedConfirmedBookings,
      urgentDeliverables,
    ] = await Promise.all([
      studioPromise,
      this.prisma.paymentEntry.findMany({
        where: {
          type: PaymentType.RECEIPT,
          verificationState: VerificationState.PENDING,
          booking: { status: { not: BookingStatus.CANCELLED } },
        },
        select: {
          id: true,
          bookingId: true,
          method: true,
          amountPoisha: true,
          currency: true,
          transactionRef: true,
          createdAt: true,
          booking: {
            select: { id: true, reference: true, eventTitle: true, clientName: true, status: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      }),
      this.prisma.booking.findMany({
        where: { status: BookingStatus.PENDING_CONFIRMATION },
        select: {
          id: true,
          reference: true,
          eventTitle: true,
          clientName: true,
          eventDate: true,
          agreedTotalPoisha: true,
          advancePolicyTypeOverride: true,
          advancePolicyValueOverride: true,
          paymentEntries: {
            where: {
              type: PaymentType.RECEIPT,
              verificationState: VerificationState.VERIFIED,
            },
            select: { amountPoisha: true },
          },
        },
        orderBy: { eventDate: 'asc' },
        take: 50,
      }),
      this.prisma.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          sessions: {
            none: { status: { in: [SessionStatus.SCHEDULED, SessionStatus.COMPLETED] } },
          },
        },
        select: {
          id: true,
          reference: true,
          eventTitle: true,
          clientName: true,
          eventDate: true,
        },
        orderBy: { eventDate: 'asc' },
        take: 50,
      }),
      this.prisma.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          assignments: {
            none: { status: { not: AssignmentStatus.CANCELLED } },
          },
        },
        select: {
          id: true,
          reference: true,
          eventTitle: true,
          clientName: true,
          eventDate: true,
        },
        orderBy: { eventDate: 'asc' },
        take: 50,
      }),
      this.prisma.deliverable.findMany({
        where: {
          reviewStatus: { not: DeliverableStatus.DELIVERED },
          dueAt: { lte: dueSoonCutoff },
          booking: { status: { not: BookingStatus.CANCELLED } },
        },
        select: {
          id: true,
          bookingId: true,
          label: true,
          dueAt: true,
          reviewStatus: true,
          booking: {
            select: { id: true, reference: true, eventTitle: true, clientName: true, status: true },
          },
        },
        orderBy: { dueAt: 'asc' },
        take: 25,
      }),
    ]);

    const readyToConfirmBookings: Array<{
      id: string;
      reference: string;
      eventTitle: string;
      clientName: string;
      eventDate: Date | null;
      agreedTotalPoisha: number;
      verifiedReceiptsPoisha: number;
      requiredAdvancePoisha: number;
    }> = [];
    const awaitingAdvanceBookings: typeof readyToConfirmBookings = [];

    for (const b of pendingBookings) {
      const policyType =
        b.advancePolicyTypeOverride ?? studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
      const policyValue = b.advancePolicyValueOverride ?? studio?.advancePolicyValue ?? 20n;
      const required = computeRequiredAdvancePoisha(b.agreedTotalPoisha, policyType, policyValue);
      const verified = b.paymentEntries.reduce((sum, p) => sum + p.amountPoisha, 0n);

      const item = {
        id: b.id,
        reference: b.reference,
        eventTitle: b.eventTitle,
        clientName: b.clientName,
        eventDate: b.eventDate,
        agreedTotalPoisha: toJsonPoisha(b.agreedTotalPoisha),
        verifiedReceiptsPoisha: toJsonPoisha(verified),
        requiredAdvancePoisha: toJsonPoisha(required),
      };

      if (verified >= required) {
        readyToConfirmBookings.push(item);
      } else {
        awaitingAdvanceBookings.push(item);
      }
    }

    const serializedPendingPayments = pendingPayments.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      method: p.method,
      amountPoisha: toJsonPoisha(p.amountPoisha),
      currency: p.currency,
      transactionRef: p.transactionRef,
      createdAt: p.createdAt,
      booking: p.booking,
    }));

    const activeDeliverables = urgentDeliverables.map((d) => ({
      id: d.id,
      bookingId: d.bookingId,
      label: d.label,
      dueAt: d.dueAt,
      reviewStatus: d.reviewStatus,
      isOverdue: Boolean(d.dueAt && d.dueAt < now),
      booking: {
        id: d.booking.id,
        reference: d.booking.reference,
        eventTitle: d.booking.eventTitle,
        clientName: d.booking.clientName,
      },
    }));

    return {
      currency: studio?.currency || 'BDT',
      timezone: studio?.timezone || 'Asia/Dhaka',
      pendingPayments: serializedPendingPayments,
      readyToConfirmBookings,
      awaitingAdvanceBookings,
      unscheduledConfirmedBookings,
      unassignedConfirmedBookings,
      urgentDeliverables: activeDeliverables,
      counts: {
        pendingPayments: serializedPendingPayments.length,
        readyToConfirm: readyToConfirmBookings.length,
        awaitingAdvance: awaitingAdvanceBookings.length,
        unscheduledConfirmed: unscheduledConfirmedBookings.length,
        unassignedConfirmed: unassignedConfirmedBookings.length,
        urgentDeliverables: activeDeliverables.length,
      },
    };
  }

  async getBookingReceipt(bookingId: string) {
    const hasDirectPrisma = typeof this.prisma.booking?.findUnique === 'function';

    let studio: Awaited<ReturnType<StudioService['getPublicBranding']>>;
    let booking;
    let ledger;

    if (hasDirectPrisma) {
      const studioPromise =
        typeof this.studioService?.getCachedStudioSettingsSummary === 'function'
          ? this.studioService.getCachedStudioSettingsSummary()
          : null;

      const [studioSummary, brandingFallback, fetchedBooking, allPayments, approvedAdjustments] =
        await Promise.all([
          studioPromise,
          studioPromise ? Promise.resolve(null) : this.studioService.getPublicBranding(),
          this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
              eventType: { select: { id: true, name: true } },
              quote: { select: { id: true, reference: true } },
              acceptedQuoteVersion: {
                include: { items: { orderBy: { sortOrder: 'asc' } } },
              },
            },
          }),
          this.prisma.paymentEntry.findMany({
            where: { bookingId },
            orderBy: { createdAt: 'asc' },
          }),
          this.prisma.priceAdjustment.findMany({
            where: { bookingId, status: AdjustmentStatus.APPROVED },
            orderBy: { createdAt: 'asc' },
          }),
        ]);

      if (!fetchedBooking) {
        throw new NotFoundException('Booking not found');
      }

      studio = studioSummary?.publicBranding ?? brandingFallback!;
      const policy = studioSummary
        ? {
            advancePolicyType: studioSummary.advancePolicyType,
            advancePolicyValue: studioSummary.advancePolicyValue,
          }
        : null;

      ledger =
        typeof this.paymentsService.computeLedgerSummaryFromData === 'function'
          ? this.paymentsService.computeLedgerSummaryFromData(
              fetchedBooking,
              policy,
              allPayments,
              approvedAdjustments,
            )
          : await this.paymentsService.computeLedgerSummaryTx(
              this.prisma as unknown as Prisma.TransactionClient,
              bookingId,
            );

      booking = {
        ...fetchedBooking,
        paymentEntries: allPayments.filter(
          (p) => p.verificationState === VerificationState.VERIFIED,
        ),
        priceAdjustments: approvedAdjustments,
      };
    } else {
      const [fetchedStudio, receiptData] = await Promise.all([
        this.studioService.getPublicBranding(),
        this.prisma.$transaction(async (tx) => {
          const b = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
              eventType: { select: { id: true, name: true } },
              quote: { select: { id: true, reference: true } },
              acceptedQuoteVersion: {
                include: { items: { orderBy: { sortOrder: 'asc' } } },
              },
              paymentEntries: {
                where: { verificationState: VerificationState.VERIFIED },
                orderBy: { createdAt: 'asc' },
              },
              priceAdjustments: {
                where: { status: AdjustmentStatus.APPROVED },
                orderBy: { createdAt: 'asc' },
              },
            },
          });
          if (!b) {
            throw new NotFoundException('Booking not found');
          }
          const l = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);
          return { booking: b, ledger: l };
        }),
      ]);
      studio = fetchedStudio;
      booking = receiptData.booking;
      ledger = receiptData.ledger;
    }
    return {
      studio,
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        eventTitle: booking.eventTitle,
        eventTypeName: booking.eventType?.name ?? null,
        eventDate: booking.eventDate,
        clientName: booking.clientName,
        clientPhone: booking.clientPhone,
        clientEmail: booking.clientEmail,
        currency: booking.currency,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        confirmedAt: booking.confirmedAt,
        createdAt: booking.createdAt,
      },
      quote: {
        reference: booking.quote.reference,
        versionNumber: booking.acceptedQuoteVersion.versionNumber,
        acceptedAt: booking.acceptedQuoteVersion.acceptedAt,
        acceptedBy: booking.acceptedQuoteVersion.acceptedBy,
        acceptedChannel: booking.acceptedQuoteVersion.acceptedChannel,
        terms: booking.acceptedQuoteVersion.terms,
        subtotalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.subtotalPoisha),
        discountPoisha: toJsonPoisha(booking.acceptedQuoteVersion.discountPoisha),
        totalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.totalPoisha),
        items: booking.acceptedQuoteVersion.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
          lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
        })),
      },
      ledger,
      payments: booking.paymentEntries.map((p) => ({
        id: p.id,
        type: p.type,
        method: p.method,
        amountPoisha: toJsonPoisha(p.amountPoisha),
        currency: p.currency,
        transactionRef: p.transactionRef,
        verifiedAt: p.verifiedAt,
        reason: p.reason,
        createdAt: p.createdAt,
      })),
      adjustments: booking.priceAdjustments.map((a) => ({
        id: a.id,
        type: a.type,
        amountPoisha: toJsonPoisha(a.amountPoisha),
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async getBookingInvoicePdf(bookingId: string): Promise<{ filename: string; buffer: Buffer }> {
    const receipt = await this.getBookingReceipt(bookingId);
    const buffer = await buildBookingInvoicePdf(receipt);
    const safeReference = receipt.booking.reference.replace(/[^a-zA-Z0-9_-]/g, '-');
    return {
      filename: `invoice-${safeReference}.pdf`,
      buffer,
    };
  }
}
