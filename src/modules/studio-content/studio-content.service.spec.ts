import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard, IS_PUBLIC_KEY, ROLES_KEY } from '../../common/guards/auth.guard.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { PublicStudioContentController } from './public-studio-content.controller.js';
import { StudioContentController } from './studio-content.controller.js';
import { StudioContentService } from './studio-content.service.js';

describe('StudioContentModule (Services & About Team DB + Gallery Isolation)', () => {
  const originalCloudinaryEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER_PREFIX: process.env.CLOUDINARY_FOLDER_PREFIX,
  };

  afterEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = originalCloudinaryEnv.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_API_KEY = originalCloudinaryEnv.CLOUDINARY_API_KEY;
    process.env.CLOUDINARY_API_SECRET = originalCloudinaryEnv.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_FOLDER_PREFIX = originalCloudinaryEnv.CLOUDINARY_FOLDER_PREFIX;
  });

  describe('RBAC & Public Endpoints', () => {
    it('restricts saveServicesBulk to OWNER/COORDINATOR and rejects STAFF', async () => {
      const reflector = new Reflector();
      const handler = Reflect.get(
        StudioContentController.prototype,
        'saveServicesBulk',
      ) as (...args: unknown[]) => unknown;
      const requiredRoles = reflector.get<string[]>(ROLES_KEY, handler);
      expect(requiredRoles).toEqual(['OWNER', 'COORDINATOR']);

      process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters-long';
      const staffToken = signAuthToken(
        { sub: 'staff-1', email: 'staff@softilo.local', role: 'STAFF' },
        process.env.AUTH_SECRET,
      );

      const mockPrisma = {
        user: {
          findUnique: async () => ({
            id: 'staff-1',
            email: 'staff@softilo.local',
            role: 'STAFF',
            isActive: true,
          }),
        },
        studioSettings: {
          findUnique: async () => ({ timezone: 'Asia/Dhaka', currency: 'BDT' }),
        },
      };

      const guard = new AuthGuard(reflector, mockPrisma as never);
      const mockCtx = {
        getHandler: () => handler,
        getClass: () => StudioContentController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: `Bearer ${staffToken}` } }),
        }),
      };

      await expect(guard.canActivate(mockCtx as never)).rejects.toThrow(
        new ForbiddenException('Insufficient role permissions for this action'),
      );
    });

    it('marks PublicStudioContentController as @Public()', () => {
      const reflector = new Reflector();
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, PublicStudioContentController);
      expect(isPublic).toBe(true);
    });
  });

  describe('Isolated Cloudinary Upload Signing', () => {
    it('signs Services and Team uploads in isolated Cloudinary folders separate from portfolio/gallery', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '1234567890';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-cloudinary-key-123456';
      process.env.CLOUDINARY_FOLDER_PREFIX = 'softilo-events';

      const service = new StudioContentService({} as never);
      const srvSigned = service.signServiceUpload({ format: 'jpg', bytes: 420_000 });
      const teamSigned = service.signTeamUpload({ format: 'png', bytes: 380_000 });

      expect(srvSigned.folder).toBe('softilo-events/services');
      expect(srvSigned.context).toBe('event_id=services');
      expect(teamSigned.folder).toBe('softilo-events/team');
      expect(teamSigned.context).toBe('event_id=team');
    });
  });

  describe('Gallery & Portfolio Exclusion Invariants', () => {
    it('excludes system section slugs (services, about-team, editorial, hero) from public gallery and portfolio events', async () => {
      const findManyMediaMock = vi.fn().mockResolvedValue([]);
      const countMediaMock = vi.fn().mockResolvedValue(0);
      const findManyEventsMock = vi.fn().mockResolvedValue([]);
      const countEventsMock = vi.fn().mockResolvedValue(0);

      const prismaMock = {
        portfolioMedia: {
          findMany: findManyMediaMock,
          count: countMediaMock,
        },
        portfolioEvent: {
          findMany: findManyEventsMock,
          count: countEventsMock,
        },
      };

      const catalog = new CatalogService(prismaMock as never);

      await catalog.listPublicGalleryMedia('IMAGE');
      const publicGalleryWhere = findManyMediaMock.mock.calls[0]?.[0]?.where as {
        event?: { slug?: { notIn?: string[] } };
      };
      expect(publicGalleryWhere?.event?.slug?.notIn).toEqual(
        expect.arrayContaining([
          'studio-hero-slider',
          'studio-editorial-grid',
          'studio-services-showcase',
          'studio-about-team',
        ]),
      );

      await catalog.listGalleryMedia('IMAGE');
      const adminGalleryWhere = findManyMediaMock.mock.calls[1]?.[0]?.where as {
        event?: { slug?: { notIn?: string[] } };
      };
      expect(adminGalleryWhere?.event?.slug?.notIn).toEqual(
        expect.arrayContaining([
          'studio-hero-slider',
          'studio-editorial-grid',
          'studio-services-showcase',
          'studio-about-team',
        ]),
      );

      await catalog.listPublicPortfolioEvents({});
      const publicEventsWhere = findManyEventsMock.mock.calls[0]?.[0]?.where as {
        slug?: { notIn?: string[] };
      };
      expect(publicEventsWhere?.slug?.notIn).toEqual(
        expect.arrayContaining([
          'studio-media-gallery',
          'studio-hero-slider',
          'studio-editorial-grid',
          'studio-services-showcase',
          'studio-about-team',
        ]),
      );
    });

    it('migrates legacy studio-services-showcase & studio-about-team events into DB tables and archives them', async () => {
      const executeMock = vi.fn().mockResolvedValue(1);
      const queryMock = vi
        .fn()
        // COUNT studio_services -> 0
        .mockResolvedValueOnce([{ total: 0n }])
        // SELECT studio_about_profile -> []
        .mockResolvedValueOnce([])
        // COUNT studio_team_members -> 0
        .mockResolvedValueOnce([{ total: 0n }]);

      const eventFindUniqueMock = vi
        .fn()
        .mockResolvedValueOnce({
          id: 'ev-srv-1',
          slug: 'studio-services-showcase',
          description:
            '<!-- WPA_SERVICES_CONFIG:{"enabled":true,"items":[{"id":"s1","title":"Custom Wedding Film","description":"Cinematic story","mediaId":"m-srv-1","showOnHome":true,"isActive":true}]} -->',
          media: [
            {
              id: 'm-srv-1',
              secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/services/srv.jpg',
              assetId: 'a1',
              publicId: 'softilo/services/srv',
              format: 'jpg',
              bytes: 120000,
              width: 1600,
              height: 1066,
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'ev-team-1',
          slug: 'studio-about-team',
          description:
            '<!-- WPA_ABOUT_TEAM_CONFIG:{"storyEyebrow":"Est. 2015","storyTitle":"Our Story","storyLead":"Lead summary","storyBody":"Body copy","members":[{"id":"t1","name":"Shahadat Hossain","role":"Founder","specialty":"Photo","bio":"Bio","isFeatured":true,"mediaId":"m-team-1","isActive":true}]} -->',
          media: [
            {
              id: 'm-team-1',
              secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/team/founder.jpg',
              assetId: 'a2',
              publicId: 'softilo/team/founder',
              format: 'jpg',
              bytes: 95000,
              width: 1000,
              height: 1250,
            },
          ],
        });

      const eventUpdateMock = vi.fn().mockResolvedValue({});

      const prismaMock = {
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: executeMock,
        studioSettings: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Wedding PhotoArt' }),
        },
        portfolioEvent: {
          findUnique: eventFindUniqueMock,
          update: eventUpdateMock,
        },
      };

      const service = new StudioContentService(prismaMock as never);
      await service.ensureInitialized();

      // Inserted migrated service, profile, and migrated team member
      expect(executeMock).toHaveBeenCalledTimes(3);
      expect(executeMock.mock.calls[0]?.[1]).toBe('Custom Wedding Film');
      expect(executeMock.mock.calls[0]?.[3]).toBe(
        'https://res.cloudinary.com/demo/image/upload/v1/services/srv.jpg',
      );
      expect(executeMock.mock.calls[2]?.[1]).toBe('Shahadat Hossain');
      expect(executeMock.mock.calls[2]?.[11]).toBe(
        'https://res.cloudinary.com/demo/image/upload/v1/team/founder.jpg',
      );

      // Archived both legacy container events so their portfolio_media never appears in gallery
      expect(eventUpdateMock).toHaveBeenCalledTimes(2);
      expect(eventUpdateMock).toHaveBeenNthCalledWith(1, {
        where: { id: 'ev-srv-1' },
        data: { status: 'ARCHIVED' },
      });
      expect(eventUpdateMock).toHaveBeenNthCalledWith(2, {
        where: { id: 'ev-team-1' },
        data: { status: 'ARCHIVED' },
      });
    });

    it('persists milestones & careerRoles in DB and avoids static frontend image paths in default team reset', async () => {
      const executeMock = vi.fn().mockResolvedValue(1);
      const insertedMemberIds: string[] = [];
      const queryMock = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) AS "total"')) return [{ total: 1n }];
        if (sql.includes('SELECT "id", "services_section_enabled"')) {
          return [
            {
              id: 'default',
              services_section_enabled: true,
              story_eyebrow: 'Est. 2015',
              story_title: 'Our Craft',
              story_lead: 'Lead copy',
              story_body: 'Body copy',
              milestones: [{ label: 'Years', target: 10, suffix: '+', startFrom: 0 }],
              career_roles: [
                { title: 'Colorist', type: 'Full-Time', summary: 'DaVinci Resolve grading' },
              ],
              updated_at: new Date('2026-11-27T10:00:00Z'),
            },
          ];
        }
        if (sql.includes('SELECT "id", "image_public_id"')) return [];
        if (sql.includes('SELECT "milestones", "career_roles"')) {
          return [{ milestones: null, career_roles: null }];
        }
        if (sql.includes('INSERT INTO "studio_team_members"')) {
          const id = `member-uuid-${insertedMemberIds.length + 1}`;
          insertedMemberIds.push(id);
          return [{ id }];
        }
        return [];
      });

      const prismaMock = {
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: executeMock,
        studioSettings: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Softilo Studio' }),
        },
      };

      const service = new StudioContentService(prismaMock as never);
      const result = await service.resetAboutTeamDefaults();

      // Default team member no longer points to static /brand/founder-portrait.jpg frontend asset
      const memberInsertCalls = queryMock.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO "studio_team_members"'),
      );
      expect(memberInsertCalls.length).toBeGreaterThanOrEqual(1);
      expect(memberInsertCalls[0]?.[11]).toBeNull();

      // Profile includes DB-backed milestones & careerRoles
      expect(result.profile.milestones).toEqual([
        { label: 'Years', target: 10, suffix: '+', startFrom: 0 },
      ]);
      expect(result.profile.careerRoles).toEqual([
        { title: 'Colorist', type: 'Full-Time', summary: 'DaVinci Resolve grading' },
      ]);
    });
  });
});
