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
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { formatTk, sumPoisha, toJsonPoisha, toPoisha } from '../../common/money/money.js';
import { SOFTILO_DEFAULT_BRANDING } from '../../common/branding/branding-defaults.js';
import { StudioService } from '../studio/studio.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { provisionDeliverablesFromQuoteAndTemplatesTx } from '../bookings/deliverable-provisioning.js';
import { buildQuoteProposalPdf } from './quote-pdf.js';
import {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteVersionDto,
  ListQuotesQueryDto,
  QuoteLineItemInputDto,
} from './dto/quotes.dto.js';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly studioService?: StudioService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private computeTotals(items: QuoteLineItemInputDto[], discountInput = 0) {
    const computedItems = items.map((item, idx) => {
      const unitPrice = toPoisha(item.unitPricePoisha);
      const quantity = BigInt(item.quantity);
      const lineTotal = unitPrice * quantity;
      return {
        packageId: item.packageId ?? null,
        serviceItemId: item.serviceItemId ?? null,
        description: item.description.trim(),
        quantity: item.quantity,
        unitPricePoisha: unitPrice,
        lineTotalPoisha: lineTotal,
        sortOrder: idx,
      };
    });

    const subtotalPoisha = sumPoisha(computedItems.map((i) => i.lineTotalPoisha));
    const discountPoisha = toPoisha(discountInput);
    if (subtotalPoisha <= 0n) {
      throw new BadRequestException('Quote subtotal must be greater than Tk 0.');
    }
    if (discountPoisha > subtotalPoisha) {
      throw new BadRequestException(
        `Discount (${formatTk(discountPoisha)}) cannot exceed quote subtotal (${formatTk(subtotalPoisha)}).`,
      );
    }
    const totalPoisha = subtotalPoisha - discountPoisha;
    if (totalPoisha <= 0n) {
      throw new BadRequestException(
        `Quote final total must be greater than Tk 0 (Subtotal: ${formatTk(subtotalPoisha)}, Discount: ${formatTk(discountPoisha)}).`,
      );
    }

    return { computedItems, subtotalPoisha, discountPoisha, totalPoisha };
  }

  private async validateItemReferences(items: QuoteLineItemInputDto[]) {
    const packageIds = [
      ...new Set(items.map((i) => i.packageId).filter((id): id is string => Boolean(id))),
    ];
    if (packageIds.length > 0) {
      const count = await this.prisma.package.count({
        where: { id: { in: packageIds } },
      });
      if (count !== packageIds.length) {
        throw new BadRequestException('One or more packages do not exist');
      }
    }

    const serviceIds = [
      ...new Set(items.map((i) => i.serviceItemId).filter((id): id is string => Boolean(id))),
    ];
    if (serviceIds.length > 0) {
      const count = await this.prisma.serviceItem.count({
        where: { id: { in: serviceIds } },
      });
      if (count !== serviceIds.length) {
        throw new BadRequestException('One or more service items do not exist');
      }
    }
  }

  private serializeVersion(v: {
    id: string;
    quoteId: string;
    versionNumber: number;
    subtotalPoisha: bigint;
    discountPoisha: bigint;
    totalPoisha: bigint;
    terms: string | null;
    validUntil: Date | null;
    status: QuoteVersionStatus;
    acceptedAt: Date | null;
    acceptedBy: string | null;
    acceptedChannel: string | null;
    createdAt: Date;
    items?: Array<{
      id: string;
      packageId: string | null;
      serviceItemId: string | null;
      description: string;
      quantity: number;
      unitPricePoisha: bigint;
      lineTotalPoisha: bigint;
      sortOrder: number;
    }>;
  }) {
    return {
      id: v.id,
      quoteId: v.quoteId,
      versionNumber: v.versionNumber,
      subtotalPoisha: toJsonPoisha(v.subtotalPoisha),
      discountPoisha: toJsonPoisha(v.discountPoisha),
      totalPoisha: toJsonPoisha(v.totalPoisha),
      terms: v.terms,
      validUntil: v.validUntil,
      status: v.status,
      acceptedAt: v.acceptedAt,
      acceptedBy: v.acceptedBy,
      acceptedChannel: v.acceptedChannel,
      createdAt: v.createdAt,
      items: v.items?.map((item) => ({
        id: item.id,
        packageId: item.packageId,
        serviceItemId: item.serviceItemId,
        description: item.description,
        quantity: item.quantity,
        unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
        lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
        sortOrder: item.sortOrder,
      })),
    };
  }

  async createQuote(currency: string, dto: CreateQuoteDto) {
    if (!dto.eventTitle?.trim() || !dto.clientName?.trim() || !dto.clientPhone?.trim()) {
      throw new BadRequestException('Event title, client name, and client phone are required.');
    }

    let resolvedEventTypeId = dto.eventTypeId ?? null;
    let resolvedInquiryId = dto.inquiryId ?? null;

    if (!resolvedInquiryId && typeof this.prisma.inquiry?.findFirst === 'function') {
      const matchingInquiry = await this.prisma.inquiry.findFirst({
        where: {
          clientPhone: dto.clientPhone.trim(),
          eventTitle: { equals: dto.eventTitle.trim(), mode: 'insensitive' },
          status: { in: [InquiryStatus.NEW, InquiryStatus.QUALIFIED, InquiryStatus.QUOTED] },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (matchingInquiry) {
        resolvedInquiryId = matchingInquiry.id;
      }
    }

    if (resolvedInquiryId) {
      const inquiry = await this.prisma.inquiry.findUnique({
        where: { id: resolvedInquiryId },
        select: {
          id: true,
          reference: true,
          status: true,
          eventTypeId: true,
          packageId: true,
          quotes: {
            where: { status: QuoteStatus.ACCEPTED },
            select: {
              id: true,
              reference: true,
              booking: { select: { id: true, reference: true, status: true } },
            },
            take: 1,
          },
        },
      });
      if (!inquiry) {
        throw new BadRequestException('Inquiry not found');
      }
      if (inquiry.status === InquiryStatus.CLOSED) {
        throw new ConflictException(
          `Inquiry ${inquiry.reference} is closed and cannot be quoted.`,
        );
      }
      const acceptedQuote = inquiry.quotes[0];
      const existingBooking = acceptedQuote?.booking;
      if (inquiry.status === InquiryStatus.CONVERTED || acceptedQuote) {
        throw new ConflictException(
          existingBooking
            ? `Inquiry ${inquiry.reference} is already converted to booking ${existingBooking.reference} (${existingBooking.status.replace(/_/g, ' ')}) and cannot be quoted again.`
            : `Inquiry ${inquiry.reference} already has an accepted quote and cannot be quoted again.`,
        );
      }
      if (!resolvedEventTypeId && inquiry.eventTypeId) {
        resolvedEventTypeId = inquiry.eventTypeId;
      } else if (!resolvedEventTypeId && inquiry.packageId) {
        const pkg = await this.prisma.package.findUnique({
          where: { id: inquiry.packageId },
          select: { eventTypeId: true },
        });
        resolvedEventTypeId = pkg?.eventTypeId ?? null;
      }
    }
    if (dto.eventTypeId) {
      const et = await this.prisma.eventType.findUnique({
        where: { id: dto.eventTypeId },
        select: { id: true },
      });
      if (!et) {
        throw new BadRequestException('EventType not found');
      }
    } else if (!resolvedEventTypeId) {
      const firstPkgId = dto.items.find((i) => Boolean(i.packageId))?.packageId;
      if (firstPkgId) {
        const pkg = await this.prisma.package.findUnique({
          where: { id: firstPkgId },
          select: { eventTypeId: true },
        });
        resolvedEventTypeId = pkg?.eventTypeId ?? null;
      }
    }

    await this.validateItemReferences(dto.items);
    const { computedItems, subtotalPoisha, discountPoisha, totalPoisha } = this.computeTotals(
      dto.items,
      dto.discountPoisha ?? 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      if (resolvedInquiryId) {
        const previousOpenQuotes = await tx.quote.findMany({
          where: {
            inquiryId: resolvedInquiryId,
            status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT] },
          },
          select: { id: true },
        });
        const prevIds = previousOpenQuotes.map((q) => q.id);
        if (prevIds.length > 0) {
          await tx.quoteVersion.updateMany({
            where: {
              quoteId: { in: prevIds },
              status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
            },
            data: { status: QuoteVersionStatus.SUPERSEDED },
          });
          await tx.quote.updateMany({
            where: { id: { in: prevIds } },
            data: { status: QuoteStatus.SUPERSEDED },
          });
        }
      }

      const reference = await this.prisma.nextReference(tx, 'QUO');
      const quote = await tx.quote.create({
        data: {
          inquiryId: resolvedInquiryId,
          reference,
          eventTypeId: resolvedEventTypeId,
          eventTitle: dto.eventTitle.trim(),
          requestedDate: dto.requestedDate
            ? new Date(`${dto.requestedDate}T00:00:00.000Z`)
            : null,
          clientName: dto.clientName.trim(),
          clientPhone: dto.clientPhone.trim(),
          clientEmail: dto.clientEmail?.trim().toLowerCase() ?? null,
          currency,
          status: QuoteStatus.DRAFT,
        },
      });

      const version = await tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          versionNumber: 1,
          subtotalPoisha,
          discountPoisha,
          totalPoisha,
          terms: dto.terms ?? null,
          validUntil: dto.validUntil ? new Date(`${dto.validUntil}T00:00:00.000Z`) : null,
          status: QuoteVersionStatus.DRAFT,
          items: {
            create: computedItems,
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      const updatedQuote = await tx.quote.update({
        where: { id: quote.id },
        data: { currentVersionId: version.id },
      });

      if (resolvedInquiryId) {
        await tx.inquiry.update({
          where: { id: resolvedInquiryId },
          data: { status: InquiryStatus.QUOTED },
        });
      }

      return { quote: updatedQuote, version };
    });

    const serializedVersion = this.serializeVersion(created.version);
    return {
      ...created.quote,
      currentVersion: serializedVersion,
      versions: [serializedVersion],
    };
  }

  async createVersion(quoteId: string, dto: CreateQuoteVersionDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        booking: { select: { id: true, reference: true, status: true } },
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.ACCEPTED || quote.booking) {
      throw new ConflictException(
        quote.booking
          ? `Quote ${quote.reference} is already linked to booking ${quote.booking.reference} (${quote.booking.status.replace(/_/g, ' ')}) and cannot be revised.`
          : `Quote ${quote.reference} has already been accepted and cannot be revised.`,
      );
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new ConflictException(`Cannot revise quote ${quote.reference} because it is ${quote.status.toLowerCase()}.`);
    }

    await this.validateItemReferences(dto.items);
    const { computedItems, subtotalPoisha, discountPoisha, totalPoisha } = this.computeTotals(
      dto.items,
      dto.discountPoisha ?? 0,
    );

    const nextVersionNumber = (quote.versions[0]?.versionNumber ?? 0) + 1;

    const version = await this.prisma.$transaction(async (tx) => {
      // Mark prior DRAFT/SENT versions as SUPERSEDED (keep ACCEPTED untouched for history)
      await tx.quoteVersion.updateMany({
        where: {
          quoteId,
          status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
        },
        data: { status: QuoteVersionStatus.SUPERSEDED },
      });

      const createdVersion = await tx.quoteVersion.create({
        data: {
          quoteId,
          versionNumber: nextVersionNumber,
          subtotalPoisha,
          discountPoisha,
          totalPoisha,
          terms: dto.terms ?? null,
          validUntil: dto.validUntil ? new Date(`${dto.validUntil}T00:00:00.000Z`) : null,
          status: QuoteVersionStatus.DRAFT,
          items: {
            create: computedItems,
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          currentVersionId: createdVersion.id,
          status: quote.status === QuoteStatus.ACCEPTED ? QuoteStatus.ACCEPTED : QuoteStatus.DRAFT,
        },
      });

      return createdVersion;
    });

    return this.serializeVersion(version);
  }

  async sendQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { booking: { select: { reference: true, status: true } } },
    });
    if (!quote || !quote.currentVersionId) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.ACCEPTED || quote.booking) {
      throw new ConflictException(
        `Quote ${quote.reference} has already been accepted${quote.booking ? ` for booking ${quote.booking.reference}` : ''} and cannot be sent again.`,
      );
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new ConflictException(
        `Cannot send quote ${quote.reference} because it is ${quote.status.toLowerCase()}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.quoteVersion.update({
        where: { id: quote.currentVersionId! },
        data: { status: QuoteVersionStatus.SENT },
      });
      return tx.quote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.SENT },
      });
    });
  }

  async acceptQuote(quoteId: string, actorUserId: string, dto: AcceptQuoteDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.ACCEPTED || quote.booking) {
      throw new ConflictException(
        `Quote ${quote.reference} has already been accepted${quote.booking ? ` for booking ${quote.booking.reference} (${quote.booking.status.replace(/_/g, ' ')})` : ''}.`,
      );
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new ConflictException(
        `Cannot accept quote ${quote.reference} because it is ${quote.status.toLowerCase()}.`,
      );
    }

    const targetVersionId = dto.versionId ?? quote.currentVersionId;
    if (!targetVersionId) {
      throw new BadRequestException('No quote version available to accept');
    }

    const version = await this.prisma.quoteVersion.findFirst({
      where: { id: targetVersionId, quoteId },
    });
    if (!version) {
      throw new NotFoundException('Quote version not found');
    }
    if (version.status === QuoteVersionStatus.ACCEPTED) {
      throw new ConflictException('This quote version has already been accepted');
    }
    if (version.status === QuoteVersionStatus.SUPERSEDED) {
      throw new ConflictException('Cannot accept a superseded quote version');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.quoteVersion.updateMany({
        where: { quoteId, status: QuoteVersionStatus.ACCEPTED },
        data: { status: QuoteVersionStatus.SUPERSEDED },
      });

      const acceptedVersion = await tx.quoteVersion.update({
        where: { id: version.id },
        data: {
          status: QuoteVersionStatus.ACCEPTED,
          acceptedAt: now,
          acceptedBy: dto.acceptedBy.trim(),
          acceptedChannel: dto.acceptedChannel,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      let linkedInquiryId = quote.inquiryId;
      if (!linkedInquiryId && typeof tx.inquiry?.findFirst === 'function') {
        const matchingInquiry = await tx.inquiry.findFirst({
          where: {
            clientPhone: quote.clientPhone,
            eventTitle: { equals: quote.eventTitle, mode: 'insensitive' },
            status: { not: InquiryStatus.CONVERTED },
          },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        });
        if (matchingInquiry) {
          linkedInquiryId = matchingInquiry.id;
        }
      }

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: QuoteStatus.ACCEPTED,
          currentVersionId: version.id,
          ...(linkedInquiryId ? { inquiryId: linkedInquiryId } : {}),
        },
      });

      if (linkedInquiryId) {
        await tx.inquiry.update({
          where: { id: linkedInquiryId },
          data: { status: InquiryStatus.CONVERTED },
        });
        // Supersede any sibling draft/sent quotes for the same inquiry
        const siblingQuotes = await tx.quote.findMany({
          where: {
            inquiryId: linkedInquiryId,
            id: { not: quoteId },
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

      let booking;
      if (quote.booking) {
        booking = await tx.booking.update({
          where: { id: quote.booking.id },
          data: {
            acceptedQuoteVersionId: acceptedVersion.id,
            agreedTotalPoisha: acceptedVersion.totalPoisha,
            version: { increment: 1 },
          },
        });
      } else {
        const bookingRef = await this.prisma.nextReference(tx, 'BKG');
        booking = await tx.booking.create({
          data: {
            reference: bookingRef,
            quoteId: quote.id,
            acceptedQuoteVersionId: acceptedVersion.id,
            eventTypeId: quote.eventTypeId,
            eventTitle: quote.eventTitle,
            eventDate: quote.requestedDate,
            clientName: quote.clientName,
            clientPhone: quote.clientPhone,
            clientEmail: quote.clientEmail,
            currency: quote.currency,
            agreedTotalPoisha: acceptedVersion.totalPoisha,
          },
        });
      }

      // Immediately seed deliverables from the accepted quote items & category templates
      // so the booking shows them right away, even while PENDING_CONFIRMATION.
      await provisionDeliverablesFromQuoteAndTemplatesTx(tx, {
        bookingId: booking.id,
        eventTypeId: quote.eventTypeId,
        eventDate: quote.requestedDate,
        quoteItems: acceptedVersion.items ?? [],
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          entityType: 'Quote',
          entityId: quote.id,
          action: 'QUOTE_ACCEPTED',
          details: {
            quoteVersionId: acceptedVersion.id,
            versionNumber: acceptedVersion.versionNumber,
            acceptedBy: dto.acceptedBy.trim(),
            acceptedChannel: dto.acceptedChannel,
            bookingId: booking.id,
            bookingReference: booking.reference,
          },
        },
      });

      return {
        quoteId: quote.id,
        acceptedVersion: this.serializeVersion(acceptedVersion),
        booking: {
          ...booking,
          agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        },
      };
    });

    if (this.notifications) {
      await this.notifications.notifyRoles(
        [UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT],
        {
          category: 'BOOKING',
          severity: 'INFO',
          title: `Quote Accepted → ${result.booking.reference}`,
          body: `${quote.clientName} accepted "${quote.eventTitle}" (${formatTk(result.acceptedVersion.totalPoisha, quote.currency)}) via ${dto.acceptedChannel}. Awaiting advance deposit.`,
          href: `/admin/bookings/${result.booking.id}`,
          entityType: 'Booking',
          entityId: result.booking.id,
        },
      );
    }

    return result;
  }

  async listQuotes(query: ListQuotesQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.QuoteWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: {
          inquiry: { select: { id: true, reference: true, status: true } },
          booking: { select: { id: true, reference: true, status: true } },
          versions: {
            include: { items: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return {
      data: items.map((q) => ({
        ...q,
        versions: q.versions.map((v) => this.serializeVersion(v)),
      })),
      meta: { page, limit, total },
    };
  }

  async getQuote(id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        inquiry: { select: { id: true, reference: true, status: true } },
        booking: { select: { id: true, reference: true, status: true } },
        versions: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    return {
      ...quote,
      versions: quote.versions.map((v) => this.serializeVersion(v)),
    };
  }

  async getQuoteInvoicePdf(id: string): Promise<{ filename: string; buffer: Buffer }> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        eventType: { select: { name: true } },
        versions: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    const activeVersion =
      quote.versions.find((v) => v.id === quote.currentVersionId) ?? quote.versions[0];
    if (!activeVersion) {
      throw new BadRequestException('Quote does not have a version to render');
    }

    const studio = this.studioService
      ? await this.studioService.getPublicBranding()
      : {
          displayName: SOFTILO_DEFAULT_BRANDING.displayName,
          logoUrl: SOFTILO_DEFAULT_BRANDING.logoUrl,
          themeTokens: { ...SOFTILO_DEFAULT_BRANDING.themeTokens },
          contactDetails: { ...SOFTILO_DEFAULT_BRANDING.contactDetails },
          timezone: 'Asia/Dhaka',
          currency: quote.currency || 'BDT',
        };

    const buffer = await buildQuoteProposalPdf({
      studio,
      quote: {
        id: quote.id,
        reference: quote.reference,
        status: quote.status,
        eventTitle: quote.eventTitle,
        eventTypeName: quote.eventType?.name ?? null,
        requestedDate: quote.requestedDate,
        clientName: quote.clientName,
        clientPhone: quote.clientPhone,
        clientEmail: quote.clientEmail,
        currency: quote.currency,
        createdAt: quote.createdAt,
      },
      version: {
        versionNumber: activeVersion.versionNumber,
        status: activeVersion.status,
        subtotalPoisha: toJsonPoisha(activeVersion.subtotalPoisha),
        discountPoisha: toJsonPoisha(activeVersion.discountPoisha),
        totalPoisha: toJsonPoisha(activeVersion.totalPoisha),
        terms: activeVersion.terms,
        validUntil: activeVersion.validUntil,
        createdAt: activeVersion.createdAt,
        items: activeVersion.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
          lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
        })),
      },
      generatedAt: new Date().toISOString(),
    });

    return {
      filename: `quote-${quote.reference.toLowerCase()}-v${activeVersion.versionNumber}.pdf`,
      buffer,
    };
  }
}
