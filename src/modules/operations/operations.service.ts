import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AssignmentStatus,
  BookingStatus,
  DeliverableStatus,
  ReservationStatus,
  ResourceType,
  SessionStatus,
  UserRole,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { provisionDeliverablesFromQuoteAndTemplatesTx } from '../bookings/deliverable-provisioning.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateAssignmentDto,
  CreateDeliverableDto,
  DeliverDeliverableDto,
  UpdateAssignmentDto,
  UpdateDeliverableDto,
} from './dto/operations.dto.js';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new BadRequestException('Assignee is not an active team member');
    }
  }

  async createAssignment(bookingId: string, dto: CreateAssignmentDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, reference: true, status: true, eventTitle: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new ConflictException(
        `Cannot assign new crew tasks to booking ${booking.reference} because it is already ${booking.status.toLowerCase()}.`,
      );
    }
    if (dto.sessionId) {
      const session = await this.prisma.eventSession.findFirst({
        where: { id: dto.sessionId, bookingId },
        select: { id: true },
      });
      if (!session) {
        throw new BadRequestException('Session does not belong to this booking');
      }
    }
    await this.assertActiveUser(dto.assigneeUserId);

    const created = await this.prisma.assignment.create({
      data: {
        bookingId,
        sessionId: dto.sessionId ?? null,
        assigneeUserId: dto.assigneeUserId,
        roleLabel: dto.roleLabel.trim(),
        notes: dto.notes ?? null,
      },
    });

    if (this.notifications) {
      await this.notifications.notifyUsers([dto.assigneeUserId], {
        category: 'TASK',
        severity: 'ACTION',
        title: `New Crew Task: ${created.roleLabel}`,
        body: `Assigned on ${booking.reference} — ${booking.eventTitle}.`,
        href: '/staff',
        entityType: 'Assignment',
        entityId: created.id,
      });
    }

    return created;
  }

  async listMyAssignments(userId: string) {
    return this.prisma.assignment.findMany({
      where: { assigneeUserId: userId },
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            eventTitle: true,
            eventDate: true,
            clientName: true,
            clientPhone: true,
            status: true,
          },
        },
        session: {
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            location: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getMyCrewWorkspace(userId: string) {
    const [assignments, upcomingShoots] = await Promise.all([
      this.listMyAssignments(userId),
      this.prisma.eventSession.findMany({
        where: {
          status: { not: SessionStatus.CANCELLED },
          reservations: {
            some: {
              status: ReservationStatus.RESERVED,
              resource: { userId, isActive: true },
            },
          },
        },
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              eventTitle: true,
              eventDate: true,
              clientName: true,
              clientPhone: true,
              status: true,
            },
          },
          reservations: {
            where: { status: ReservationStatus.RESERVED },
            include: {
              resource: { select: { id: true, name: true, type: true, userId: true } },
            },
          },
        },
        orderBy: { startAt: 'asc' },
        take: 100,
      }),
    ]);

    return { assignments, upcomingShoots };
  }

  async getStudioDispatch() {
    const [assignments, upcomingSessions, members] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { status: { not: AssignmentStatus.CANCELLED } },
        include: {
          assignee: {
            select: { id: true, name: true, email: true, role: true },
          },
          booking: {
            select: {
              id: true,
              reference: true,
              eventTitle: true,
              eventDate: true,
              clientName: true,
              clientPhone: true,
              status: true,
            },
          },
          session: {
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              location: true,
              status: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 80,
      }),
      this.prisma.eventSession.findMany({
        where: {
          status: SessionStatus.SCHEDULED,
          booking: { status: { not: BookingStatus.CANCELLED } },
        },
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              eventTitle: true,
              eventDate: true,
              clientName: true,
              clientPhone: true,
              status: true,
            },
          },
          reservations: {
            where: { status: ReservationStatus.RESERVED },
            include: {
              resource: { select: { id: true, name: true, type: true, userId: true } },
            },
          },
        },
        orderBy: { startAt: 'asc' },
        take: 60,
      }),
      this.prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          resources: {
            where: { isActive: true, type: ResourceType.CREW },
            select: { id: true, name: true, type: true, userId: true },
          },
          assignments: {
            where: { status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] } },
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      assignments,
      upcomingSessions,
      crewSummary: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        crewResources: m.resources,
        openTasksCount: m.assignments.length,
        upcomingShootsCount: upcomingSessions.filter((s) =>
          s.reservations.some((r) => r.resource?.userId === m.id),
        ).length,
      })),
    };
  }

  async updateAssignment(
    assignmentId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: UpdateAssignmentDto,
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: { select: { reference: true, eventTitle: true } },
        assignee: { select: { name: true } },
      },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (actorRole === UserRole.STAFF && assignment.assigneeUserId !== actorUserId) {
      throw new ForbiddenException('Staff can only update their own assignments');
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        status: dto.status,
        notes: dto.notes,
      },
    });

    if (
      this.notifications &&
      dto.status === AssignmentStatus.COMPLETED &&
      assignment.status !== AssignmentStatus.COMPLETED &&
      actorRole === UserRole.STAFF
    ) {
      await this.notifications.notifyRoles([UserRole.OWNER, UserRole.COORDINATOR], {
        category: 'TASK',
        severity: 'SUCCESS',
        title: `Task Completed: ${assignment.roleLabel}`,
        body: `${assignment.assignee?.name ?? 'Crew member'} marked "${assignment.roleLabel}" complete for ${assignment.booking?.reference ?? 'booking'}.`,
        href: `/admin/bookings/${assignment.bookingId}?section=tasks`,
        entityType: 'Assignment',
        entityId: assignment.id,
      });
    }

    return updated;
  }

  async createDeliverable(bookingId: string, dto: CreateDeliverableDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, reference: true, status: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
      throw new ConflictException(
        `Cannot add new deliverables to booking ${booking.reference} because it is already ${booking.status.toLowerCase()}.`,
      );
    }
    if (dto.assigneeUserId) {
      await this.assertActiveUser(dto.assigneeUserId);
    }

    return this.prisma.deliverable.create({
      data: {
        bookingId,
        label: dto.label.trim(),
        assigneeUserId: dto.assigneeUserId ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        notes: dto.notes ?? null,
      },
    });
  }

  async listBookingDeliverables(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return this.prisma.deliverable.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateDeliverable(
    deliverableId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: UpdateDeliverableDto,
  ) {
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        booking: { select: { reference: true, eventTitle: true } },
      },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found');
    }
    if (actorRole === UserRole.STAFF && deliverable.assigneeUserId !== actorUserId) {
      throw new ForbiddenException('Staff can only update deliverables assigned to them');
    }
    if (dto.assigneeUserId) {
      await this.assertActiveUser(dto.assigneeUserId);
    }

    const updated = await this.prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        assigneeUserId: dto.assigneeUserId,
        dueAt: dto.dueAt === null ? null : dto.dueAt ? new Date(dto.dueAt) : undefined,
        reviewStatus: dto.reviewStatus,
        notes: dto.notes,
      },
    });

    if (this.notifications) {
      const targetUserId = dto.assigneeUserId ?? deliverable.assigneeUserId;
      if (dto.reviewStatus === DeliverableStatus.CHANGES_REQUESTED && targetUserId) {
        await this.notifications.notifyUsers([targetUserId], {
          category: 'DELIVERABLE',
          severity: 'URGENT',
          title: `Changes Requested: ${deliverable.label}`,
          body: `${deliverable.booking.reference} — ${deliverable.booking.eventTitle} requires edits before final delivery.`,
          href: '/staff',
          entityType: 'Deliverable',
          entityId: deliverable.id,
        });
      } else if (
        dto.assigneeUserId &&
        dto.assigneeUserId !== deliverable.assigneeUserId
      ) {
        await this.notifications.notifyUsers([dto.assigneeUserId], {
          category: 'DELIVERABLE',
          severity: 'INFO',
          title: `Deliverable Assigned: ${deliverable.label}`,
          body: `You are now owner of "${deliverable.label}" on ${deliverable.booking.reference}.`,
          href: '/staff',
          entityType: 'Deliverable',
          entityId: deliverable.id,
        });
      }
    }

    return updated;
  }

  async deliverDeliverable(
    deliverableId: string,
    actorUserId: string,
    dto: DeliverDeliverableDto,
  ) {
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.deliverable.update({
        where: { id: deliverableId },
        data: {
          reviewStatus: DeliverableStatus.DELIVERED,
          deliveredAt: new Date(),
          deliveryUrl: dto.deliveryUrl?.trim() ?? deliverable.deliveryUrl,
          notes: dto.notes ?? deliverable.notes,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          entityType: 'Deliverable',
          entityId: saved.id,
          action: 'DELIVERABLE_DELIVERED',
          details: {
            bookingId: saved.bookingId,
            label: saved.label,
          },
        },
      });

      return saved;
    });

    if (this.notifications) {
      await this.notifications.resolveByEntity('Deliverable', deliverableId);
    }

    return updated;
  }

  async syncDeliverablesFromQuote(bookingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          acceptedQuoteVersion: {
            include: {
              items: {
                orderBy: { sortOrder: 'asc' },
                select: { description: true, quantity: true },
              },
            },
          },
        },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(
          `Cannot sync deliverables for booking ${booking.reference} because it is already ${booking.status.toLowerCase()}.`,
        );
      }

      const created = await provisionDeliverablesFromQuoteAndTemplatesTx(tx, {
        bookingId: booking.id,
        eventTypeId: booking.eventTypeId,
        eventDate: booking.eventDate,
        quoteItems: booking.acceptedQuoteVersion?.items ?? [],
      });

      const deliverables = await tx.deliverable.findMany({
        where: { bookingId },
        orderBy: { createdAt: 'asc' },
      });

      return {
        createdCount: created.length,
        deliverables,
      };
    });
  }

  async deleteDeliverable(deliverableId: string) {
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        booking: { select: { id: true, reference: true, status: true } },
      },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found');
    }
    if (
      deliverable.booking.status === BookingStatus.CANCELLED ||
      deliverable.booking.status === BookingStatus.COMPLETED
    ) {
      throw new ConflictException(
        `Cannot remove deliverable from booking ${deliverable.booking.reference} because it is already ${deliverable.booking.status.toLowerCase()}.`,
      );
    }
    if (deliverable.reviewStatus === DeliverableStatus.DELIVERED) {
      throw new ConflictException('Delivered items cannot be removed.');
    }

    await this.prisma.deliverable.delete({
      where: { id: deliverableId },
    });

    return { deleted: true, id: deliverableId };
  }
}
