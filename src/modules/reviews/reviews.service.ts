import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  buildCloudinaryDeliveryUrls,
  createSignedUploadPayload,
  destroyCloudinaryAsset,
  getCloudinaryStatus,
  loadCloudinaryConfig,
  verifyUploadedAssetMetadata,
} from '../../common/cloudinary/cloudinary.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CreateClientReviewDto,
  ListReviewsQueryDto,
  ReorderReviewsDto,
  SignReviewUploadDto,
  UpdateClientReviewDto,
} from './dto/reviews.dto.js';

const REVIEWS_CLOUDINARY_SCOPE = 'reviews';

interface RawClientReviewRow {
  id: string;
  client_name: string;
  quote: string;
  rating: number;
  event_title: string | null;
  source_label: string | null;
  image_url: string;
  image_asset_id: string | null;
  image_public_id: string | null;
  image_format: string | null;
  image_bytes: number | null;
  image_width: number | null;
  image_height: number | null;
  is_published: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface SerializedClientReview {
  id: string;
  clientName: string;
  quote: string;
  rating: number;
  eventTitle: string | null;
  sourceLabel: string | null;
  imageUrl: string;
  imageAssetId: string | null;
  imagePublicId: string | null;
  imageFormat: string | null;
  imageBytes: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  deliveryUrls: {
    coverUrl: string;
    thumbnailUrl: string;
    fullUrl: string;
    posterUrl: string | null;
  };
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const REVIEW_COLUMNS_SQL = `
  "id",
  "client_name",
  "quote",
  "rating",
  "event_title",
  "source_label",
  "image_url",
  "image_asset_id",
  "image_public_id",
  "image_format",
  "image_bytes",
  "image_width",
  "image_height",
  "is_published",
  "sort_order",
  "created_at",
  "updated_at"
`;

function isMissingReviewsTableError(err: unknown): boolean {
  const message = (err as Error)?.message ?? String(err);
  return (
    message.includes('42P01') ||
    /relation\s+"?client_reviews"?\s+does not exist/i.test(message)
  );
}

const CREATE_CLIENT_REVIEWS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "client_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_name" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 5,
  "event_title" TEXT,
  "source_label" TEXT,
  "image_url" TEXT NOT NULL,
  "image_asset_id" TEXT,
  "image_public_id" TEXT,
  "image_format" TEXT,
  "image_bytes" INTEGER,
  "image_width" INTEGER,
  "image_height" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_reviews_rating_range_chk" CHECK ("rating" >= 1 AND "rating" <= 5)
)`;

const CREATE_CLIENT_REVIEWS_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS "client_reviews_is_published_sort_order_created_at_idx" ON "client_reviews"("is_published", "sort_order", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "client_reviews_image_public_id_idx" ON "client_reviews"("image_public_id")`,
];

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  private tableBootstrapPromise: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async ensureTableExists(): Promise<void> {
    if (typeof this.prisma?.$executeRawUnsafe !== 'function') {
      return;
    }
    if (!this.tableBootstrapPromise) {
      this.tableBootstrapPromise = (async () => {
        await this.prisma.$executeRawUnsafe(CREATE_CLIENT_REVIEWS_TABLE_SQL);
        for (const indexSql of CREATE_CLIENT_REVIEWS_INDEXES_SQL) {
          await this.prisma.$executeRawUnsafe(indexSql);
        }
      })().catch((err) => {
        this.tableBootstrapPromise = null;
        throw err;
      });
    }
    await this.tableBootstrapPromise;
  }

  private async withReviewsTable<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (!isMissingReviewsTableError(err)) {
        throw err;
      }
      this.logger.warn(
        'client_reviews table missing; auto-creating idempotently (also commit/run prisma migrate deploy).',
      );
      await this.ensureTableExists();
      return operation();
    }
  }

  private serialize(row: RawClientReviewRow): SerializedClientReview {
    const deliveryUrls =
      row.image_public_id && row.image_format
        ? buildCloudinaryDeliveryUrls({
            secureUrl: row.image_url,
            publicId: row.image_public_id,
            resourceType: 'IMAGE',
            format: row.image_format,
          })
        : {
            coverUrl: row.image_url,
            thumbnailUrl: row.image_url,
            fullUrl: row.image_url,
            posterUrl: null,
          };

    return {
      id: row.id,
      clientName: row.client_name,
      quote: row.quote,
      rating: row.rating,
      eventTitle: row.event_title,
      sourceLabel: row.source_label,
      imageUrl: row.image_url,
      imageAssetId: row.image_asset_id,
      imagePublicId: row.image_public_id,
      imageFormat: row.image_format,
      imageBytes: row.image_bytes,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      deliveryUrls,
      isPublished: row.is_published,
      sortOrder: row.sort_order,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    };
  }

  private async validateReviewImageInput(input: {
    imageUrl: string;
    imagePublicId?: string | null;
    imageFormat?: string | null;
    imageBytes?: number | null;
    imageVersion?: number | null;
    imageResponseSignature?: string | null;
  }): Promise<void> {
    const cleanUrl = input.imageUrl.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      throw new BadRequestException('Review background imageUrl must be a valid HTTPS URL.');
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Review background imageUrl must use HTTPS.');
    }

    const publicId = input.imagePublicId?.trim();
    if (!publicId) {
      return;
    }

    // Signed fresh upload directly under the reviews folder: verify signature + format + size
    if (input.imageResponseSignature && input.imageVersion) {
      const config = loadCloudinaryConfig();
      verifyUploadedAssetMetadata({
        config,
        eventId: REVIEWS_CLOUDINARY_SCOPE,
        publicId,
        resourceType: 'IMAGE',
        format: input.imageFormat ?? 'jpg',
        secureUrl: cleanUrl,
        bytes: input.imageBytes ?? 0,
        version: input.imageVersion,
        responseSignature: input.imageResponseSignature,
      });
      return;
    }

    // Otherwise accept an existing studio gallery asset or Cloudinary asset in our domain/prefix
    if (typeof this.prisma?.portfolioMedia?.findFirst === 'function') {
      const existingMedia = await this.prisma.portfolioMedia.findFirst({
        where: {
          publicId,
          status: 'READY',
        },
        select: { id: true, resourceType: true },
      });
      if (existingMedia) {
        if (existingMedia.resourceType !== 'IMAGE') {
          throw new BadRequestException('Review backdrop must be an image asset.');
        }
        return;
      }
    }

    const config = loadCloudinaryConfig();
    if (
      getCloudinaryStatus(config).configured &&
      !publicId.startsWith(`${config.folderPrefix}/`)
    ) {
      throw new BadRequestException(
        'Review image publicId must belong to the configured studio media folder.',
      );
    }
  }

  private async cleanupUnusedCloudinaryImage(publicId: string | null): Promise<void> {
    if (!publicId) return;

    try {
      const reviewRefsRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
        `SELECT COUNT(*) AS "total" FROM "client_reviews" WHERE "image_public_id" = $1`,
        publicId,
      );
      const reviewRefs = Number(reviewRefsRows?.[0]?.total ?? 0n);

      const mediaRefs =
        typeof this.prisma?.portfolioMedia?.count === 'function'
          ? await this.prisma.portfolioMedia.count({ where: { publicId } })
          : 0;

      if (reviewRefs === 0 && mediaRefs === 0) {
        await destroyCloudinaryAsset(loadCloudinaryConfig(), publicId, 'IMAGE');
      }
    } catch (err) {
      this.logger.warn(
        `Skipped Cloudinary review image cleanup for ${publicId}: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  getUploadStatus() {
    return getCloudinaryStatus(loadCloudinaryConfig());
  }

  signReviewUpload(dto: SignReviewUploadDto) {
    const config = loadCloudinaryConfig();
    return createSignedUploadPayload({
      config,
      eventId: REVIEWS_CLOUDINARY_SCOPE,
      resourceType: 'IMAGE',
      format: dto.format,
      bytes: dto.bytes,
    });
  }

  async listPublicReviews(): Promise<SerializedClientReview[]> {
    try {
      const rows = await this.withReviewsTable(() =>
        this.prisma.$queryRawUnsafe<RawClientReviewRow[]>(
          `SELECT ${REVIEW_COLUMNS_SQL}
           FROM "client_reviews"
           WHERE "is_published" = true
           ORDER BY "sort_order" ASC, "created_at" DESC
           LIMIT 50`,
        ),
      );
      return rows.map((row) => this.serialize(row));
    } catch (err) {
      if (isMissingReviewsTableError(err)) {
        this.logger.warn(
          'client_reviews table is not present yet; run prisma migrate deploy to enable DB-backed client reviews.',
        );
        return [];
      }
      throw err;
    }
  }

  async listAdminReviews(query: ListReviewsQueryDto = {}) {
    const whereClause =
      query.status === 'published'
        ? `WHERE "is_published" = true`
        : query.status === 'draft'
          ? `WHERE "is_published" = false`
          : '';

    const rows = await this.withReviewsTable(() =>
      this.prisma.$queryRawUnsafe<RawClientReviewRow[]>(
        `SELECT ${REVIEW_COLUMNS_SQL}
         FROM "client_reviews"
         ${whereClause}
         ORDER BY "sort_order" ASC, "created_at" DESC
         LIMIT 200`,
      ),
    );

    return {
      data: rows.map((row) => this.serialize(row)),
      uploadStatus: this.getUploadStatus(),
    };
  }

  async createReview(dto: CreateClientReviewDto): Promise<SerializedClientReview> {
    const clientName = dto.clientName.trim();
    const quote = dto.quote.trim();
    if (!clientName || quote.length < 3) {
      throw new BadRequestException('Client name and review quote are required.');
    }

    await this.validateReviewImageInput({
      imageUrl: dto.imageUrl,
      imagePublicId: dto.imagePublicId,
      imageFormat: dto.imageFormat,
      imageBytes: dto.imageBytes,
      imageVersion: dto.imageVersion,
      imageResponseSignature: dto.imageResponseSignature,
    });

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const maxRows = await this.withReviewsTable(() =>
        this.prisma.$queryRawUnsafe<Array<{ max_order: number | null }>>(
          `SELECT MAX("sort_order") AS "max_order" FROM "client_reviews"`,
        ),
      );
      const currentMax = maxRows?.[0]?.max_order;
      sortOrder = typeof currentMax === 'number' ? currentMax + 1 : 0;
    }

    const rating = dto.rating ?? 5;
    const isPublished = dto.isPublished ?? true;
    const normalizedFormat = dto.imageFormat
      ? dto.imageFormat.trim().toLowerCase().replace(/^\./, '')
      : null;

    const inserted = await this.withReviewsTable(() =>
      this.prisma.$queryRawUnsafe<RawClientReviewRow[]>(
        `INSERT INTO "client_reviews" (
          "client_name",
          "quote",
          "rating",
          "event_title",
          "source_label",
          "image_url",
          "image_asset_id",
          "image_public_id",
          "image_format",
          "image_bytes",
          "image_width",
          "image_height",
          "is_published",
          "sort_order"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING ${REVIEW_COLUMNS_SQL}`,
        clientName,
        quote,
        rating,
        dto.eventTitle?.trim() || null,
        dto.sourceLabel?.trim() || null,
        dto.imageUrl.trim(),
        dto.imageAssetId?.trim() || null,
        dto.imagePublicId?.trim() || null,
        normalizedFormat,
        dto.imageBytes ?? null,
        dto.imageWidth ?? null,
        dto.imageHeight ?? null,
        isPublished,
        sortOrder,
      ),
    );

    const row = inserted[0];
    if (!row) {
      throw new BadRequestException('Unable to save client review.');
    }

    return this.serialize(row);
  }

  async updateReview(id: string, dto: UpdateClientReviewDto): Promise<SerializedClientReview> {
    const existingRows = await this.withReviewsTable(() =>
      this.prisma.$queryRawUnsafe<RawClientReviewRow[]>(
        `SELECT ${REVIEW_COLUMNS_SQL} FROM "client_reviews" WHERE "id" = $1::uuid LIMIT 1`,
        id,
      ),
    );
    const existing = existingRows[0];
    if (!existing) {
      throw new NotFoundException('Client review not found');
    }

    const nextImageUrl = dto.imageUrl !== undefined ? dto.imageUrl.trim() : existing.image_url;
    const imageChanged = dto.imageUrl !== undefined && nextImageUrl !== existing.image_url;

    const nextPublicId =
      dto.imagePublicId !== undefined
        ? dto.imagePublicId.trim() || null
        : imageChanged
          ? null
          : existing.image_public_id;
    const nextAssetId =
      dto.imageAssetId !== undefined
        ? dto.imageAssetId.trim() || null
        : imageChanged
          ? null
          : existing.image_asset_id;
    const nextFormat =
      dto.imageFormat !== undefined
        ? dto.imageFormat.trim().toLowerCase().replace(/^\./, '') || null
        : imageChanged
          ? null
          : existing.image_format;
    const nextBytes =
      dto.imageBytes !== undefined
        ? dto.imageBytes
        : imageChanged
          ? null
          : existing.image_bytes;
    const nextWidth =
      dto.imageWidth !== undefined
        ? dto.imageWidth
        : imageChanged
          ? null
          : existing.image_width;
    const nextHeight =
      dto.imageHeight !== undefined
        ? dto.imageHeight
        : imageChanged
          ? null
          : existing.image_height;

    if (imageChanged || dto.imageResponseSignature) {
      await this.validateReviewImageInput({
        imageUrl: nextImageUrl,
        imagePublicId: nextPublicId,
        imageFormat: nextFormat,
        imageBytes: nextBytes,
        imageVersion: dto.imageVersion,
        imageResponseSignature: dto.imageResponseSignature,
      });
    }

    const nextClientName =
      dto.clientName !== undefined ? dto.clientName.trim() : existing.client_name;
    const nextQuote = dto.quote !== undefined ? dto.quote.trim() : existing.quote;
    if (!nextClientName || nextQuote.length < 3) {
      throw new BadRequestException('Client name and review quote cannot be empty.');
    }

    const nextEventTitle =
      dto.eventTitle !== undefined ? dto.eventTitle.trim() || null : existing.event_title;
    const nextSourceLabel =
      dto.sourceLabel !== undefined ? dto.sourceLabel.trim() || null : existing.source_label;
    const nextRating = dto.rating !== undefined ? dto.rating : existing.rating;
    const nextPublished =
      dto.isPublished !== undefined ? dto.isPublished : existing.is_published;
    const nextSortOrder =
      dto.sortOrder !== undefined ? dto.sortOrder : existing.sort_order;

    const updatedRows = await this.prisma.$queryRawUnsafe<RawClientReviewRow[]>(
      `UPDATE "client_reviews"
       SET
         "client_name" = $2,
         "quote" = $3,
         "rating" = $4,
         "event_title" = $5,
         "source_label" = $6,
         "image_url" = $7,
         "image_asset_id" = $8,
         "image_public_id" = $9,
         "image_format" = $10,
         "image_bytes" = $11,
         "image_width" = $12,
         "image_height" = $13,
         "is_published" = $14,
         "sort_order" = $15,
         "updated_at" = NOW()
       WHERE "id" = $1::uuid
       RETURNING ${REVIEW_COLUMNS_SQL}`,
      id,
      nextClientName,
      nextQuote,
      nextRating,
      nextEventTitle,
      nextSourceLabel,
      nextImageUrl,
      nextAssetId,
      nextPublicId,
      nextFormat,
      nextBytes,
      nextWidth,
      nextHeight,
      nextPublished,
      nextSortOrder,
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new NotFoundException('Client review not found');
    }

    if (
      existing.image_public_id &&
      existing.image_public_id !== updated.image_public_id
    ) {
      void this.cleanupUnusedCloudinaryImage(existing.image_public_id);
    }

    return this.serialize(updated);
  }

  async reorderReviews(dto: ReorderReviewsDto) {
    const uniqueIds = [...new Set(dto.reviewIds)];
    await this.withReviewsTable(() =>
      Promise.all(
        uniqueIds.map((reviewId, index) =>
          this.prisma.$executeRawUnsafe(
            `UPDATE "client_reviews"
             SET "sort_order" = $2, "updated_at" = NOW()
             WHERE "id" = $1::uuid`,
            reviewId,
            index,
          ),
        ),
      ),
    );
    return this.listAdminReviews({ status: 'all' });
  }

  async deleteReview(id: string) {
    const deletedRows = await this.withReviewsTable(() =>
      this.prisma.$queryRawUnsafe<
        Array<{ id: string; image_public_id: string | null }>
      >(
        `DELETE FROM "client_reviews"
         WHERE "id" = $1::uuid
         RETURNING "id", "image_public_id"`,
        id,
      ),
    );

    const deleted = deletedRows[0];
    if (!deleted) {
      throw new NotFoundException('Client review not found');
    }

    if (deleted.image_public_id) {
      void this.cleanupUnusedCloudinaryImage(deleted.image_public_id);
    }

    return { deletedReviewId: deleted.id };
  }
}
