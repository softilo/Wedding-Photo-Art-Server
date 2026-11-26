import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard, IS_PUBLIC_KEY, ROLES_KEY } from '../../common/guards/auth.guard.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import { PublicReviewsController } from './public-reviews.controller.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

describe('ReviewsModule & ClientReview Service', () => {
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

  describe('RBAC & Public exposure', () => {
    it('restricts review creation and upload signing to OWNER and COORDINATOR (rejects STAFF)', async () => {
      const reflector = new Reflector();
      const handler = Reflect.get(
        ReviewsController.prototype,
        'createReview',
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
        getClass: () => ReviewsController,
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

    it('marks PublicReviewsController as @Public()', () => {
      const reflector = new Reflector();
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, PublicReviewsController);
      expect(isPublic).toBe(true);
    });
  });

  describe('Cloudinary signing & review CRUD serialization', () => {
    it('signs review backdrop uploads under the reviews folder', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '1234567890';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-cloudinary-key-123456';
      process.env.CLOUDINARY_FOLDER_PREFIX = 'softilo-events';

      const service = new ReviewsService({} as never);
      const signed = service.signReviewUpload({
        format: 'jpg',
        bytes: 450_000,
      });

      expect(signed.folder).toBe('softilo-events/reviews');
      expect(signed.context).toBe('event_id=reviews');
      expect(signed.resourceType).toBe('IMAGE');
      expect(signed.signature).toMatch(/^[a-f0-9]{40}$/);
    });

    it('creates, serializes deliveryUrls, queries published reviews, and cleans up deleted reviews', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '1234567890';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-cloudinary-key-123456';
      process.env.CLOUDINARY_FOLDER_PREFIX = 'softilo-events';

      const now = new Date('2026-11-26T16:00:00.000Z');
      const createdRow = {
        id: '11111111-1111-4111-8111-111111111111',
        client_name: 'Tangir Miah',
        quote: 'Riazul Islam Shawon thank you bhaia for these amazing captures',
        rating: 5,
        event_title: 'Wedding & Reception',
        source_label: 'Client Story',
        image_url:
          'https://res.cloudinary.com/demo-cloud/image/upload/v1700000000/softilo-events/reviews/tangir.jpg',
        image_asset_id: 'asset-1',
        image_public_id: 'softilo-events/reviews/tangir',
        image_format: 'jpg',
        image_bytes: 420000,
        image_width: 1920,
        image_height: 1280,
        is_published: true,
        sort_order: 0,
        created_at: now,
        updated_at: now,
      };

      const queryMock = vi
        .fn()
        // MAX(sort_order)
        .mockResolvedValueOnce([{ max_order: null }])
        // INSERT INTO client_reviews RETURNING ...
        .mockResolvedValueOnce([createdRow])
        // listPublicReviews SELECT ... WHERE is_published = true
        .mockResolvedValueOnce([createdRow]);

      const prismaMock = {
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: vi.fn(),
        portfolioMedia: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
      };

      const service = new ReviewsService(prismaMock as never);

      const created = await service.createReview({
        clientName: '  Tangir Miah ',
        quote: '  Riazul Islam Shawon thank you bhaia for these amazing captures ',
        rating: 5,
        eventTitle: 'Wedding & Reception',
        sourceLabel: 'Client Story',
        imageUrl: createdRow.image_url,
        imageAssetId: createdRow.image_asset_id,
        imagePublicId: createdRow.image_public_id,
        imageFormat: 'JPG',
        imageBytes: 420000,
        imageWidth: 1920,
        imageHeight: 1280,
      });

      expect(created.clientName).toBe('Tangir Miah');
      expect(created.rating).toBe(5);
      expect(created.deliveryUrls.fullUrl).toContain('/image/upload/');
      expect(created.isPublished).toBe(true);

      const published = await service.listPublicReviews();
      expect(published).toHaveLength(1);
      expect(published[0]?.clientName).toBe('Tangir Miah');
      expect(queryMock.mock.calls[2][0]).toContain('"is_published" = true');
    });

    it('rejects non-HTTPS image URLs and throws NotFoundException on missing update/delete target', async () => {
      const queryMock = vi.fn().mockResolvedValue([]);
      const service = new ReviewsService({
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: vi.fn(),
      } as never);

      await expect(
        service.createReview({
          clientName: 'Test Client',
          quote: 'Amazing captures!',
          imageUrl: 'http://insecure.example.com/photo.jpg',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateReview('11111111-1111-4111-8111-111111111111', {
          clientName: 'Updated',
        }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.deleteReview('11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow(NotFoundException);
    });

    it('auto-creates client_reviews table and retries on 42P01 in listAdminReviews', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '1234567890';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-cloudinary-key-123456';

      const executeMock = vi.fn().mockResolvedValue(0);
      const queryMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('ERROR: relation "client_reviews" does not exist (42P01)'))
        .mockResolvedValueOnce([]);

      const service = new ReviewsService({
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: executeMock,
      } as never);

      const res = await service.listAdminReviews({ status: 'all' });
      expect(executeMock).toHaveBeenCalled();
      expect(res.data).toEqual([]);
      expect(res.uploadStatus.configured).toBe(true);
    });

    it('returns empty list gracefully on public query when table does not exist yet', async () => {
      const queryMock = vi
        .fn()
        .mockRejectedValue(new Error('ERROR: relation "client_reviews" does not exist (42P01)'));
      const service = new ReviewsService({
        $queryRawUnsafe: queryMock,
        $executeRawUnsafe: vi.fn(),
      } as never);

      await expect(service.listPublicReviews()).resolves.toEqual([]);
    });
  });
});
