import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/client.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  it('deduplicates recipients when dispatching role notifications and resolves alerts by dedupe key', async () => {
    const executeMock = vi.fn().mockResolvedValue(1);
    const findUsersMock = vi.fn().mockResolvedValue([{ id: 'user-owner-1' }, { id: 'user-owner-1' }, { id: 'user-acc-1' }]);

    const prismaMock = {
      $executeRawUnsafe: executeMock,
      $queryRawUnsafe: vi.fn(),
      user: { findMany: findUsersMock },
    };

    const service = new NotificationsService(prismaMock as never);

    await service.notifyRoles([UserRole.OWNER, UserRole.ACCOUNTANT], {
      category: 'PAYMENT',
      severity: 'ACTION',
      title: 'Verify Payment (BKG-2026-0001)',
      body: 'BKASH Tk 10,000 awaiting verification',
      href: '/admin/bookings/b-1',
      entityType: 'PaymentEntry',
      entityId: 'pay-1',
      dedupeKey: 'PAYMENT_PENDING:pay-1',
    });

    // Duplicate user-owner-1 is collapsed -> exactly 2 inserts
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0][1]).toBe('user-owner-1');
    expect(executeMock.mock.calls[1][1]).toBe('user-acc-1');
    expect(executeMock.mock.calls[0][9]).toBe('PAYMENT_PENDING:pay-1');

    await service.resolveByDedupeKeys(['PAYMENT_PENDING:pay-1']);
    expect(executeMock).toHaveBeenCalledTimes(3);
  });

  it('throws NotFoundException if markAsRead targets a notification not owned by caller', async () => {
    const queryMock = vi.fn().mockResolvedValue([]);
    const prismaMock = {
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: queryMock,
    };

    const service = new NotificationsService(prismaMock as never);
    await expect(
      service.markAsRead('user-other', '00000000-0000-4000-8000-000000000001'),
    ).rejects.toThrow(NotFoundException);
  });

  it('skips escalation queries when listForUser is called with sync=false and batches sync inserts', async () => {
    const executeMock = vi.fn().mockResolvedValue(1);
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total_unread: 0n, urgent_unread: 0n }]);
    const bookingFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'bkg-1',
        reference: 'BKG-2026-0001',
        eventTitle: 'Wedding Shoot',
        clientName: 'Amina',
      },
    ]);
    const sessionFindManyMock = vi.fn().mockResolvedValue([]);
    const deliverableFindManyMock = vi.fn().mockResolvedValue([]);
    const paymentFindManyMock = vi.fn().mockResolvedValue([]);

    const prismaMock = {
      $executeRawUnsafe: executeMock,
      $queryRawUnsafe: queryMock,
      booking: { findMany: bookingFindManyMock },
      eventSession: { findMany: sessionFindManyMock },
      deliverable: { findMany: deliverableFindManyMock },
      paymentEntry: { findMany: paymentFindManyMock },
    };

    const service = new NotificationsService(prismaMock as never);

    const fastRes = await service.listForUser('user-1', UserRole.OWNER, {
      sync: false,
    });
    expect(fastRes.unreadCount).toBe(0);
    expect(bookingFindManyMock).not.toHaveBeenCalled();

    await service.syncEscalationsForUser('user-1', UserRole.OWNER);
    expect(bookingFindManyMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(String(executeMock.mock.calls[0][0])).toContain('jsonb_to_recordset');
  });
});
