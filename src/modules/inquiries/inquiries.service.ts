import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  InquiryStatus,
  Prisma,
  QuoteStatus,
  QuoteVersionStatus,
  UserRole,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { toJsonPoisha } from '../../common/money/money.js';
import {
  CreateInquiryDto,
  ListInquiriesQueryDto,
  UpdateInquiryStatusDto,
} from './dto/inquiries.dto.js';

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async createInquiry(
    dto: CreateInquiryDto,
    source: 'PUBLIC' | 'PHONE' | 'INTERNAL' = 'INTERNAL',
  ) {
    if (dto.eventTypeId) {
      const et = await this.prisma.eventType.findUnique({
        where: { id: dto.eventTypeId },
        select: { id: true },
      });
      if (!et) throw new BadRequestException('EventType not found');
    }
    if (dto.packageId) {
      const pkg = await this.prisma.package.findUnique({
        where: { id: dto.packageId },
        select: { id: true },
      });
      if (!pkg) throw new BadRequestException('Package not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const reference = await this.prisma.nextReference(tx, 'INQ');
      const created = await tx.inquiry.create({
        data: {
          reference,
          eventTypeId: dto.eventTypeId ?? null,
          packageId: dto.packageId ?? null,
          eventTitle: dto.eventTitle.trim(),
          requestedDate: dto.requestedDate
            ? new Date(`${dto.requestedDate}T00:00:00.000Z`)
            : null,
          clientName: dto.clientName.trim(),
          clientPhone: dto.clientPhone.trim(),
          clientEmail: dto.clientEmail?.trim().toLowerCase() ?? null,
          notes: dto.notes ?? null,
          metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          source,
        },
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          package: { select: { id: true, name: true, slug: true, basePricePoisha: true } },
        },
      });
      return {
        ...created,
        package: created.package
          ? {
              ...created.package,
              basePricePoisha: toJsonPoisha(created.package.basePricePoisha),
            }
          : null,
        activeQuote: null,
      };
    });

    if (source === 'PUBLIC' && this.notifications) {
      const dateStr = dto.requestedDate ? ` on ${dto.requestedDate}` : '';
      await this.notifications.notifyRoles([UserRole.OWNER, UserRole.COORDINATOR], {
        category: 'INQUIRY',
        severity: 'ACTION',
        title: `New Client Inquiry (${result.reference})`,
        body: `${result.clientName} (${result.clientPhone}) requested "${result.eventTitle}"${dateStr}.`,
        href: '/admin/inquiries',
        entityType: 'Inquiry',
        entityId: result.id,
      });
    }

    return result;
  }

  async listInquiries(query: ListInquiriesQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.InquiryWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
      requestedDate: query.requestedDate
        ? new Date(`${query.requestedDate}T00:00:00.000Z`)
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          package: { select: { id: true, name: true, slug: true, basePricePoisha: true } },
          quotes: {
            where: {
              status: { notIn: [QuoteStatus.SUPERSEDED, QuoteStatus.CANCELLED] },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              versions: {
                orderBy: { versionNumber: 'desc' },
                take: 1,
                select: {
                  id: true,
                  versionNumber: true,
                  totalPoisha: true,
                  status: true,
                },
              },
              booking: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    const serialized = items.map((inq) => {
      const { quotes, ...restInq } = inq;
      const latestQuote = quotes?.[0] ?? null;
      const latestVersion = latestQuote?.versions?.[0] ?? null;
      return {
        ...restInq,
        package: inq.package
          ? {
              ...inq.package,
              basePricePoisha: toJsonPoisha(inq.package.basePricePoisha),
            }
          : null,
        activeQuote: latestQuote
          ? {
              id: latestQuote.id,
              reference: latestQuote.reference,
              status: latestQuote.status,
              currency: latestQuote.currency,
              totalPoisha: latestVersion ? toJsonPoisha(latestVersion.totalPoisha) : null,
              versionNumber: latestVersion?.versionNumber ?? 1,
              booking: latestQuote.booking ?? null,
            }
          : null,
      };
    });

    return { data: serialized, meta: { page, limit, total } };
  }

  async getInquiry(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        package: { select: { id: true, name: true, slug: true, basePricePoisha: true } },
        quotes: {
          orderBy: { createdAt: 'desc' },
          include: {
            booking: { select: { id: true, reference: true, status: true } },
          },
        },
      },
    });
    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }
    return {
      ...inquiry,
      package: inquiry.package
        ? {
            ...inquiry.package,
            basePricePoisha: toJsonPoisha(inquiry.package.basePricePoisha),
          }
        : null,
    };
  }

  async updateStatus(id: string, dto: UpdateInquiryStatusDto) {
    const existing = await this.prisma.inquiry.findUnique({
      where: { id },
      include: {
        quotes: {
          include: { booking: { select: { id: true, reference: true, status: true } } },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Inquiry not found');
    }

    const acceptedOrBooked = existing.quotes.find(
      (q) => q.status === QuoteStatus.ACCEPTED || Boolean(q.booking),
    );
    if (
      (existing.status === InquiryStatus.CONVERTED || acceptedOrBooked) &&
      dto.status !== InquiryStatus.CONVERTED
    ) {
      throw new ConflictException(
        `Inquiry ${existing.reference} has already been converted to a booking and cannot be moved back to ${dto.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.status === InquiryStatus.CLOSED) {
        const openQuoteIds = existing.quotes
          .filter((q) => q.status === QuoteStatus.DRAFT || q.status === QuoteStatus.SENT)
          .map((q) => q.id);
        if (openQuoteIds.length > 0) {
          await tx.quoteVersion.updateMany({
            where: {
              quoteId: { in: openQuoteIds },
              status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
            },
            data: { status: QuoteVersionStatus.SUPERSEDED },
          });
          await tx.quote.updateMany({
            where: { id: { in: openQuoteIds } },
            data: { status: QuoteStatus.CANCELLED },
          });
        }
      }

      return tx.inquiry.update({
        where: { id },
        data: { status: dto.status },
      });
    });
  }
}
