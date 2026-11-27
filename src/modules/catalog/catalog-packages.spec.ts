import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard, ROLES_KEY } from '../../common/guards/auth.guard.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

describe('Catalog Packages (Line Items, Cover Image & Isolated Signing)', () => {
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

  it('restricts package cover upload signing to OWNER/COORDINATOR and signs under packages folder', async () => {
    const reflector = new Reflector();
    const handler = Reflect.get(
      CatalogController.prototype,
      'signPackageCoverUpload',
    ) as (...args: unknown[]) => unknown;
    expect(reflector.get<string[]>(ROLES_KEY, handler)).toEqual(['OWNER', 'COORDINATOR']);

    process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters-long';
    const staffToken = signAuthToken(
      { sub: 'staff-1', email: 'staff@softilo.local', role: 'STAFF' },
      process.env.AUTH_SECRET,
    );
    const guard = new AuthGuard(reflector, {
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
    } as never);

    await expect(
      guard.canActivate({
        getHandler: () => handler,
        getClass: () => CatalogController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: `Bearer ${staffToken}` } }),
        }),
      } as never),
    ).rejects.toThrow(new ForbiddenException('Insufficient role permissions for this action'));

    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = '1234567890';
    process.env.CLOUDINARY_API_SECRET = 'super-secret-cloudinary-key-123456';
    process.env.CLOUDINARY_FOLDER_PREFIX = 'softilo/weddingPhotoArt';

    const service = new CatalogService({} as never);
    const signed = service.signPackageCoverUpload({ format: 'jpg', bytes: 420_000 });
    expect(signed.folder).toBe('softilo/weddingPhotoArt/packages');
    expect(signed.context).toBe('event_id=packages');
  });

  it('creates a package with itemized lines + cover image and auto-generates unique slugs on duplicate titles', async () => {
    const takenSlugs = new Set<string>();
    const findUniqueMock = vi.fn(async ({ where }: { where: { slug: string } }) =>
      takenSlugs.has(where.slug) ? { id: 'existing-id' } : null,
    );
    const createMock = vi.fn(async ({ data }: { data: { slug: string } }) => {
      takenSlugs.add(data.slug);
      return {
        id: `pkg-${takenSlugs.size}`,
        eventTypeId: null,
        eventType: null,
        name: 'Signature Wedding Story',
        slug: data.slug,
        description: 'Full day photo & cinema bundle',
        basePricePoisha: 5000000n,
        coverImageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/packages/cover.jpg',
        coverImageAssetId: 'a1',
        coverImagePublicId: 'softilo/packages/cover',
        coverImageFormat: 'jpg',
        coverImageBytes: 240000,
        coverImageWidth: 1600,
        coverImageHeight: 1066,
        isActive: true,
        isPublished: true,
        items: [
          {
            id: 'item-1',
            serviceItemId: null,
            description: 'Senior Photographer',
            quantity: 2,
            unitPricePoisha: 1500000n,
          },
          {
            id: 'item-2',
            serviceItemId: null,
            description: 'Flush-Mount Photo Book',
            quantity: 1,
            unitPricePoisha: 500000n,
          },
        ],
      };
    });

    const service = new CatalogService({
      package: { create: createMock, findUnique: findUniqueMock },
    } as never);

    const created = await service.createPackage({
      name: 'Signature Wedding Story',
      description: 'Full day photo & cinema bundle',
      basePricePoisha: 5000000,
      coverImageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/packages/cover.jpg',
      coverImageAssetId: 'a1',
      coverImagePublicId: 'softilo/packages/cover',
      coverImageFormat: 'jpg',
      coverImageBytes: 240000,
      coverImageWidth: 1600,
      coverImageHeight: 1066,
      isPublished: true,
      items: [
        { description: 'Senior Photographer', quantity: 2, unitPricePoisha: 1500000 },
        { description: 'Flush-Mount Photo Book', quantity: 1, unitPricePoisha: 500000 },
      ],
    });

    expect(created.slug).toBe('signature-wedding-story');
    expect(created.coverImageUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/packages/cover.jpg',
    );
    expect(created.coverDeliveryUrls?.coverUrl).toContain('c_limit,w_1200');
    expect(created.items).toHaveLength(2);
    expect(created.basePricePoisha).toBe(5000000);

    // Duplicate title auto-generates -2 cleanly
    const duplicateTitle = await service.createPackage({
      name: 'Signature Wedding Story',
      basePricePoisha: 5000000,
    });
    expect(duplicateTitle.slug).toBe('signature-wedding-story-2');

    // Concurrent P2002 race also auto-recovers with next unique suffix
    createMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    const raceRecovered = await service.createPackage({
      name: 'Signature Wedding Story',
      basePricePoisha: 5000000,
    });
    expect(raceRecovered.slug).toBe('signature-wedding-story-4');

    // Non-ASCII title still generates valid lowercase URL slug
    const bengaliPkg = await service.createPackage({
      name: 'রয়েল ওয়েডিং প্যাকেজ',
      basePricePoisha: 7500000,
    });
    expect(bengaliPkg.slug).toBe('package');
  });
});
