import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  PortfolioEventStatus,
  PortfolioMediaStatus,
  PortfolioMediaType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toJsonPoisha, toPoisha } from '../../common/money/money.js';
import {
  buildCloudinaryDeliveryUrls,
  createSignedUploadPayload,
  destroyCloudinaryAsset,
  getCloudinaryStatus,
  loadCloudinaryConfig,
  verifyUploadedAssetMetadata,
} from '../../common/cloudinary/cloudinary.util.js';
import { PaginationQueryDto, getPaginationParams } from '../../common/dto/pagination.dto.js';
import {
  CreateDeliverableLabelDto,
  CreateEventTypeDto,
  CreatePackageDto,
  CreatePortfolioEventDto,
  CreatePortfolioItemDto,
  CreateServiceItemDto,
  CreateTaskTemplateDto,
  ListPortfolioEventsQueryDto,
  RegisterPortfolioMediaDto,
  ReorderPortfolioMediaDto,
  SignPackageCoverUploadDto,
  SignPortfolioUploadDto,
  UpdateDeliverableLabelDto,
  UpdatePackageDto,
  UpdatePortfolioEventDto,
  UpdatePortfolioItemDto,
  UpdatePortfolioMediaDto,
  UpdateTaskTemplateDto,
} from './dto/catalog.dto.js';

const PACKAGE_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEventTypeExists(eventTypeId?: string) {
    if (!eventTypeId) return;
    const found = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException('EventType not found');
    }
  }

  private async assertServiceItemsExist(serviceItemIds: string[]) {
    if (serviceItemIds.length === 0) return;
    const uniqueIds = [...new Set(serviceItemIds)];
    const count = await this.prisma.serviceItem.count({
      where: { id: { in: uniqueIds } },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException('One or more service items do not exist');
    }
  }

  private serializePackage(pkg: {
    id: string;
    eventTypeId: string | null;
    eventType?: { id: string; name: string; slug: string } | null;
    name: string;
    slug: string;
    description: string | null;
    basePricePoisha: bigint;
    coverImageUrl?: string | null;
    coverImageAssetId?: string | null;
    coverImagePublicId?: string | null;
    coverImageFormat?: string | null;
    coverImageBytes?: number | null;
    coverImageWidth?: number | null;
    coverImageHeight?: number | null;
    isActive: boolean;
    isPublished: boolean;
    items?: Array<{
      id: string;
      serviceItemId: string | null;
      description: string;
      quantity: number;
      unitPricePoisha: bigint;
    }>;
  }) {
    const coverImageUrl = pkg.coverImageUrl ?? null;
    const coverDeliveryUrls = coverImageUrl
      ? pkg.coverImagePublicId && pkg.coverImageFormat
        ? buildCloudinaryDeliveryUrls({
            secureUrl: coverImageUrl,
            publicId: pkg.coverImagePublicId,
            resourceType: 'IMAGE',
            format: pkg.coverImageFormat,
          })
        : {
            coverUrl: coverImageUrl,
            thumbnailUrl: coverImageUrl,
            fullUrl: coverImageUrl,
            posterUrl: null,
          }
      : null;

    return {
      id: pkg.id,
      eventTypeId: pkg.eventTypeId,
      eventType: pkg.eventType ?? undefined,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      basePricePoisha: toJsonPoisha(pkg.basePricePoisha),
      coverImageUrl,
      coverImageAssetId: pkg.coverImageAssetId ?? null,
      coverImagePublicId: pkg.coverImagePublicId ?? null,
      coverImageFormat: pkg.coverImageFormat ?? null,
      coverImageBytes: pkg.coverImageBytes ?? null,
      coverImageWidth: pkg.coverImageWidth ?? null,
      coverImageHeight: pkg.coverImageHeight ?? null,
      coverDeliveryUrls,
      isActive: pkg.isActive,
      isPublished: pkg.isPublished,
      items: pkg.items?.map((item) => ({
        id: item.id,
        serviceItemId: item.serviceItemId,
        description: item.description,
        quantity: item.quantity,
        unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
      })),
    };
  }

  private normalizePackageCoverInput(input: {
    coverImageUrl?: string | null;
    coverImageAssetId?: string | null;
    coverImagePublicId?: string | null;
    coverImageFormat?: string | null;
    coverImageBytes?: number | null;
    coverImageWidth?: number | null;
    coverImageHeight?: number | null;
    coverImageVersion?: number | null;
    coverImageResponseSignature?: string | null;
  }) {
    if (input.coverImageUrl === undefined) {
      return undefined;
    }

    const cleanUrl = input.coverImageUrl?.trim() || null;
    if (!cleanUrl) {
      return {
        coverImageUrl: null,
        coverImageAssetId: null,
        coverImagePublicId: null,
        coverImageFormat: null,
        coverImageBytes: null,
        coverImageWidth: null,
        coverImageHeight: null,
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      throw new BadRequestException('Package cover image URL must be a valid HTTPS URL.');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Package cover image URL must use HTTPS.');
    }

    const publicId = input.coverImagePublicId?.trim() || null;
    const format = input.coverImageFormat?.trim().toLowerCase().replace(/^\./, '') || null;
    if (publicId && input.coverImageVersion && input.coverImageResponseSignature) {
      verifyUploadedAssetMetadata({
        config: loadCloudinaryConfig(),
        eventId: 'packages',
        publicId,
        resourceType: 'IMAGE',
        format: format ?? 'jpg',
        secureUrl: cleanUrl,
        bytes: input.coverImageBytes ?? 0,
        version: input.coverImageVersion,
        responseSignature: input.coverImageResponseSignature,
      });
    }

    return {
      coverImageUrl: cleanUrl,
      coverImageAssetId: input.coverImageAssetId?.trim() || null,
      coverImagePublicId: publicId,
      coverImageFormat: format,
      coverImageBytes: input.coverImageBytes ?? null,
      coverImageWidth: input.coverImageWidth ?? null,
      coverImageHeight: input.coverImageHeight ?? null,
    };
  }

  private normalizePackageItemsInput(
    items: CreatePackageDto['items'],
  ): Array<{
    serviceItemId: string | null;
    description: string;
    quantity: number;
    unitPricePoisha: bigint;
  }> {
    if (!items) return [];
    return items.map((item) => {
      const desc = item.description.trim();
      if (!desc) {
        throw new BadRequestException('Each package item line must include a description.');
      }
      return {
        serviceItemId: item.serviceItemId ?? null,
        description: desc,
        quantity: item.quantity,
        unitPricePoisha: toPoisha(item.unitPricePoisha),
      };
    });
  }

  signPackageCoverUpload(dto: SignPackageCoverUploadDto) {
    return createSignedUploadPayload({
      config: loadCloudinaryConfig(),
      eventId: 'packages',
      resourceType: 'IMAGE',
      format: dto.format,
      bytes: dto.bytes,
    });
  }

  private static readonly SYSTEM_PORTFOLIO_SLUGS = new Set([
    'studio-media-gallery',
    'studio-hero-slider',
    'studio-editorial-grid',
    'studio-services-showcase',
    'studio-about-team',
  ]);

  private normalizeSlugBase(raw: string | undefined, fallbackPrefix: string): string {
    const cleaned = (raw ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72)
      .replace(/-+$/g, '');
    return cleaned || fallbackPrefix;
  }

  private isNonSlugUniqueConflict(error: Prisma.PrismaClientKnownRequestError): boolean {
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.length > 0 && !target.map(String).includes('slug');
    }
    if (typeof target === 'string') {
      return target.length > 0 && !target.toLowerCase().includes('slug');
    }
    return false;
  }

  private async resolveUniqueSlug(
    baseSource: string,
    fallbackPrefix: string,
    existsBySlug: (candidate: string) => Promise<boolean>,
    attemptedSlugs: Set<string>,
    attemptOffset = 0,
  ): Promise<string> {
    const base = this.normalizeSlugBase(baseSource, fallbackPrefix);
    const maxLinearProbes = 20;

    for (let i = attemptOffset; i < attemptOffset + maxLinearProbes; i += 1) {
      const suffix = i === 0 ? '' : `-${i + 1}`;
      const candidate = `${base.slice(0, Math.max(1, 80 - suffix.length)).replace(/-+$/g, '')}${suffix}`;
      if (!attemptedSlugs.has(candidate) && !(await existsBySlug(candidate))) {
        return candidate;
      }
    }

    const randomSuffix = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
    return `${base.slice(0, Math.max(1, 71))}-${randomSuffix}`;
  }

  private async createWithUniqueSlug<T>(
    rawSource: string,
    fallbackPrefix: string,
    existsBySlug: (candidate: string) => Promise<boolean>,
    createRecord: (slug: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    const attemptedSlugs = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = await this.resolveUniqueSlug(
        rawSource,
        fallbackPrefix,
        existsBySlug,
        attemptedSlugs,
        attempt,
      );
      attemptedSlugs.add(slug);
      try {
        return await createRecord(slug);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          !this.isNonSlugUniqueConflict(error)
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (lastError instanceof Prisma.PrismaClientKnownRequestError) {
      throw new ConflictException(
        'Could not reserve a unique URL identifier right now. Please try again.',
      );
    }
    throw lastError;
  }

  async createEventType(dto: CreateEventTypeDto) {
    const rawSource = dto.slug?.trim() || dto.name;
    return this.createWithUniqueSlug(
      rawSource,
      'category',
      async (candidate) => {
        if (typeof this.prisma.eventType.findUnique !== 'function') return false;
        const existing = await this.prisma.eventType.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return Boolean(existing);
      },
      (uniqueSlug) =>
        this.prisma.eventType.create({
          data: {
            name: dto.name.trim(),
            slug: uniqueSlug,
            description: dto.description,
          },
        }),
    );
  }

  async listEventTypes() {
    return this.prisma.eventType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createServiceItem(dto: CreateServiceItemDto) {
    const created = await this.prisma.serviceItem.create({
      data: {
        name: dto.name.trim(),
        description: dto.description,
        unitLabel: dto.unitLabel?.trim() || 'unit',
        defaultUnitPricePoisha: toPoisha(dto.defaultUnitPricePoisha),
      },
    });
    return {
      ...created,
      defaultUnitPricePoisha: toJsonPoisha(created.defaultUnitPricePoisha),
    };
  }

  async listServiceItems() {
    const items = await this.prisma.serviceItem.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return items.map((i) => ({
      ...i,
      defaultUnitPricePoisha: toJsonPoisha(i.defaultUnitPricePoisha),
    }));
  }

  async createPackage(dto: CreatePackageDto) {
    await this.assertEventTypeExists(dto.eventTypeId ?? undefined);
    const serviceIds = (dto.items ?? [])
      .map((i) => i.serviceItemId)
      .filter((id): id is string => Boolean(id));
    await this.assertServiceItemsExist(serviceIds);

    const coverData = this.normalizePackageCoverInput(dto);
    const normalizedItems = this.normalizePackageItemsInput(dto.items);
    const rawSlugSource = dto.slug?.trim() || dto.name;

    const created = await this.createWithUniqueSlug(
      rawSlugSource,
      'package',
      async (candidate) => {
        if (typeof this.prisma.package.findUnique !== 'function') return false;
        const existing = await this.prisma.package.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return Boolean(existing);
      },
      (uniqueSlug) =>
        this.prisma.package.create({
          data: {
            eventTypeId: dto.eventTypeId ?? null,
            name: dto.name.trim(),
            slug: uniqueSlug,
            description: dto.description?.trim() || null,
            basePricePoisha: toPoisha(dto.basePricePoisha),
            ...coverData,
            isPublished: dto.isPublished ?? false,
            items: dto.items
              ? {
                  create: normalizedItems,
                }
              : undefined,
          },
          include: {
            items: true,
            eventType: { select: { id: true, name: true, slug: true } },
          },
        }),
    );
    return this.serializePackage(created);
  }

  async getPackageById(packageId: string) {
    if (!PACKAGE_UUID_REGEX.test(packageId)) {
      throw new NotFoundException('Package not found');
    }
    const pkg = await this.prisma.package.findUnique({
      where: { id: packageId },
      include: {
        items: true,
        eventType: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!pkg) {
      throw new NotFoundException('Package not found');
    }
    return this.serializePackage(pkg);
  }

  async updatePackage(packageId: string, dto: UpdatePackageDto) {
    if (!PACKAGE_UUID_REGEX.test(packageId)) {
      throw new NotFoundException('Package not found');
    }
    const existing = await this.prisma.package.findUnique({
      where: { id: packageId },
    });
    if (!existing) {
      throw new NotFoundException('Package not found');
    }

    if (dto.eventTypeId) {
      await this.assertEventTypeExists(dto.eventTypeId);
    }

    if (dto.items) {
      const serviceIds = dto.items
        .map((i) => i.serviceItemId)
        .filter((id): id is string => Boolean(id));
      await this.assertServiceItemsExist(serviceIds);
    }

    const coverData = this.normalizePackageCoverInput(dto);
    const normalizedItems = dto.items ? this.normalizePackageItemsInput(dto.items) : undefined;

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        if (dto.items) {
          await tx.packageItem.deleteMany({
            where: { packageId },
          });
        }

        return tx.package.update({
          where: { id: packageId },
          data: {
            eventTypeId: dto.eventTypeId,
            name: dto.name?.trim(),
            slug: dto.slug?.trim().toLowerCase(),
            description:
              dto.description !== undefined ? dto.description?.trim() || null : undefined,
            basePricePoisha:
              dto.basePricePoisha !== undefined ? toPoisha(dto.basePricePoisha) : undefined,
            ...coverData,
            isActive: dto.isActive,
            isPublished: dto.isPublished,
            items: normalizedItems
              ? {
                  create: normalizedItems,
                }
              : undefined,
          },
          include: {
            items: true,
            eventType: { select: { id: true, name: true, slug: true } },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A package with this URL slug already exists. Choose a different name or customize the slug.',
        );
      }
      throw error;
    }

    if (
      coverData &&
      existing.coverImagePublicId &&
      existing.coverImagePublicId !== updated.coverImagePublicId
    ) {
      void this.cleanupPackageCoverAssetIfUnused(existing.coverImagePublicId);
    }

    return this.serializePackage(updated);
  }

  private async cleanupPackageCoverAssetIfUnused(publicId: string): Promise<void> {
    const config = loadCloudinaryConfig();
    if (!getCloudinaryStatus(config).configured) return;
    try {
      const [pkgRefs, mediaRefs] = await Promise.all([
        this.prisma.package.count({ where: { coverImagePublicId: publicId } }),
        this.prisma.portfolioMedia.count({ where: { publicId } }),
      ]);
      if (pkgRefs + mediaRefs === 0) {
        await destroyCloudinaryAsset(config, publicId, 'IMAGE');
      }
    } catch {
      // Best-effort cleanup
    }
  }

  async listPackages(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const [items, total] = await Promise.all([
      this.prisma.package.findMany({
        include: {
          items: true,
          eventType: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.package.count(),
    ]);

    return {
      data: items.map((p) => this.serializePackage(p)),
      meta: { page, limit, total },
    };
  }

  async listPublicPackages(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = { isActive: true, isPublished: true };
    const [items, total] = await Promise.all([
      this.prisma.package.findMany({
        where,
        include: {
          items: true,
          eventType: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.package.count({ where }),
    ]);

    return {
      data: items.map((p) => this.serializePackage(p)),
      meta: { page, limit, total },
    };
  }

  async createPortfolioItem(dto: CreatePortfolioItemDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.portfolioItem.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        title: dto.title.trim(),
        description: dto.description,
        mediaUrl: dto.mediaUrl.trim(),
        isApproved: dto.isApproved ?? false,
        isPublished: dto.isPublished ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updatePortfolioItem(itemId: string, dto: UpdatePortfolioItemDto) {
    const existing = await this.prisma.portfolioItem.findUnique({
      where: { id: itemId },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio item not found');
    }
    return this.prisma.portfolioItem.update({
      where: { id: itemId },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        isApproved: dto.isApproved,
        isPublished: dto.isPublished,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async listPublicPortfolio(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = { isApproved: true, isPublished: true };
    const [items, total] = await Promise.all([
      this.prisma.portfolioItem.findMany({
        where,
        select: {
          id: true,
          eventTypeId: true,
          title: true,
          description: true,
          mediaUrl: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.portfolioItem.count({ where }),
    ]);
    return { data: items, meta: { page, limit, total } };
  }

  async createDeliverableLabel(dto: CreateDeliverableLabelDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.deliverableLabel.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        label: dto.label.trim(),
        defaultDueDays: dto.defaultDueDays ?? 14,
      },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
    });
  }

  async updateDeliverableLabel(id: string, dto: UpdateDeliverableLabelDto) {
    const existing = await this.prisma.deliverableLabel.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Deliverable label not found');
    }
    return this.prisma.deliverableLabel.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        defaultDueDays: dto.defaultDueDays,
        isActive: dto.isActive,
      },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
    });
  }

  async listDeliverableLabels() {
    return this.prisma.deliverableLabel.findMany({
      where: { isActive: true },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
      orderBy: { label: 'asc' },
    });
  }

  async createTaskTemplate(dto: CreateTaskTemplateDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.taskTemplate.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        title: dto.title.trim(),
        roleLabel: dto.roleLabel.trim(),
        defaultOffsetDays: dto.defaultOffsetDays ?? 0,
      },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
    });
  }

  async updateTaskTemplate(id: string, dto: UpdateTaskTemplateDto) {
    const existing = await this.prisma.taskTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Task template not found');
    }
    return this.prisma.taskTemplate.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        roleLabel: dto.roleLabel?.trim(),
        defaultOffsetDays: dto.defaultOffsetDays,
        isActive: dto.isActive,
      },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
    });
  }

  async listTaskTemplates() {
    return this.prisma.taskTemplate.findMany({
      where: { isActive: true },
      include: { eventType: { select: { id: true, name: true, slug: true } } },
      orderBy: { defaultOffsetDays: 'asc' },
    });
  }

  private serializePortfolioMedia(media: {
    id: string;
    eventId: string;
    assetId: string;
    publicId: string;
    resourceType: PortfolioMediaType;
    format: string;
    secureUrl: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    caption: string | null;
    altText: string | null;
    displayOrder: number;
    status: PortfolioMediaStatus;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const deliveryUrls = buildCloudinaryDeliveryUrls({
      secureUrl: media.secureUrl,
      publicId: media.publicId,
      resourceType: media.resourceType,
      format: media.format,
    });
    return {
      ...media,
      deliveryUrls,
    };
  }

  private serializePortfolioEvent(event: {
    id: string;
    eventTypeId: string | null;
    eventType?: { id: string; name: string; slug: string } | null;
    title: string;
    slug: string;
    eventDate: Date | null;
    description: string | null;
    location: string | null;
    status: PortfolioEventStatus;
    coverMediaId: string | null;
    sortOrder: number;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    coverMedia?: {
      id: string;
      eventId: string;
      assetId: string;
      publicId: string;
      resourceType: PortfolioMediaType;
      format: string;
      secureUrl: string;
      bytes: number;
      width: number | null;
      height: number | null;
      durationSeconds: number | null;
      caption: string | null;
      altText: string | null;
      displayOrder: number;
      status: PortfolioMediaStatus;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    media?: Array<{
      id: string;
      eventId: string;
      assetId: string;
      publicId: string;
      resourceType: PortfolioMediaType;
      format: string;
      secureUrl: string;
      bytes: number;
      width: number | null;
      height: number | null;
      durationSeconds: number | null;
      caption: string | null;
      altText: string | null;
      displayOrder: number;
      status: PortfolioMediaStatus;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    const serializedMedia = (event.media ?? []).map((m) => this.serializePortfolioMedia(m));
    const serializedCover = event.coverMedia
      ? this.serializePortfolioMedia(event.coverMedia)
      : serializedMedia.find(
          (m) => m.id === event.coverMediaId && m.resourceType === PortfolioMediaType.IMAGE,
        ) ?? null;

    const photoCount = serializedMedia.filter(
      (m) => m.resourceType === PortfolioMediaType.IMAGE && m.status === PortfolioMediaStatus.READY,
    ).length;
    const videoCount = serializedMedia.filter(
      (m) => m.resourceType === PortfolioMediaType.VIDEO && m.status === PortfolioMediaStatus.READY,
    ).length;

    return {
      ...event,
      coverMedia: serializedCover,
      media: serializedMedia,
      counts: {
        photos: photoCount,
        videos: videoCount,
        totalReady: photoCount + videoCount,
      },
    };
  }

  async createPortfolioEvent(dto: CreatePortfolioEventDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    const requestedSlug = dto.slug?.trim().toLowerCase() || '';

    const include = {
      eventType: { select: { id: true, name: true, slug: true } },
      coverMedia: true,
      media: { orderBy: [{ displayOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
    };

    if (requestedSlug && CatalogService.SYSTEM_PORTFOLIO_SLUGS.has(requestedSlug)) {
      const existingSlug = await this.prisma.portfolioEvent.findUnique({
        where: { slug: requestedSlug },
        select: { id: true },
      });
      if (existingSlug) {
        throw new ConflictException(
          `A portfolio showcase event with slug "${requestedSlug}" already exists.`,
        );
      }
      const created = await this.prisma.portfolioEvent.create({
        data: {
          title: dto.title.trim(),
          slug: requestedSlug,
          eventDate: dto.eventDate ? new Date(`${dto.eventDate}T00:00:00.000Z`) : null,
          description: dto.description?.trim() || null,
          location: dto.location?.trim() || null,
          eventTypeId: dto.eventTypeId ?? null,
          status: PortfolioEventStatus.DRAFT,
        },
        include,
      });
      return this.serializePortfolioEvent(created);
    }

    const created = await this.createWithUniqueSlug(
      requestedSlug || dto.title,
      'album',
      async (candidate) => {
        if (CatalogService.SYSTEM_PORTFOLIO_SLUGS.has(candidate)) return true;
        if (typeof this.prisma.portfolioEvent.findUnique !== 'function') return false;
        const existing = await this.prisma.portfolioEvent.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return Boolean(existing);
      },
      (uniqueSlug) =>
        this.prisma.portfolioEvent.create({
          data: {
            title: dto.title.trim(),
            slug: uniqueSlug,
            eventDate: dto.eventDate ? new Date(`${dto.eventDate}T00:00:00.000Z`) : null,
            description: dto.description?.trim() || null,
            location: dto.location?.trim() || null,
            eventTypeId: dto.eventTypeId ?? null,
            status: PortfolioEventStatus.DRAFT,
          },
          include,
        }),
    );

    return this.serializePortfolioEvent(created);
  }

  async listAdminPortfolioEvents(query: ListPortfolioEventsQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.PortfolioEventWhereInput = {
      slug: { not: 'studio-media-gallery' },
      status: query.status,
      eventTypeId: query.eventTypeId,
    };

    const [items, total] = await Promise.all([
      this.prisma.portfolioEvent.findMany({
        where,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          coverMedia: true,
          media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
        },
        orderBy: [{ sortOrder: 'asc' }, { eventDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.portfolioEvent.count({ where }),
    ]);

    return {
      data: items.map((ev) => this.serializePortfolioEvent(ev)),
      meta: { page, limit, total },
    };
  }

  async getAdminPortfolioEvent(eventId: string) {
    const event = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!event) {
      throw new NotFoundException('Portfolio showcase event not found');
    }
    return this.serializePortfolioEvent(event);
  }

  async updatePortfolioEvent(eventId: string, dto: UpdatePortfolioEventDto) {
    const existing = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio showcase event not found');
    }

    if (dto.eventTypeId) {
      await this.assertEventTypeExists(dto.eventTypeId);
    }

    let normalizedSlug: string | undefined;
    if (dto.slug !== undefined) {
      normalizedSlug = dto.slug.trim().toLowerCase();
      if (normalizedSlug !== existing.slug) {
        const duplicate = await this.prisma.portfolioEvent.findUnique({
          where: { slug: normalizedSlug },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException(`Slug "${normalizedSlug}" is already in use by another showcase event.`);
        }
      }
    }

    if (dto.coverMediaId) {
      const coverCandidate = await this.prisma.portfolioMedia.findFirst({
        where: { id: dto.coverMediaId, eventId },
      });
      if (!coverCandidate) {
        throw new BadRequestException('Selected cover media does not belong to this showcase event.');
      }
      if (coverCandidate.resourceType !== PortfolioMediaType.IMAGE) {
        throw new BadRequestException('Cover media must be an image (videos cannot be used as the event cover image).');
      }
      if (coverCandidate.status !== PortfolioMediaStatus.READY) {
        throw new BadRequestException('Cover image must finish processing (status READY) before it can be selected as cover.');
      }
    }

    const updated = await this.prisma.portfolioEvent.update({
      where: { id: eventId },
      data: {
        title: dto.title?.trim(),
        slug: normalizedSlug,
        eventDate:
          dto.eventDate !== undefined
            ? dto.eventDate
              ? new Date(`${dto.eventDate}T00:00:00.000Z`)
              : null
            : undefined,
        description: dto.description !== undefined ? dto.description.trim() || null : undefined,
        location: dto.location !== undefined ? dto.location.trim() || null : undefined,
        eventTypeId: dto.eventTypeId,
        coverMediaId: dto.coverMediaId,
        sortOrder: dto.sortOrder,
      },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    return this.serializePortfolioEvent(updated);
  }

  async signPortfolioUpload(eventId: string, dto: SignPortfolioUploadDto) {
    const event = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      throw new NotFoundException('Portfolio showcase event not found');
    }
    if (event.status === PortfolioEventStatus.ARCHIVED) {
      throw new ConflictException('Cannot upload media to an archived showcase event.');
    }

    const config = loadCloudinaryConfig();
    return createSignedUploadPayload({
      config,
      eventId: event.id,
      resourceType: dto.resourceType,
      format: dto.format,
      bytes: dto.bytes,
    });
  }

  async registerPortfolioMedia(eventId: string, dto: RegisterPortfolioMediaDto) {
    const event = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, status: true, coverMediaId: true },
    });
    if (!event) {
      throw new NotFoundException('Portfolio showcase event not found');
    }
    if (event.status === PortfolioEventStatus.ARCHIVED) {
      throw new ConflictException('Cannot add media to an archived showcase event.');
    }

    const config = loadCloudinaryConfig();
    verifyUploadedAssetMetadata({
      config,
      eventId: event.id,
      publicId: dto.publicId.trim(),
      resourceType: dto.resourceType,
      format: dto.format,
      secureUrl: dto.secureUrl.trim(),
      bytes: dto.bytes,
      version: dto.version,
      responseSignature: dto.responseSignature,
    });

    const normalizedFormat = dto.format.trim().toLowerCase().replace(/^\./, '');
    const assetId = dto.assetId.trim();
    const publicId = dto.publicId.trim();
    const targetStatus =
      (dto.status as PortfolioMediaStatus | undefined) ?? PortfolioMediaStatus.READY;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.portfolioMedia.findFirst({
        where: {
          eventId,
          OR: [{ assetId }, { publicId }],
        },
      });

      if (existing) {
        const updated = await tx.portfolioMedia.update({
          where: { id: existing.id },
          data: {
            assetId,
            publicId,
            format: normalizedFormat,
            secureUrl: dto.secureUrl.trim(),
            bytes: dto.bytes,
            width: dto.width ?? existing.width,
            height: dto.height ?? existing.height,
            durationSeconds: dto.durationSeconds ?? existing.durationSeconds,
            caption: dto.caption !== undefined ? dto.caption.trim() || null : existing.caption,
            altText: dto.altText !== undefined ? dto.altText.trim() || null : existing.altText,
            status: targetStatus,
            errorMessage: dto.errorMessage ?? null,
          },
        });

        if (
          !event.coverMediaId &&
          updated.resourceType === PortfolioMediaType.IMAGE &&
          updated.status === PortfolioMediaStatus.READY
        ) {
          await tx.portfolioEvent.update({
            where: { id: eventId },
            data: { coverMediaId: updated.id },
          });
        }

        return {
          media: this.serializePortfolioMedia(updated),
          idempotentReplay: true,
        };
      }

      const lastMedia = await tx.portfolioMedia.findFirst({
        where: { eventId },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });
      const nextDisplayOrder = (lastMedia?.displayOrder ?? -1) + 1;

      const created = await tx.portfolioMedia.create({
        data: {
          eventId,
          assetId,
          publicId,
          resourceType: dto.resourceType as PortfolioMediaType,
          format: normalizedFormat,
          secureUrl: dto.secureUrl.trim(),
          bytes: dto.bytes,
          width: dto.width ?? null,
          height: dto.height ?? null,
          durationSeconds: dto.durationSeconds ?? null,
          caption: dto.caption?.trim() || null,
          altText: dto.altText?.trim() || event.title,
          displayOrder: nextDisplayOrder,
          status: targetStatus,
          errorMessage: dto.errorMessage ?? null,
        },
      });

      if (
        !event.coverMediaId &&
        created.resourceType === PortfolioMediaType.IMAGE &&
        created.status === PortfolioMediaStatus.READY
      ) {
        await tx.portfolioEvent.update({
          where: { id: eventId },
          data: { coverMediaId: created.id },
        });
      }

      return {
        media: this.serializePortfolioMedia(created),
        idempotentReplay: false,
      };
    });
  }

  async updatePortfolioMedia(
    eventId: string,
    mediaId: string,
    dto: UpdatePortfolioMediaDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.portfolioMedia.findFirst({
        where: { id: mediaId, eventId },
      });
      if (!existing) {
        throw new NotFoundException('Portfolio media item not found for this event');
      }

      const nextStatus =
        (dto.status as PortfolioMediaStatus | undefined) ?? existing.status;

      if (dto.isCover) {
        if (existing.resourceType !== PortfolioMediaType.IMAGE) {
          throw new BadRequestException('Only an image can be set as the event cover image.');
        }
        if (nextStatus !== PortfolioMediaStatus.READY) {
          throw new BadRequestException('Cover image must have status READY.');
        }
      }

      const updated = await tx.portfolioMedia.update({
        where: { id: mediaId },
        data: {
          caption: dto.caption !== undefined ? dto.caption.trim() || null : undefined,
          altText: dto.altText !== undefined ? dto.altText.trim() || null : undefined,
          status: dto.status as PortfolioMediaStatus | undefined,
          errorMessage: dto.errorMessage !== undefined ? dto.errorMessage : undefined,
        },
      });

      if (dto.isCover) {
        await tx.portfolioEvent.update({
          where: { id: eventId },
          data: { coverMediaId: mediaId },
        });
      }

      return this.serializePortfolioMedia(updated);
    });
  }

  async reorderPortfolioMedia(eventId: string, dto: ReorderPortfolioMediaDto) {
    const event = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new NotFoundException('Portfolio showcase event not found');
    }

    const existingMedia = await this.prisma.portfolioMedia.findMany({
      where: { eventId },
      select: { id: true },
    });
    const existingIds = new Set(existingMedia.map((m) => m.id));
    for (const id of dto.mediaIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Media item ${id} does not belong to this event.`);
      }
    }

    if (typeof this.prisma.$executeRaw === 'function') {
      const ids = dto.mediaIds;
      const orders = dto.mediaIds.map((_, index) => index);
      await this.prisma.$executeRaw`
        UPDATE "portfolio_media" AS pm
        SET "display_order" = v.ord, "updated_at" = NOW()
        FROM UNNEST(${ids}::uuid[], ${orders}::int[]) AS v(id, ord)
        WHERE pm."id" = v.id AND pm."event_id" = ${eventId}::uuid
      `;
    } else {
      await this.prisma.$transaction(
        dto.mediaIds.map((mediaId, index) =>
          this.prisma.portfolioMedia.update({
            where: { id: mediaId },
            data: { displayOrder: index },
          }),
        ),
      );
    }

    return this.getAdminPortfolioEvent(eventId);
  }

  async removePortfolioMedia(eventId: string, mediaId: string) {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const event = await tx.portfolioEvent.findUnique({
        where: { id: eventId },
        select: { id: true, coverMediaId: true, status: true },
      });
      if (!event) {
        throw new NotFoundException('Portfolio showcase event not found');
      }

      const existing = await tx.portfolioMedia.findFirst({
        where: { id: mediaId, eventId },
      });
      if (!existing) {
        throw new NotFoundException('Portfolio media item not found');
      }

      await tx.portfolioMedia.delete({ where: { id: mediaId } });

      if (event.coverMediaId === mediaId) {
        const replacementCover = await tx.portfolioMedia.findFirst({
          where: {
            eventId,
            resourceType: PortfolioMediaType.IMAGE,
            status: PortfolioMediaStatus.READY,
          },
          orderBy: { displayOrder: 'asc' },
          select: { id: true },
        });

        await tx.portfolioEvent.update({
          where: { id: eventId },
          data: {
            coverMediaId: replacementCover?.id ?? null,
            // If published event lost its last ready cover image, revert to DRAFT automatically
            status:
              !replacementCover && event.status === PortfolioEventStatus.PUBLISHED
                ? PortfolioEventStatus.DRAFT
                : event.status,
          },
        });
      }

      return { existing, remainingRefs: 0 };
    });

    const remainingRefs = await this.prisma.portfolioMedia.count({
      where: { publicId: deleted.existing.publicId },
    });

    // Best-effort cleanup in Cloudinary only if no other portfolio/gallery item references this asset
    if (remainingRefs === 0) {
      void destroyCloudinaryAsset(
        loadCloudinaryConfig(),
        deleted.existing.publicId,
        deleted.existing.resourceType as 'IMAGE' | 'VIDEO',
      );
    }

    return { deletedMediaId: mediaId };
  }

  async publishPortfolioEvent(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.portfolioEvent.findUnique({
        where: { id: eventId },
        include: {
          coverMedia: true,
          media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      if (!event) {
        throw new NotFoundException('Portfolio showcase event not found');
      }

      let resolvedCover =
        event.coverMedia &&
        event.coverMedia.resourceType === PortfolioMediaType.IMAGE &&
        event.coverMedia.status === PortfolioMediaStatus.READY
          ? event.coverMedia
          : null;

      if (!resolvedCover) {
        resolvedCover =
          event.media.find(
            (m) =>
              m.resourceType === PortfolioMediaType.IMAGE &&
              m.status === PortfolioMediaStatus.READY,
          ) ?? null;
      }

      if (!resolvedCover) {
        throw new BadRequestException(
          'Cannot publish showcase event: at least one READY cover image is required before publishing.',
        );
      }

      const updated = await tx.portfolioEvent.update({
        where: { id: eventId },
        data: {
          status: PortfolioEventStatus.PUBLISHED,
          coverMediaId: resolvedCover.id,
          publishedAt: event.publishedAt ?? new Date(),
        },
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          coverMedia: true,
          media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
        },
      });

      return this.serializePortfolioEvent(updated);
    });
  }

  async unpublishPortfolioEvent(eventId: string) {
    const existing = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio showcase event not found');
    }

    const updated = await this.prisma.portfolioEvent.update({
      where: { id: eventId },
      data: { status: PortfolioEventStatus.DRAFT },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return this.serializePortfolioEvent(updated);
  }

  async archivePortfolioEvent(eventId: string) {
    const existing = await this.prisma.portfolioEvent.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio showcase event not found');
    }

    const updated = await this.prisma.portfolioEvent.update({
      where: { id: eventId },
      data: { status: PortfolioEventStatus.ARCHIVED },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return this.serializePortfolioEvent(updated);
  }

  async listPublicPortfolioEvents(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.PortfolioEventWhereInput = {
      slug: {
        notIn: [
          'studio-media-gallery',
          'studio-hero-slider',
          'studio-editorial-grid',
          'studio-services-showcase',
          'studio-about-team',
        ],
      },
      status: PortfolioEventStatus.PUBLISHED,
      coverMedia: {
        is: {
          resourceType: PortfolioMediaType.IMAGE,
          status: PortfolioMediaStatus.READY,
        },
      },
    };

    const canGroupMediaCounts = typeof this.prisma.portfolioMedia?.groupBy === 'function';

    const [items, total] = await Promise.all([
      this.prisma.portfolioEvent.findMany({
        where,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          coverMedia: true,
          ...(canGroupMediaCounts
            ? {}
            : {
                media: {
                  where: { status: PortfolioMediaStatus.READY },
                  orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
                },
              }),
        },
        orderBy: [{ sortOrder: 'asc' }, { eventDate: 'desc' }, { publishedAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.portfolioEvent.count({ where }),
    ]);

    if (!canGroupMediaCounts || items.length === 0) {
      return {
        data: items.map((ev) => this.serializePortfolioEvent(ev)),
        meta: { page, limit, total },
      };
    }

    const eventIds = items.map((ev) => ev.id);
    const mediaGroups = await this.prisma.portfolioMedia.groupBy({
      by: ['eventId', 'resourceType'],
      where: {
        eventId: { in: eventIds },
        status: PortfolioMediaStatus.READY,
      },
      _count: { _all: true },
    });

    const countMap = new Map<string, { photos: number; videos: number }>();
    for (const grp of mediaGroups) {
      const bucket = countMap.get(grp.eventId) ?? { photos: 0, videos: 0 };
      if (grp.resourceType === PortfolioMediaType.IMAGE) {
        bucket.photos = grp._count._all;
      } else if (grp.resourceType === PortfolioMediaType.VIDEO) {
        bucket.videos = grp._count._all;
      }
      countMap.set(grp.eventId, bucket);
    }

    return {
      data: items.map((ev) => {
        const base = this.serializePortfolioEvent(ev);
        const counts = countMap.get(ev.id) ?? { photos: 0, videos: 0 };
        return {
          ...base,
          counts: {
            photos: counts.photos,
            videos: counts.videos,
            totalReady: counts.photos + counts.videos,
          },
        };
      }),
      meta: { page, limit, total },
    };
  }

  async getPublicPortfolioEventBySlug(slugOrId: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        slugOrId,
      );

    const event = await this.prisma.portfolioEvent.findFirst({
      where: {
        ...(isUuid ? { OR: [{ slug: slugOrId.toLowerCase() }, { id: slugOrId }] } : { slug: slugOrId.toLowerCase() }),
        status: PortfolioEventStatus.PUBLISHED,
        coverMedia: {
          is: {
            resourceType: PortfolioMediaType.IMAGE,
            status: PortfolioMediaStatus.READY,
          },
        },
      },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: {
          where: { status: PortfolioMediaStatus.READY },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Published showcase event not found');
    }

    return this.serializePortfolioEvent(event);
  }

  // =========================================================================
  // Direct Studio Media Gallery (Photo & Video Drag-and-Drop Library)
  // =========================================================================

  getGalleryStatus() {
    return getCloudinaryStatus(loadCloudinaryConfig());
  }

  private async ensureDefaultGalleryEvent() {
    const slug = 'studio-media-gallery';
    const existing = await this.prisma.portfolioEvent.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === PortfolioEventStatus.ARCHIVED) {
        await this.prisma.portfolioEvent.update({
          where: { id: existing.id },
          data: { status: PortfolioEventStatus.DRAFT },
        });
      }
      return existing.id;
    }

    try {
      const created = await this.prisma.portfolioEvent.create({
        data: {
          title: 'Studio Media Gallery',
          slug,
          description: 'Uploaded studio photos and videos.',
          status: PortfolioEventStatus.DRAFT,
        },
        select: { id: true },
      });
      return created.id;
    } catch {
      const concurrent = await this.prisma.portfolioEvent.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!concurrent) {
        throw new ConflictException('Unable to initialize studio media gallery container.');
      }
      return concurrent.id;
    }
  }

  private async buildUniqueShortAlbumSlug(title: string, reference: string): Promise<string> {
    const refSuffix = reference.trim().toLowerCase();
    const numericMatch = refSuffix.match(/(\d+)$/);
    const shortCode = numericMatch ? String(Number(numericMatch[1])) : refSuffix;

    const stopWords = new Set([
      'and',
      'the',
      'of',
      'for',
      'with',
      'at',
      'in',
      'on',
      'by',
      'event',
      'reception',
      'ceremony',
    ]);
    const words = title
      .toLowerCase()
      .replace(/['’]s\b/g, 's')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w && !stopWords.has(w));

    let base = '';
    for (const word of words) {
      const candidate = base ? `${base}-${word}` : word;
      if (candidate.length <= 24) {
        base = candidate;
      } else {
        break;
      }
      if (base.split('-').length >= 3) break;
    }

    if (!base) {
      base = words[0]?.slice(0, 24) || `album-${shortCode}`;
    }

    const candidates = Array.from(
      new Set([base, `${base}-${shortCode}`, `${base}-${refSuffix}`]),
    );
    for (const candidate of candidates) {
      const taken = await this.prisma.portfolioEvent.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) {
        return candidate;
      }
    }

    return `${base.slice(0, Math.max(8, 72 - refSuffix.length))}-${refSuffix}`;
  }

  private async findExistingBookingPortfolio(reference: string) {
    const trimmedRef = reference.trim();
    const refSuffix = trimmedRef.toLowerCase();
    return this.prisma.portfolioEvent.findFirst({
      where: {
        OR: [
          { description: { contains: `[${trimmedRef}]` } },
          { slug: refSuffix },
          { slug: { endsWith: `-${refSuffix}` } },
        ],
      },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        coverMedia: true,
        media: {
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  async getPortfolioEventByBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, reference: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking "${bookingId}" not found.`);
    }

    const existing = await this.findExistingBookingPortfolio(booking.reference);
    return {
      event: existing ? this.serializePortfolioEvent(existing) : null,
    };
  }

  async createPortfolioEventFromBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        sessions: {
          orderBy: { startAt: 'asc' },
          take: 1,
          select: { location: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking "${bookingId}" not found.`);
    }

    const existing = await this.findExistingBookingPortfolio(booking.reference);
    if (existing) {
      return {
        event: this.serializePortfolioEvent(existing),
        created: false,
      };
    }

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException(
        'Digital portfolio can only be created after the booking event is marked COMPLETED.',
      );
    }

    const slug = await this.buildUniqueShortAlbumSlug(booking.eventTitle, booking.reference);
    const primaryLocation = booking.sessions?.[0]?.location?.trim() || null;

    try {
      const created = await this.prisma.portfolioEvent.create({
        data: {
          title: booking.eventTitle.trim(),
          slug,
          eventDate: booking.eventDate,
          eventTypeId: booking.eventTypeId,
          location: primaryLocation,
          description: `Digital album for ${booking.clientName} [${booking.reference}]`,
          status: PortfolioEventStatus.DRAFT,
        },
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          coverMedia: true,
          media: {
            orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });

      return {
        event: this.serializePortfolioEvent(created),
        created: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findExistingBookingPortfolio(booking.reference);
        if (concurrent) {
          return {
            event: this.serializePortfolioEvent(concurrent),
            created: false,
          };
        }
      }
      throw error;
    }
  }

  async listGalleryMedia(resourceType?: PortfolioMediaType) {
    const excludedSystemSlugs = [
      'studio-hero-slider',
      'studio-editorial-grid',
      'studio-services-showcase',
      'studio-about-team',
    ];
    const galleryScopeWhere: Prisma.PortfolioMediaWhereInput = {
      event: {
        slug: { notIn: excludedSystemSlugs },
      },
    };
    const where: Prisma.PortfolioMediaWhereInput = resourceType
      ? { ...galleryScopeWhere, resourceType }
      : galleryScopeWhere;

    const [items, photoCount, videoCount] = await Promise.all([
      this.prisma.portfolioMedia.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { displayOrder: 'asc' }],
        take: 250,
      }),
      this.prisma.portfolioMedia.count({
        where: { ...galleryScopeWhere, resourceType: PortfolioMediaType.IMAGE },
      }),
      this.prisma.portfolioMedia.count({
        where: { ...galleryScopeWhere, resourceType: PortfolioMediaType.VIDEO },
      }),
    ]);

    return {
      data: items.map((m) => this.serializePortfolioMedia(m)),
      counts: {
        total: photoCount + videoCount,
        photos: photoCount,
        videos: videoCount,
      },
    };
  }

  async listPublicGalleryMedia(resourceType?: PortfolioMediaType) {
    const excludedSystemSlugs = [
      'studio-hero-slider',
      'studio-editorial-grid',
      'studio-services-showcase',
      'studio-about-team',
    ];
    const baseWhere: Prisma.PortfolioMediaWhereInput = {
      status: PortfolioMediaStatus.READY,
      event: {
        status: { not: PortfolioEventStatus.ARCHIVED },
        slug: { notIn: excludedSystemSlugs },
      },
    };
    const where: Prisma.PortfolioMediaWhereInput = resourceType
      ? { ...baseWhere, resourceType }
      : baseWhere;

    const [items, photoCount, videoCount] = await Promise.all([
      this.prisma.portfolioMedia.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { displayOrder: 'asc' }],
        take: 60,
      }),
      this.prisma.portfolioMedia.count({
        where: { ...baseWhere, resourceType: PortfolioMediaType.IMAGE },
      }),
      this.prisma.portfolioMedia.count({
        where: { ...baseWhere, resourceType: PortfolioMediaType.VIDEO },
      }),
    ]);

    return {
      data: items.map((m) => this.serializePortfolioMedia(m)),
      counts: {
        total: photoCount + videoCount,
        photos: photoCount,
        videos: videoCount,
      },
    };
  }

  async signGalleryUpload(dto: SignPortfolioUploadDto) {
    const galleryEventId = await this.ensureDefaultGalleryEvent();
    return this.signPortfolioUpload(galleryEventId, dto);
  }

  async registerGalleryMedia(dto: RegisterPortfolioMediaDto) {
    const galleryEventId = await this.ensureDefaultGalleryEvent();
    return this.registerPortfolioMedia(galleryEventId, dto);
  }

  async updateGalleryMedia(mediaId: string, dto: UpdatePortfolioMediaDto) {
    const media = await this.prisma.portfolioMedia.findUnique({
      where: { id: mediaId },
      select: { id: true, eventId: true },
    });
    if (!media) {
      throw new NotFoundException('Gallery media item not found');
    }
    return this.updatePortfolioMedia(media.eventId, media.id, dto);
  }

  async deleteGalleryMedia(mediaId: string) {
    const media = await this.prisma.portfolioMedia.findUnique({
      where: { id: mediaId },
      select: { id: true, eventId: true },
    });
    if (!media) {
      throw new NotFoundException('Gallery media item not found');
    }
    return this.removePortfolioMedia(media.eventId, media.id);
  }
}
