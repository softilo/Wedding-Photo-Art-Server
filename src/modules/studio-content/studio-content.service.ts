import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  buildCloudinaryDeliveryUrls,
  createSignedUploadPayload,
  destroyCloudinaryAsset,
  getCloudinaryStatus,
  loadCloudinaryConfig,
  verifyUploadedAssetMetadata,
} from '../../common/cloudinary/cloudinary.util.js';
import { PortfolioEventStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  SaveAboutTeamBulkDto,
  SaveStudioServicesBulkDto,
  SignStudioContentUploadDto,
} from './dto/studio-content.dto.js';

const SERVICES_CLOUDINARY_SCOPE = 'services';
const TEAM_CLOUDINARY_SCOPE = 'team';
const LEGACY_SERVICES_SLUG = 'studio-services-showcase';
const LEGACY_ABOUT_SLUG = 'studio-about-team';
const SERVICES_CONFIG_OPEN = '<!-- WPA_SERVICES_CONFIG:';
const ABOUT_CONFIG_OPEN = '<!-- WPA_ABOUT_TEAM_CONFIG:';
const CONFIG_CLOSE = ' -->';

interface RawStudioServiceRow {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  image_asset_id: string | null;
  image_public_id: string | null;
  image_format: string | null;
  image_bytes: number | null;
  image_width: number | null;
  image_height: number | null;
  show_on_home: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface RawStudioAboutProfileRow {
  id: string;
  services_section_enabled: boolean;
  story_eyebrow: string;
  story_title: string;
  story_lead: string;
  story_body: string;
  milestones: unknown;
  career_roles: unknown;
  updated_at: Date;
}

interface RawStudioTeamMemberRow {
  id: string;
  name: string;
  subtitle: string | null;
  role: string;
  specialty: string;
  bio: string;
  quote: string | null;
  phone: string | null;
  instagram: string | null;
  location: string | null;
  is_featured: boolean;
  image_url: string | null;
  image_asset_id: string | null;
  image_public_id: string | null;
  image_format: string | null;
  image_bytes: number | null;
  image_width: number | null;
  image_height: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface DeliveryUrlsPayload {
  coverUrl: string;
  thumbnailUrl: string;
  fullUrl: string;
  posterUrl: string | null;
}

export interface SerializedStudioService {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  imageAssetId: string | null;
  imagePublicId: string | null;
  imageFormat: string | null;
  imageBytes: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  deliveryUrls: DeliveryUrlsPayload | null;
  showOnHome: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudioMilestoneItem {
  label: string;
  target: number;
  suffix: string;
  startFrom: number;
}

export interface StudioCareerRoleItem {
  title: string;
  type: string;
  summary: string;
}

export interface SerializedStudioAboutProfile {
  storyEyebrow: string;
  storyTitle: string;
  storyLead: string;
  storyBody: string;
  milestones: StudioMilestoneItem[];
  careerRoles: StudioCareerRoleItem[];
  servicesSectionEnabled: boolean;
  updatedAt: string;
}

export interface SerializedStudioTeamMember {
  id: string;
  name: string;
  subtitle: string | null;
  role: string;
  specialty: string;
  bio: string;
  quote: string | null;
  phone: string | null;
  instagram: string | null;
  location: string | null;
  isFeatured: boolean;
  imageUrl: string | null;
  imageAssetId: string | null;
  imagePublicId: string | null;
  imageFormat: string | null;
  imageBytes: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  deliveryUrls: DeliveryUrlsPayload | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const SERVICE_COLUMNS_SQL = `
  "id", "title", "description", "image_url", "image_asset_id", "image_public_id",
  "image_format", "image_bytes", "image_width", "image_height", "show_on_home",
  "is_active", "sort_order", "created_at", "updated_at"
`;

const TEAM_COLUMNS_SQL = `
  "id", "name", "subtitle", "role", "specialty", "bio", "quote", "phone",
  "instagram", "location", "is_featured", "image_url", "image_asset_id",
  "image_public_id", "image_format", "image_bytes", "image_width",
  "image_height", "is_active", "sort_order", "created_at", "updated_at"
`;

const CREATE_STUDIO_CONTENT_DDL = [
  `CREATE TABLE IF NOT EXISTS "studio_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "image_asset_id" TEXT,
    "image_public_id" TEXT,
    "image_format" TEXT,
    "image_bytes" INTEGER,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "show_on_home" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "studio_services_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "studio_services_is_active_show_on_home_sort_order_created_at_idx" ON "studio_services"("is_active", "show_on_home", "sort_order", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "studio_services_image_public_id_idx" ON "studio_services"("image_public_id")`,
  `CREATE TABLE IF NOT EXISTS "studio_about_profile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "services_section_enabled" BOOLEAN NOT NULL DEFAULT true,
    "story_eyebrow" TEXT NOT NULL,
    "story_title" TEXT NOT NULL,
    "story_lead" TEXT NOT NULL,
    "story_body" TEXT NOT NULL,
    "milestones" JSONB,
    "career_roles" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "studio_about_profile_pkey" PRIMARY KEY ("id")
  )`,
  `ALTER TABLE "studio_about_profile" ADD COLUMN IF NOT EXISTS "milestones" JSONB`,
  `ALTER TABLE "studio_about_profile" ADD COLUMN IF NOT EXISTS "career_roles" JSONB`,
  `CREATE TABLE IF NOT EXISTS "studio_team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "role" TEXT NOT NULL DEFAULT '',
    "specialty" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "quote" TEXT,
    "phone" TEXT,
    "instagram" TEXT,
    "location" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT,
    "image_asset_id" TEXT,
    "image_public_id" TEXT,
    "image_format" TEXT,
    "image_bytes" INTEGER,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "studio_team_members_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "studio_team_members_is_active_is_featured_sort_order_created_at_idx" ON "studio_team_members"("is_active", "is_featured" DESC, "sort_order", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "studio_team_members_image_public_id_idx" ON "studio_team_members"("image_public_id")`,
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingContentTableError(err: unknown): boolean {
  const message = (err as Error)?.message ?? String(err);
  return (
    message.includes('42P01') ||
    message.includes('42703') ||
    /relation\s+"?(studio_services|studio_about_profile|studio_team_members)"?\s+does not exist/i.test(
      message,
    ) ||
    /column\s+"?(milestones|career_roles)"?\s+(?:of relation\s+"?studio_about_profile"?\s+)?does not exist/i.test(
      message,
    )
  );
}

function buildDefaultServicesData(studioName: string) {
  return [
    {
      title: 'Wedding Photography',
      description: `Make your special day last a lifetime with ${studioName}'s signature wedding photography. Our dedicated team captures timeless emotions, sacred rituals, and luminous bridal portraits.`,
      showOnHome: true,
      isActive: true,
    },
    {
      title: 'Wedding Cinematography',
      description: `Elevate your wedding memories with cinematic multi-camera storytelling by ${studioName}. We weave heartfelt speeches, movement, and celebration into vivid highlight films.`,
      showOnHome: true,
      isActive: true,
    },
    {
      title: 'Birthday Photography',
      description: `Celebrate meaningful family milestones with ${studioName}'s vibrant birthday photography services crafted around joy, candid laughter, and unforgettable warmth.`,
      showOnHome: true,
      isActive: true,
    },
    {
      title: 'Holud & Mehendi Coverage',
      description:
        'Vivid marigold color palettes, choreographed performances, and joyful family moments framed with crisp natural-light stills and energetic highlight reels.',
      showOnHome: false,
      isActive: true,
    },
    {
      title: 'Reception Photography',
      description:
        'Editorial couple portraits, dramatic banquet lighting coverage, and multi-generation family legacy photographs tailored to evening venues.',
      showOnHome: false,
      isActive: true,
    },
    {
      title: 'Pre-Wedding & Couple Shoot',
      description:
        'Bespoke golden-hour outdoor sessions and curated architectural storytelling across scenic destinations for timeless save-the-date collections.',
      showOnHome: false,
      isActive: true,
    },
  ];
}

function buildDefaultMilestones(): StudioMilestoneItem[] {
  return [
    { label: 'Since', target: 2015, suffix: '', startFrom: 1995 },
    { label: 'Events', target: 1500, suffix: '+', startFrom: 0 },
    { label: 'Photos', target: 80, suffix: 'k+', startFrom: 0 },
    { label: 'Clients', target: 40, suffix: 'k+', startFrom: 0 },
  ];
}

function buildDefaultCareerRoles(studioName = 'Studio'): StudioCareerRoleItem[] {
  return [
    {
      title: 'Lead & Associate Wedding Photographer',
      type: 'Full-Time / Event Crew',
      summary: `Documentary bridal portraiture, cultural ceremony storytelling, candid guest moments, and natural-light composition with ${studioName}.`,
    },
    {
      title: 'Wedding Cinematographer',
      type: 'Full-Time / Project Basis',
      summary:
        'Multi-camera ceremony filmmaking, gimbal movement, audio capture, and narrative highlight shooting.',
    },
    {
      title: 'Photo Retoucher & Highlight Film Editor',
      type: 'Studio / Hybrid',
      summary:
        'True-to-life color grading, digital album curation, and narrative wedding highlight film pacing.',
    },
  ];
}

function normalizeMilestones(raw: unknown): StudioMilestoneItem[] {
  if (!Array.isArray(raw)) {
    return buildDefaultMilestones();
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const targetNum = Number(item.target);
      const startNum = Number(item.startFrom ?? 0);
      return {
        label: typeof item.label === 'string' ? item.label.trim().slice(0, 40) : '',
        target: Number.isFinite(targetNum) ? Math.max(0, Math.round(targetNum)) : 0,
        suffix: typeof item.suffix === 'string' ? item.suffix.trim().slice(0, 16) : '',
        startFrom: Number.isFinite(startNum) ? Math.max(0, Math.round(startNum)) : 0,
      };
    })
    .filter((item) => item.label.length > 0);
}

function normalizeCareerRoles(raw: unknown, studioName: string): StudioCareerRoleItem[] {
  if (!Array.isArray(raw)) {
    return buildDefaultCareerRoles(studioName);
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '',
      type: typeof item.type === 'string' ? item.type.trim().slice(0, 120) : '',
      summary: typeof item.summary === 'string' ? item.summary.trim().slice(0, 500) : '',
    }))
    .filter((item) => item.title.length > 0);
}

function buildDefaultAboutProfileData(studioName: string) {
  return {
    storyEyebrow: 'Est. 2015 • Feni, Bangladesh',
    storyTitle: 'Crafting Heirloom Wedding Stories Across Bangladesh',
    storyLead: `${studioName} is a collective of dedicated photographers, cinematographers, and visual editors devoted to honest emotion, refined light, and true-to-life color.`,
    storyBody:
      'Founded in 2015 in Feni, our studio grew around a simple conviction: wedding photographs should feel effortless, dignified, and deeply personal decades after your celebration. From vibrant Holud evenings to quiet bridal portraits and 4K highlight cinema, our in-house crew works together with calm precision.',
    milestones: buildDefaultMilestones(),
    careerRoles: buildDefaultCareerRoles(studioName),
  };
}

function buildDefaultTeamMembersData(studioName: string) {
  return [
    {
      name: 'Shahadat Hossain',
      subtitle: 'আলোকচিত্রকর • ফটো সাংবাদিক',
      role: 'Founder, Owner & Lead Photographer',
      specialty: 'Photographer • Cinematography • Photo Editor • Event Planner',
      bio: `Founder & principal storyteller at ${studioName} since 2015. Working as a photojournalist, photographer, cinematographer, and photo editor, personally directing bridal portraiture, soulful ceremonies, and heirloom wedding cinema.`,
      quote:
        'Every photograph should feel as honest and moving thirty years from now as the day your vows were spoken.',
      phone: '+880 1855-585601',
      instagram: 'mdshahadathossainbhuiyan',
      location: 'Feni, Bangladesh',
      isFeatured: true,
      imageUrl: null,
      isActive: true,
    },
    {
      name: 'Director of Cinematography',
      subtitle: null,
      role: 'Lead 4K Wedding Filmmaker',
      specialty: 'Multi-Camera Cinema & Audio Capture',
      bio: 'Directs stabilized gimbal movement, natural ceremony audio, and expressive narrative wedding highlight films crafted for lifelong viewing.',
      quote: null,
      phone: null,
      instagram: null,
      location: null,
      isFeatured: false,
      imageUrl: null,
      isActive: true,
    },
    {
      name: 'Senior Ceremony Photographer',
      subtitle: null,
      role: 'Associate Photographer • Holud & Portraits',
      specialty: 'Candid Rituals & Vibrant Event Color',
      bio: 'Specializes in spontaneous family warmth, vibrant Holud and Mehendi storytelling, and poised couple sessions outdoors and in studio.',
      quote: null,
      phone: null,
      instagram: null,
      location: null,
      isFeatured: false,
      imageUrl: null,
      isActive: true,
    },
    {
      name: 'Lead Film Editor & Colorist',
      subtitle: null,
      role: 'Post-Production & Album Curator',
      specialty: 'True-to-Life Grading & Photo-Books',
      bio: 'Shapes cohesive film pacing, skin-tone color fidelity, and gallery-grade digital & print photo-book finishing for every delivered celebration.',
      quote: null,
      phone: null,
      instagram: null,
      location: null,
      isFeatured: false,
      imageUrl: null,
      isActive: true,
    },
  ];
}

function extractLegacyJson(description: string | null | undefined, openTag: string): Record<string, unknown> | null {
  if (!description) return null;
  const start = description.indexOf(openTag);
  if (start === -1) return null;
  const jsonStart = start + openTag.length;
  const end = description.indexOf(CONFIG_CLOSE, jsonStart);
  if (end === -1) return null;
  try {
    return JSON.parse(description.slice(jsonStart, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class StudioContentService {
  private readonly logger = new Logger(StudioContentService.name);
  private tablesPromise: Promise<void> | null = null;
  private seededPromise: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private serializeService(row: RawStudioServiceRow): SerializedStudioService {
    const deliveryUrls = row.image_url
      ? row.image_public_id && row.image_format
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
          }
      : null;

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      imageUrl: row.image_url,
      imageAssetId: row.image_asset_id,
      imagePublicId: row.image_public_id,
      imageFormat: row.image_format,
      imageBytes: row.image_bytes,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      deliveryUrls,
      showOnHome: row.show_on_home,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  private serializeAboutProfile(
    row: RawStudioAboutProfileRow,
    studioName = 'Studio',
  ): SerializedStudioAboutProfile {
    return {
      storyEyebrow: row.story_eyebrow,
      storyTitle: row.story_title,
      storyLead: row.story_lead,
      storyBody: row.story_body,
      milestones: normalizeMilestones(row.milestones),
      careerRoles: normalizeCareerRoles(row.career_roles, studioName),
      servicesSectionEnabled: row.services_section_enabled,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  private serializeTeamMember(row: RawStudioTeamMemberRow): SerializedStudioTeamMember {
    const deliveryUrls = row.image_url
      ? row.image_public_id && row.image_format
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
          }
      : null;

    return {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      role: row.role,
      specialty: row.specialty,
      bio: row.bio,
      quote: row.quote,
      phone: row.phone,
      instagram: row.instagram,
      location: row.location,
      isFeatured: row.is_featured,
      imageUrl: row.image_url,
      imageAssetId: row.image_asset_id,
      imagePublicId: row.image_public_id,
      imageFormat: row.image_format,
      imageBytes: row.image_bytes,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      deliveryUrls,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  private async ensureTablesExist(): Promise<void> {
    if (typeof this.prisma?.$executeRawUnsafe !== 'function') return;
    if (!this.tablesPromise) {
      this.tablesPromise = (async () => {
        for (const stmt of CREATE_STUDIO_CONTENT_DDL) {
          await this.prisma.$executeRawUnsafe(stmt);
        }
      })().catch((err) => {
        this.tablesPromise = null;
        throw err;
      });
    }
    await this.tablesPromise;
  }

  private async withTables<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!isMissingContentTableError(err)) {
        throw err;
      }
      this.logger.warn(
        'Studio content tables missing; creating idempotently (also run prisma migrate deploy).',
      );
      await this.ensureTablesExist();
      return op();
    }
  }

  private async resolveStudioDisplayName(): Promise<string> {
    if (typeof this.prisma?.studioSettings?.findUnique !== 'function') {
      return 'Wedding PhotoArt';
    }
    try {
      const settings = await this.prisma.studioSettings.findUnique({
        where: { id: 'default' },
        select: { name: true },
      });
      return settings?.name?.trim() || 'Wedding PhotoArt';
    } catch {
      return 'Wedding PhotoArt';
    }
  }

  /**
   * Idempotently initializes studio_services, studio_about_profile, and studio_team_members.
   * If customized data already lived in legacy portfolio_events (`studio-services-showcase` or
   * `studio-about-team`), seamlessly migrates its items, story text, and photos into the new
   * tables and archives those legacy containers so their images never appear in Portfolio/Gallery.
   */
  async ensureInitialized(): Promise<void> {
    if (typeof this.prisma?.$queryRawUnsafe !== 'function') return;
    if (!this.seededPromise) {
      this.seededPromise = this.runInitialization().catch((err) => {
        this.seededPromise = null;
        throw err;
      });
    }
    await this.seededPromise;
  }

  private async runInitialization(): Promise<void> {
    const [svcCountRows, profileRows, teamCountRows] = await this.withTables(() =>
      Promise.all([
        this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
          `SELECT COUNT(*) AS "total" FROM "studio_services"`,
        ),
        this.prisma.$queryRawUnsafe<RawStudioAboutProfileRow[]>(
          `SELECT "id", "services_section_enabled", "story_eyebrow", "story_title", "story_lead", "story_body", "milestones", "career_roles", "updated_at" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
        ),
        this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
          `SELECT COUNT(*) AS "total" FROM "studio_team_members"`,
        ),
      ]),
    );

    const hasServices = Number(svcCountRows?.[0]?.total ?? 0n) > 0;
    const hasProfile = (profileRows?.length ?? 0) > 0;
    const hasTeam = Number(teamCountRows?.[0]?.total ?? 0n) > 0;

    if (hasServices && hasProfile && hasTeam) {
      return;
    }

    const studioName = await this.resolveStudioDisplayName();
    let legacyServicesEnabled = true;

    if (!hasServices) {
      const legacyServicesEvent =
        typeof this.prisma?.portfolioEvent?.findUnique === 'function'
          ? await this.prisma.portfolioEvent.findUnique({
              where: { slug: LEGACY_SERVICES_SLUG },
              include: { media: true },
            })
          : null;

      const parsedLegacy = extractLegacyJson(
        legacyServicesEvent?.description,
        SERVICES_CONFIG_OPEN,
      );
      if (parsedLegacy && typeof parsedLegacy.enabled === 'boolean') {
        legacyServicesEnabled = parsedLegacy.enabled;
      }

      const legacyMediaMap = new Map(
        (legacyServicesEvent?.media ?? []).map((m) => [m.id, m]),
      );

      const legacyItems = Array.isArray(parsedLegacy?.items)
        ? parsedLegacy.items.filter(
            (x): x is Record<string, unknown> =>
              Boolean(x && typeof x === 'object' && typeof (x as Record<string, unknown>).title === 'string'),
          )
        : [];

      const itemsToInsert =
        legacyItems.length > 0
          ? legacyItems.map((item) => {
              const mediaId = typeof item.mediaId === 'string' ? item.mediaId : '';
              const linked = mediaId ? legacyMediaMap.get(mediaId) : undefined;
              return {
                title: String(item.title).trim().slice(0, 120),
                description:
                  typeof item.description === 'string' ? item.description.trim().slice(0, 600) : '',
                imageUrl: linked?.secureUrl ?? null,
                imageAssetId: linked?.assetId ?? null,
                imagePublicId: linked?.publicId ?? null,
                imageFormat: linked?.format ?? null,
                imageBytes: linked?.bytes ?? null,
                imageWidth: linked?.width ?? null,
                imageHeight: linked?.height ?? null,
                showOnHome: typeof item.showOnHome === 'boolean' ? item.showOnHome : true,
                isActive: typeof item.isActive === 'boolean' ? item.isActive : true,
              };
            })
          : buildDefaultServicesData(studioName).map((d) => ({
              ...d,
              imageUrl: null,
              imageAssetId: null,
              imagePublicId: null,
              imageFormat: null,
              imageBytes: null,
              imageWidth: null,
              imageHeight: null,
            }));

      for (let i = 0; i < itemsToInsert.length; i += 1) {
        const s = itemsToInsert[i]!;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "studio_services" (
            "title", "description", "image_url", "image_asset_id", "image_public_id",
            "image_format", "image_bytes", "image_width", "image_height",
            "show_on_home", "is_active", "sort_order"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          s.title,
          s.description,
          s.imageUrl,
          s.imageAssetId,
          s.imagePublicId,
          s.imageFormat,
          s.imageBytes,
          s.imageWidth,
          s.imageHeight,
          s.showOnHome,
          s.isActive,
          i,
        );
      }

      if (legacyServicesEvent && typeof this.prisma?.portfolioEvent?.update === 'function') {
        await this.prisma.portfolioEvent.update({
          where: { id: legacyServicesEvent.id },
          data: { status: PortfolioEventStatus.ARCHIVED },
        });
      }
    }

    if (!hasProfile || !hasTeam) {
      const legacyAboutEvent =
        typeof this.prisma?.portfolioEvent?.findUnique === 'function'
          ? await this.prisma.portfolioEvent.findUnique({
              where: { slug: LEGACY_ABOUT_SLUG },
              include: { media: true },
            })
          : null;

      const parsedAbout = extractLegacyJson(legacyAboutEvent?.description, ABOUT_CONFIG_OPEN);
      const defaultsProfile = buildDefaultAboutProfileData(studioName);

      if (!hasProfile) {
        const eyebrow =
          typeof parsedAbout?.storyEyebrow === 'string' && parsedAbout.storyEyebrow.trim()
            ? parsedAbout.storyEyebrow.trim()
            : defaultsProfile.storyEyebrow;
        const title =
          typeof parsedAbout?.storyTitle === 'string' && parsedAbout.storyTitle.trim()
            ? parsedAbout.storyTitle.trim()
            : defaultsProfile.storyTitle;
        const lead =
          typeof parsedAbout?.storyLead === 'string' && parsedAbout.storyLead.trim()
            ? parsedAbout.storyLead.trim()
            : defaultsProfile.storyLead;
        const body =
          typeof parsedAbout?.storyBody === 'string' && parsedAbout.storyBody.trim()
            ? parsedAbout.storyBody.trim()
            : defaultsProfile.storyBody;

        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "studio_about_profile" (
            "id", "services_section_enabled", "story_eyebrow", "story_title", "story_lead", "story_body", "milestones", "career_roles"
          )
          VALUES ('default', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          ON CONFLICT ("id") DO UPDATE SET
            "services_section_enabled" = EXCLUDED."services_section_enabled"`,
          legacyServicesEnabled,
          eyebrow,
          title,
          lead,
          body,
          JSON.stringify(defaultsProfile.milestones),
          JSON.stringify(defaultsProfile.careerRoles),
        );
      }

      if (!hasTeam) {
        const legacyMediaMap = new Map(
          (legacyAboutEvent?.media ?? []).map((m) => [m.id, m]),
        );
        const legacyMembers = Array.isArray(parsedAbout?.members)
          ? parsedAbout.members.filter(
              (x): x is Record<string, unknown> =>
                Boolean(x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string'),
            )
          : [];

        const membersToInsert =
          legacyMembers.length > 0
            ? legacyMembers.map((m) => {
                const mediaId = typeof m.mediaId === 'string' ? m.mediaId : '';
                const linked = mediaId ? legacyMediaMap.get(mediaId) : undefined;
                const fallbackUrl =
                  typeof m.defaultImageUrl === 'string' && m.defaultImageUrl.trim()
                    ? m.defaultImageUrl.trim()
                    : null;
                return {
                  name: String(m.name).trim().slice(0, 120),
                  subtitle: typeof m.subtitle === 'string' ? m.subtitle.trim() || null : null,
                  role: typeof m.role === 'string' ? m.role.trim() : '',
                  specialty: typeof m.specialty === 'string' ? m.specialty.trim() : '',
                  bio: typeof m.bio === 'string' ? m.bio.trim() : '',
                  quote: typeof m.quote === 'string' ? m.quote.trim() || null : null,
                  phone: typeof m.phone === 'string' ? m.phone.trim() || null : null,
                  instagram: typeof m.instagram === 'string' ? m.instagram.trim() || null : null,
                  location: typeof m.location === 'string' ? m.location.trim() || null : null,
                  isFeatured: Boolean(m.isFeatured),
                  imageUrl: linked?.secureUrl ?? fallbackUrl,
                  imageAssetId: linked?.assetId ?? null,
                  imagePublicId: linked?.publicId ?? null,
                  imageFormat: linked?.format ?? null,
                  imageBytes: linked?.bytes ?? null,
                  imageWidth: linked?.width ?? null,
                  imageHeight: linked?.height ?? null,
                  isActive: typeof m.isActive === 'boolean' ? m.isActive : true,
                };
              })
            : buildDefaultTeamMembersData(studioName).map((m) => ({
                ...m,
                imageAssetId: null,
                imagePublicId: null,
                imageFormat: null,
                imageBytes: null,
                imageWidth: null,
                imageHeight: null,
              }));

        for (let i = 0; i < membersToInsert.length; i += 1) {
          const member = membersToInsert[i]!;
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "studio_team_members" (
              "name", "subtitle", "role", "specialty", "bio", "quote", "phone",
              "instagram", "location", "is_featured", "image_url", "image_asset_id",
              "image_public_id", "image_format", "image_bytes", "image_width",
              "image_height", "is_active", "sort_order"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            member.name,
            member.subtitle,
            member.role,
            member.specialty,
            member.bio,
            member.quote,
            member.phone,
            member.instagram,
            member.location,
            member.isFeatured,
            member.imageUrl,
            member.imageAssetId,
            member.imagePublicId,
            member.imageFormat,
            member.imageBytes,
            member.imageWidth,
            member.imageHeight,
            member.isActive,
            i,
          );
        }
      }

      if (legacyAboutEvent && typeof this.prisma?.portfolioEvent?.update === 'function') {
        await this.prisma.portfolioEvent.update({
          where: { id: legacyAboutEvent.id },
          data: { status: PortfolioEventStatus.ARCHIVED },
        });
      }
    }
  }

  private async validateSectionImageInput(
    scope: string,
    input: {
      imageUrl?: string | null;
      imagePublicId?: string | null;
      imageFormat?: string | null;
      imageBytes?: number | null;
      imageVersion?: number | null;
      imageResponseSignature?: string | null;
    },
  ): Promise<void> {
    const cleanUrl = input.imageUrl?.trim();
    if (!cleanUrl) return;

    // Allow bundled studio static asset paths like `/brand/founder-portrait.jpg`
    if (cleanUrl.startsWith('/')) {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(cleanUrl);
    } catch {
      throw new BadRequestException('Image URL must be a valid HTTPS URL or bundled studio path.');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Image URL must use HTTPS.');
    }

    const publicId = input.imagePublicId?.trim();
    if (!publicId) return;

    if (input.imageResponseSignature && input.imageVersion) {
      verifyUploadedAssetMetadata({
        config: loadCloudinaryConfig(),
        eventId: scope,
        publicId,
        resourceType: 'IMAGE',
        format: input.imageFormat ?? 'jpg',
        secureUrl: cleanUrl,
        bytes: input.imageBytes ?? 0,
        version: input.imageVersion,
        responseSignature: input.imageResponseSignature,
      });
    }
  }

  private async cleanupUnusedAssets(publicIds: string[]): Promise<void> {
    const unique = [...new Set(publicIds.filter(Boolean))];
    if (unique.length === 0) return;

    const config = loadCloudinaryConfig();
    if (!getCloudinaryStatus(config).configured) return;

    for (const publicId of unique) {
      try {
        const [svcRows, teamRows, revRows, mediaCount] = await Promise.all([
          this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
            `SELECT COUNT(*) AS "total" FROM "studio_services" WHERE "image_public_id" = $1`,
            publicId,
          ),
          this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
            `SELECT COUNT(*) AS "total" FROM "studio_team_members" WHERE "image_public_id" = $1`,
            publicId,
          ),
          this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
            `SELECT COUNT(*) AS "total" FROM "client_reviews" WHERE "image_public_id" = $1`,
            publicId,
          ).catch(() => [{ total: 0n }]),
          typeof this.prisma?.portfolioMedia?.count === 'function'
            ? this.prisma.portfolioMedia.count({ where: { publicId } })
            : Promise.resolve(0),
        ]);

        const refs =
          Number(svcRows?.[0]?.total ?? 0n) +
          Number(teamRows?.[0]?.total ?? 0n) +
          Number(revRows?.[0]?.total ?? 0n) +
          mediaCount;

        if (refs === 0) {
          await destroyCloudinaryAsset(config, publicId, 'IMAGE');
        }
      } catch (err) {
        this.logger.warn(
          `Skipped Cloudinary asset cleanup for ${publicId}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }
  }

  getUploadStatus() {
    return getCloudinaryStatus(loadCloudinaryConfig());
  }

  signServiceUpload(dto: SignStudioContentUploadDto) {
    return createSignedUploadPayload({
      config: loadCloudinaryConfig(),
      eventId: SERVICES_CLOUDINARY_SCOPE,
      resourceType: 'IMAGE',
      format: dto.format,
      bytes: dto.bytes,
    });
  }

  signTeamUpload(dto: SignStudioContentUploadDto) {
    return createSignedUploadPayload({
      config: loadCloudinaryConfig(),
      eventId: TEAM_CLOUDINARY_SCOPE,
      resourceType: 'IMAGE',
      format: dto.format,
      bytes: dto.bytes,
    });
  }

  async listPublicServices() {
    await this.ensureInitialized();
    const [profileRows, rows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ services_section_enabled: boolean }>>(
        `SELECT "services_section_enabled" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
      ),
      this.prisma.$queryRawUnsafe<RawStudioServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS_SQL}
         FROM "studio_services"
         WHERE "is_active" = true
         ORDER BY "show_on_home" DESC, "sort_order" ASC, "created_at" ASC`,
      ),
    ]);

    return {
      enabled: profileRows?.[0]?.services_section_enabled ?? true,
      items: rows.map((r) => this.serializeService(r)),
    };
  }

  async listAdminServices() {
    await this.ensureInitialized();
    const [profileRows, rows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ services_section_enabled: boolean }>>(
        `SELECT "services_section_enabled" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
      ),
      this.prisma.$queryRawUnsafe<RawStudioServiceRow[]>(
        `SELECT ${SERVICE_COLUMNS_SQL}
         FROM "studio_services"
         ORDER BY "sort_order" ASC, "created_at" ASC`,
      ),
    ]);

    return {
      enabled: profileRows?.[0]?.services_section_enabled ?? true,
      items: rows.map((r) => this.serializeService(r)),
      uploadStatus: this.getUploadStatus(),
    };
  }

  async saveServicesBulk(dto: SaveStudioServicesBulkDto) {
    await this.ensureInitialized();

    for (const item of dto.items) {
      await this.validateSectionImageInput(SERVICES_CLOUDINARY_SCOPE, item);
    }

    const previousRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; image_public_id: string | null }>
    >(`SELECT "id", "image_public_id" FROM "studio_services"`);
    const prevPublicIds = previousRows
      .map((r) => r.image_public_id)
      .filter((p): p is string => Boolean(p));

    await this.prisma.$executeRawUnsafe(
      `UPDATE "studio_about_profile"
       SET "services_section_enabled" = $1, "updated_at" = NOW()
       WHERE "id" = 'default'`,
      dto.enabled,
    );

    const keptIds: string[] = [];

    for (let idx = 0; idx < dto.items.length; idx += 1) {
      const item = dto.items[idx]!;
      const title = item.title.trim();
      const description = item.description?.trim() ?? '';
      const imageUrl = item.imageUrl?.trim() || null;
      const imageAssetId = imageUrl ? item.imageAssetId?.trim() || null : null;
      const imagePublicId = imageUrl ? item.imagePublicId?.trim() || null : null;
      const imageFormat = imageUrl
        ? item.imageFormat?.trim().toLowerCase().replace(/^\./, '') || null
        : null;
      const imageBytes = imageUrl ? item.imageBytes ?? null : null;
      const imageWidth = imageUrl ? item.imageWidth ?? null : null;
      const imageHeight = imageUrl ? item.imageHeight ?? null : null;
      const showOnHome = item.showOnHome ?? true;
      const isActive = item.isActive ?? true;

      if (item.id && UUID_REGEX.test(item.id)) {
        const updated = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "studio_services"
           SET
             "title" = $2,
             "description" = $3,
             "image_url" = $4,
             "image_asset_id" = $5,
             "image_public_id" = $6,
             "image_format" = $7,
             "image_bytes" = $8,
             "image_width" = $9,
             "image_height" = $10,
             "show_on_home" = $11,
             "is_active" = $12,
             "sort_order" = $13,
             "updated_at" = NOW()
           WHERE "id" = $1::uuid
           RETURNING "id"`,
          item.id,
          title,
          description,
          imageUrl,
          imageAssetId,
          imagePublicId,
          imageFormat,
          imageBytes,
          imageWidth,
          imageHeight,
          showOnHome,
          isActive,
          idx,
        );
        if (updated[0]?.id) {
          keptIds.push(updated[0].id);
          continue;
        }
      }

      const inserted = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "studio_services" (
          "title", "description", "image_url", "image_asset_id", "image_public_id",
          "image_format", "image_bytes", "image_width", "image_height",
          "show_on_home", "is_active", "sort_order"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING "id"`,
        title,
        description,
        imageUrl,
        imageAssetId,
        imagePublicId,
        imageFormat,
        imageBytes,
        imageWidth,
        imageHeight,
        showOnHome,
        isActive,
        idx,
      );
      if (inserted[0]?.id) {
        keptIds.push(inserted[0].id);
      }
    }

    if (keptIds.length > 0) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "studio_services" WHERE NOT ("id" = ANY($1::uuid[]))`,
        keptIds,
      );
    }

    const nextPublicIds = new Set(
      dto.items.map((i) => i.imagePublicId?.trim()).filter((p): p is string => Boolean(p)),
    );
    const removedPublicIds = prevPublicIds.filter((pid) => !nextPublicIds.has(pid));
    if (removedPublicIds.length > 0) {
      void this.cleanupUnusedAssets(removedPublicIds);
    }

    return this.listAdminServices();
  }

  async resetServicesDefaults() {
    await this.ensureInitialized();
    const studioName = await this.resolveStudioDisplayName();
    const defaults = buildDefaultServicesData(studioName);
    return this.saveServicesBulk({
      enabled: true,
      items: defaults.map((d) => ({
        title: d.title,
        description: d.description,
        showOnHome: d.showOnHome,
        isActive: d.isActive,
        imageUrl: null,
      })),
    });
  }

  async listPublicAboutTeam() {
    await this.ensureInitialized();
    const [profileRows, memberRows, studioName] = await Promise.all([
      this.withTables(() =>
        this.prisma.$queryRawUnsafe<RawStudioAboutProfileRow[]>(
          `SELECT "id", "services_section_enabled", "story_eyebrow", "story_title", "story_lead", "story_body", "milestones", "career_roles", "updated_at" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
        ),
      ),
      this.withTables(() =>
        this.prisma.$queryRawUnsafe<RawStudioTeamMemberRow[]>(
          `SELECT ${TEAM_COLUMNS_SQL}
           FROM "studio_team_members"
           WHERE "is_active" = true
           ORDER BY "is_featured" DESC, "sort_order" ASC, "created_at" ASC`,
        ),
      ),
      this.resolveStudioDisplayName(),
    ]);

    const fallbackProfile = buildDefaultAboutProfileData(studioName);

    return {
      profile: profileRows[0]
        ? this.serializeAboutProfile(profileRows[0], studioName)
        : {
            ...fallbackProfile,
            servicesSectionEnabled: true,
            updatedAt: new Date().toISOString(),
          },
      members: memberRows.map((r) => this.serializeTeamMember(r)),
    };
  }

  async listAdminAboutTeam() {
    await this.ensureInitialized();
    const [profileRows, memberRows, studioName] = await Promise.all([
      this.withTables(() =>
        this.prisma.$queryRawUnsafe<RawStudioAboutProfileRow[]>(
          `SELECT "id", "services_section_enabled", "story_eyebrow", "story_title", "story_lead", "story_body", "milestones", "career_roles", "updated_at" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
        ),
      ),
      this.withTables(() =>
        this.prisma.$queryRawUnsafe<RawStudioTeamMemberRow[]>(
          `SELECT ${TEAM_COLUMNS_SQL}
           FROM "studio_team_members"
           ORDER BY "sort_order" ASC, "created_at" ASC`,
        ),
      ),
      this.resolveStudioDisplayName(),
    ]);

    const fallbackProfile = buildDefaultAboutProfileData(studioName);

    return {
      profile: profileRows[0]
        ? this.serializeAboutProfile(profileRows[0], studioName)
        : {
            ...fallbackProfile,
            servicesSectionEnabled: true,
            updatedAt: new Date().toISOString(),
          },
      members: memberRows.map((r) => this.serializeTeamMember(r)),
      uploadStatus: this.getUploadStatus(),
    };
  }

  async saveAboutTeamBulk(dto: SaveAboutTeamBulkDto) {
    await this.ensureInitialized();

    for (const member of dto.members) {
      await this.validateSectionImageInput(TEAM_CLOUDINARY_SCOPE, member);
    }

    const [prevRows, existingProfileRows, studioName] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ id: string; image_public_id: string | null }>>(
        `SELECT "id", "image_public_id" FROM "studio_team_members"`,
      ),
      this.prisma.$queryRawUnsafe<Array<{ milestones: unknown; career_roles: unknown }>>(
        `SELECT "milestones", "career_roles" FROM "studio_about_profile" WHERE "id" = 'default' LIMIT 1`,
      ),
      this.resolveStudioDisplayName(),
    ]);
    const prevPublicIds = prevRows
      .map((r) => r.image_public_id)
      .filter((p): p is string => Boolean(p));

    const defaults = buildDefaultAboutProfileData(studioName);
    const milestonesToSave =
      dto.profile.milestones !== undefined
        ? normalizeMilestones(dto.profile.milestones)
        : existingProfileRows[0]?.milestones !== undefined &&
            existingProfileRows[0]?.milestones !== null
          ? normalizeMilestones(existingProfileRows[0].milestones)
          : defaults.milestones;
    const careerRolesToSave =
      dto.profile.careerRoles !== undefined
        ? normalizeCareerRoles(dto.profile.careerRoles, studioName)
        : existingProfileRows[0]?.career_roles !== undefined &&
            existingProfileRows[0]?.career_roles !== null
          ? normalizeCareerRoles(existingProfileRows[0].career_roles, studioName)
          : defaults.careerRoles;

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "studio_about_profile" (
        "id", "story_eyebrow", "story_title", "story_lead", "story_body", "milestones", "career_roles", "updated_at"
      )
      VALUES ('default', $1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "story_eyebrow" = EXCLUDED."story_eyebrow",
        "story_title" = EXCLUDED."story_title",
        "story_lead" = EXCLUDED."story_lead",
        "story_body" = EXCLUDED."story_body",
        "milestones" = EXCLUDED."milestones",
        "career_roles" = EXCLUDED."career_roles",
        "updated_at" = NOW()`,
      dto.profile.storyEyebrow.trim(),
      dto.profile.storyTitle.trim(),
      dto.profile.storyLead.trim(),
      dto.profile.storyBody.trim(),
      JSON.stringify(milestonesToSave),
      JSON.stringify(careerRolesToSave),
    );

    const hasExplicitFeatured = dto.members.some((m) => m.isFeatured && (m.isActive ?? true));
    const keptIds: string[] = [];

    for (let idx = 0; idx < dto.members.length; idx += 1) {
      const m = dto.members[idx]!;
      const imageUrl = m.imageUrl?.trim() || null;
      const imageAssetId = imageUrl ? m.imageAssetId?.trim() || null : null;
      const imagePublicId = imageUrl ? m.imagePublicId?.trim() || null : null;
      const imageFormat = imageUrl
        ? m.imageFormat?.trim().toLowerCase().replace(/^\./, '') || null
        : null;
      const imageBytes = imageUrl ? m.imageBytes ?? null : null;
      const imageWidth = imageUrl ? m.imageWidth ?? null : null;
      const imageHeight = imageUrl ? m.imageHeight ?? null : null;
      const isFeatured = hasExplicitFeatured ? Boolean(m.isFeatured) : idx === 0;
      const isActive = m.isActive ?? true;

      if (m.id && UUID_REGEX.test(m.id)) {
        const updated = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "studio_team_members"
           SET
             "name" = $2,
             "subtitle" = $3,
             "role" = $4,
             "specialty" = $5,
             "bio" = $6,
             "quote" = $7,
             "phone" = $8,
             "instagram" = $9,
             "location" = $10,
             "is_featured" = $11,
             "image_url" = $12,
             "image_asset_id" = $13,
             "image_public_id" = $14,
             "image_format" = $15,
             "image_bytes" = $16,
             "image_width" = $17,
             "image_height" = $18,
             "is_active" = $19,
             "sort_order" = $20,
             "updated_at" = NOW()
           WHERE "id" = $1::uuid
           RETURNING "id"`,
          m.id,
          m.name.trim(),
          m.subtitle?.trim() || null,
          m.role?.trim() ?? '',
          m.specialty?.trim() ?? '',
          m.bio?.trim() ?? '',
          m.quote?.trim() || null,
          m.phone?.trim() || null,
          m.instagram?.trim().replace(/^@+/, '') || null,
          m.location?.trim() || null,
          isFeatured,
          imageUrl,
          imageAssetId,
          imagePublicId,
          imageFormat,
          imageBytes,
          imageWidth,
          imageHeight,
          isActive,
          idx,
        );
        if (updated[0]?.id) {
          keptIds.push(updated[0].id);
          continue;
        }
      }

      const inserted = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "studio_team_members" (
          "name", "subtitle", "role", "specialty", "bio", "quote", "phone",
          "instagram", "location", "is_featured", "image_url", "image_asset_id",
          "image_public_id", "image_format", "image_bytes", "image_width",
          "image_height", "is_active", "sort_order"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING "id"`,
        m.name.trim(),
        m.subtitle?.trim() || null,
        m.role?.trim() ?? '',
        m.specialty?.trim() ?? '',
        m.bio?.trim() ?? '',
        m.quote?.trim() || null,
        m.phone?.trim() || null,
        m.instagram?.trim().replace(/^@+/, '') || null,
        m.location?.trim() || null,
        isFeatured,
        imageUrl,
        imageAssetId,
        imagePublicId,
        imageFormat,
        imageBytes,
        imageWidth,
        imageHeight,
        isActive,
        idx,
      );
      if (inserted[0]?.id) {
        keptIds.push(inserted[0].id);
      }
    }

    if (keptIds.length > 0) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "studio_team_members" WHERE NOT ("id" = ANY($1::uuid[]))`,
        keptIds,
      );
    }

    const nextPublicIds = new Set(
      dto.members.map((m) => m.imagePublicId?.trim()).filter((p): p is string => Boolean(p)),
    );
    const removedPublicIds = prevPublicIds.filter((pid) => !nextPublicIds.has(pid));
    if (removedPublicIds.length > 0) {
      void this.cleanupUnusedAssets(removedPublicIds);
    }

    return this.listAdminAboutTeam();
  }

  async resetAboutTeamDefaults() {
    await this.ensureInitialized();
    const studioName = await this.resolveStudioDisplayName();
    return this.saveAboutTeamBulk({
      profile: buildDefaultAboutProfileData(studioName),
      members: buildDefaultTeamMembersData(studioName),
    });
  }
}
