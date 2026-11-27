import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, ROLES_KEY } from '../../common/guards/auth.guard.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import {
  buildCloudinaryDeliveryUrls,
  createSignedUploadPayload,
  loadCloudinaryConfig,
} from '../../common/cloudinary/cloudinary.util.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

describe('Portfolio Showcase Events & Cloudinary Upload Workflow', () => {
  describe('RBAC: Non-admin cannot sign uploads or mutate showcase events', () => {
    it('requires OWNER or COORDINATOR on upload-signature endpoint and rejects STAFF with 403', async () => {
      const reflector = new Reflector();
      const handler = Reflect.get(
        CatalogController.prototype,
        'signPortfolioUpload',
      ) as (...args: unknown[]) => unknown;
      const requiredRoles = reflector.get<string[]>(ROLES_KEY, handler);
      expect(requiredRoles).toEqual(['OWNER', 'COORDINATOR']);

      process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters-long';
      const staffToken = signAuthToken(
        { sub: 'staff-user-1', email: 'staff@softilo.local', role: 'STAFF' },
        process.env.AUTH_SECRET,
      );

      const mockPrisma = {
        user: {
          findUnique: async () => ({
            id: 'staff-user-1',
            email: 'staff@softilo.local',
            role: 'STAFF',
            isActive: true,
          }),
        },
        studioSettings: {
          findUnique: async () => ({
            timezone: 'Asia/Dhaka',
            currency: 'BDT',
          }),
        },
      };

      const guard = new AuthGuard(reflector, mockPrisma as never);
      const mockContext = {
        getHandler: () => handler,
        getClass: () => CatalogController,
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: `Bearer ${staffToken}` },
          }),
        }),
      };

      await expect(guard.canActivate(mockContext as never)).rejects.toThrow(
        new ForbiddenException('Insufficient role permissions for this action'),
      );
    });
  });

  describe('Cloudinary Upload Signing & Credential Validation', () => {
    it('reports missing environment variable names without exposing any values', () => {
      const config = loadCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: 'my-cloud',
        CLOUDINARY_API_KEY: '',
        CLOUDINARY_API_SECRET: 'replace-with-cloudinary-api-secret',
      });

      try {
        createSignedUploadPayload({
          config,
          eventId: 'ev-1',
          resourceType: 'IMAGE',
          format: 'jpg',
          bytes: 500000,
        });
        expect.fail('Should have thrown for missing credentials');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const res = (err as BadRequestException).getResponse() as {
          code: string;
          message: string;
          missingVariables: string[];
        };
        expect(res.code).toBe('MISSING_CLOUDINARY_CREDENTIALS');
        expect(res.missingVariables).toEqual([
          'CLOUDINARY_API_KEY',
          'CLOUDINARY_API_SECRET',
        ]);
        expect(res.message).toContain('CLOUDINARY_API_KEY');
        expect(res.message).toContain('CLOUDINARY_API_SECRET');
      }
    });

    it('signs scoped upload parameters without exposing apiSecret and enforces size/format limits', () => {
      const config = loadCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: 'demo-studio-cloud',
        CLOUDINARY_API_KEY: '123456789012345',
        CLOUDINARY_API_SECRET: 'super-secret-value-never-exposed',
        CLOUDINARY_FOLDER_PREFIX: 'softilo/portfolio',
      });

      const signed = createSignedUploadPayload({
        config,
        eventId: 'ev-101',
        resourceType: 'IMAGE',
        format: 'webp',
        bytes: 2 * 1024 * 1024,
        nowUnixSeconds: 1700000000,
      });

      expect(signed.uploadUrl).toBe(
        'https://api.cloudinary.com/v1_1/demo-studio-cloud/image/upload',
      );
      expect(signed.folder).toBe('softilo/portfolio/ev-101');
      expect(signed.signature).toMatch(/^[a-f0-9]{40}$/);
      expect(JSON.stringify(signed)).not.toContain('super-secret-value-never-exposed');

      // Unsupported format rejected
      expect(() =>
        createSignedUploadPayload({
          config,
          eventId: 'ev-101',
          resourceType: 'IMAGE',
          format: 'exe',
          bytes: 1024,
        }),
      ).toThrow(/Unsupported image format/);

      // Oversized file rejected
      expect(() =>
        createSignedUploadPayload({
          config,
          eventId: 'ev-101',
          resourceType: 'IMAGE',
          format: 'jpg',
          bytes: 50 * 1024 * 1024,
        }),
      ).toThrow(/exceeds maximum allowed limit/);
    });
  });

  describe('Idempotent Upload Registration, Cover Enforcement, and Public Listing Filtering', () => {
    it('prevents duplicate media records when retrying the same assetId or publicId', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-studio-cloud';
      process.env.CLOUDINARY_API_KEY = '123456789012345';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-value';
      process.env.CLOUDINARY_FOLDER_PREFIX = 'softilo/portfolio';

      const store: Array<{
        id: string;
        eventId: string;
        assetId: string;
        publicId: string;
        resourceType: string;
        format: string;
        secureUrl: string;
        bytes: number;
        width: number | null;
        height: number | null;
        durationSeconds: number | null;
        caption: string | null;
        altText: string | null;
        displayOrder: number;
        status: string;
        errorMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      const mockTx = {
        portfolioMedia: {
          findFirst: async ({ where }: { where: { eventId: string; OR?: Array<{ assetId?: string; publicId?: string }> } }) => {
            if (where.OR) {
              return (
                store.find(
                  (m) =>
                    m.eventId === where.eventId &&
                    (m.assetId === where.OR?.[0]?.assetId ||
                      m.publicId === where.OR?.[1]?.publicId),
                ) ?? null
              );
            }
            return store[store.length - 1] ?? null;
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const item: Record<string, unknown> & {
              id: string;
              createdAt: Date;
              updatedAt: Date;
            } = {
              id: `media-${store.length + 1}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...data,
            };
            store.push(item as (typeof store)[number]);
            return item;
          },
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const idx = store.findIndex((m) => m.id === where.id);
            const current = (store[idx] ?? {}) as Record<string, unknown>;
            store[idx] = {
              ...current,
              ...data,
              updatedAt: new Date(),
            } as (typeof store)[number];
            return store[idx];
          },
        },
        portfolioEvent: {
          update: async () => ({}),
        },
      };

      const mockPrisma = {
        portfolioEvent: {
          findUnique: async () => ({
            id: 'ev-1',
            title: 'Royal Holud Night',
            status: 'DRAFT',
            coverMediaId: null,
          }),
        },
        $transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      };

      const service = new CatalogService(mockPrisma as never);

      const first = await service.registerPortfolioMedia('ev-1', {
        assetId: 'cld-asset-999',
        publicId: 'softilo/portfolio/ev-1/holud-cover',
        resourceType: 'IMAGE',
        format: 'jpg',
        secureUrl:
          'https://res.cloudinary.com/demo-studio-cloud/image/upload/v1/softilo/portfolio/ev-1/holud-cover.jpg',
        bytes: 850000,
        width: 2400,
        height: 1600,
        status: 'READY',
      });

      expect(first.idempotentReplay).toBe(false);
      expect(store).toHaveLength(1);

      // Retry with same assetId/publicId
      const retry = await service.registerPortfolioMedia('ev-1', {
        assetId: 'cld-asset-999',
        publicId: 'softilo/portfolio/ev-1/holud-cover',
        resourceType: 'IMAGE',
        format: 'jpg',
        secureUrl:
          'https://res.cloudinary.com/demo-studio-cloud/image/upload/v1/softilo/portfolio/ev-1/holud-cover.jpg',
        bytes: 850000,
        width: 2400,
        height: 1600,
        caption: 'Updated caption on retry',
        status: 'READY',
      });

      expect(retry.idempotentReplay).toBe(true);
      expect(store).toHaveLength(1);
      expect(retry.media.caption).toBe('Updated caption on retry');
    });

    it('blocks publishing a draft without a READY cover image and excludes DRAFT/ARCHIVED from public queries', async () => {
      let currentStatus = 'DRAFT';
      let currentMedia: Array<{
        id: string;
        eventId: string;
        assetId: string;
        publicId: string;
        resourceType: 'IMAGE' | 'VIDEO';
        format: string;
        secureUrl: string;
        bytes: number;
        width: number | null;
        height: number | null;
        durationSeconds: number | null;
        caption: string | null;
        altText: string | null;
        displayOrder: number;
        status: 'PROCESSING' | 'READY' | 'FAILED';
        errorMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      const mockPrisma: {
        portfolioEvent: {
          findUnique: () => Promise<Record<string, unknown>>;
          update: (args: { data: { status: string; publishedAt?: Date } }) => Promise<Record<string, unknown>>;
          findMany: (args: { where?: { status?: string } }) => Promise<unknown[]>;
          count?: (args: { where?: { status?: string } }) => Promise<number>;
          findFirst?: (args: { where?: { status?: string } }) => Promise<Record<string, unknown> | null>;
        };
        $transaction?: (cb: (tx: never) => Promise<unknown>) => Promise<unknown>;
      } = {
        portfolioEvent: {
          findUnique: async () => ({
            id: 'ev-1',
            eventTypeId: null,
            title: 'Draft Showcase',
            slug: 'draft-showcase',
            eventDate: null,
            description: null,
            location: null,
            status: currentStatus,
            coverMediaId: null,
            sortOrder: 0,
            publishedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            coverMedia: null,
            media: currentMedia,
          }),
          update: async ({ data }: { data: { status: string; coverMediaId?: string } }) => {
            currentStatus = data.status;
            return {
              id: 'ev-1',
              eventTypeId: null,
              title: 'Draft Showcase',
              slug: 'draft-showcase',
              eventDate: null,
              description: null,
              location: null,
              status: currentStatus,
              coverMediaId: data.coverMediaId ?? null,
              sortOrder: 0,
              publishedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
              coverMedia: currentMedia[0] ?? null,
              media: currentMedia,
            };
          },
          findMany: async ({ where }: { where?: { status?: string } }) => {
            if (where?.status === 'PUBLISHED' && currentStatus !== 'PUBLISHED') {
              return [];
            }
            return [];
          },
          count: async ({ where }: { where?: { status?: string } }) => {
            if (where?.status === 'PUBLISHED' && currentStatus !== 'PUBLISHED') {
              return 0;
            }
            return 0;
          },
          findFirst: async ({ where }: { where?: { status?: string } }) => {
            if (where?.status === 'PUBLISHED' && currentStatus !== 'PUBLISHED') {
              return null;
            }
            return null;
          },
        },
        $transaction: async (cb: (tx: never) => Promise<unknown>) => cb(mockPrisma as never),
      };

      const service = new CatalogService(mockPrisma as never);

      // 1. Cannot publish without a READY cover image
      await expect(service.publishPortfolioEvent('ev-1')).rejects.toThrow(
        new BadRequestException(
          'Cannot publish showcase event: at least one READY cover image is required before publishing.',
        ),
      );

      // 2. Draft does not appear in public listing or public slug lookup
      const publicListWhileDraft = await service.listPublicPortfolioEvents({});
      expect(publicListWhileDraft.data).toHaveLength(0);
      await expect(service.getPublicPortfolioEventBySlug('draft-showcase')).rejects.toThrow(
        NotFoundException,
      );

      // 3. Add a READY cover image -> publish succeeds
      currentMedia = [
        {
          id: 'm-1',
          eventId: 'ev-1',
          assetId: 'asset-1',
          publicId: 'softilo/portfolio/ev-1/cover',
          resourceType: 'IMAGE',
          format: 'jpg',
          secureUrl:
            'https://res.cloudinary.com/demo/image/upload/v1/softilo/portfolio/ev-1/cover.jpg',
          bytes: 500000,
          width: 1920,
          height: 1080,
          durationSeconds: null,
          caption: 'Main stage',
          altText: 'Main stage cover',
          displayOrder: 0,
          status: 'READY',
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const published = await service.publishPortfolioEvent('ev-1');
      expect(published.status).toBe('PUBLISHED');
      expect(published.coverMediaId).toBe('m-1');
    });

    it('generates lightweight JPEG poster URLs for videos so video bytes are not downloaded before Play', () => {
      const urls = buildCloudinaryDeliveryUrls({
        secureUrl:
          'https://res.cloudinary.com/demo/video/upload/v1700000/softilo/portfolio/ev-1/highlight.mp4',
        publicId: 'softilo/portfolio/ev-1/highlight',
        resourceType: 'VIDEO',
        format: 'mp4',
      });

      expect(urls.posterUrl).toBe(
        'https://res.cloudinary.com/demo/video/upload/so_auto,f_jpg,q_auto,c_limit,w_960/v1700000/softilo/portfolio/ev-1/highlight.jpg',
      );
      expect(urls.fullUrl).toBe(
        'https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1700000/softilo/portfolio/ev-1/highlight.mp4',
      );
    });

    it('auto-generates unique portfolio slugs from title when slug is omitted or collides', async () => {
      const taken = new Set<string>(['ayesha-rafiq-wedding']);
      const create = vi.fn(async ({ data }: { data: { slug: string; title: string } }) => {
        taken.add(data.slug);
        return {
          id: `ev-${taken.size}`,
          eventTypeId: null,
          eventType: null,
          title: data.title,
          slug: data.slug,
          eventDate: null,
          description: null,
          location: null,
          status: 'DRAFT',
          coverMediaId: null,
          coverMedia: null,
          sortOrder: 0,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          media: [],
        };
      });

      const service = new CatalogService({
        portfolioEvent: {
          findUnique: async ({ where }: { where: { slug: string } }) =>
            taken.has(where.slug) ? { id: 'taken' } : null,
          create,
        },
      } as never);

      const second = await service.createPortfolioEvent({
        title: 'Ayesha & Rafiq Wedding',
      });
      expect(second.slug).toBe('ayesha-rafiq-wedding-2');

      // System slugs must never be shadowed by user event titles
      const reservedAttempt = await service.createPortfolioEvent({
        title: 'Studio Hero Slider',
      });
      expect(reservedAttempt.slug).toBe('studio-hero-slider-2');
    });
  });
});
