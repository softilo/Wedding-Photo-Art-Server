import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('sync') sync?: string,
  ) {
    return this.notificationsService.listForUser(actor.userId, actor.role, {
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === 'true',
      sync: sync !== 'false',
    });
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Patch(':id/read')
  markRead(
    @CurrentActor() actor: RequestActor,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(actor.userId, id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Post('read-all')
  markAllRead(@CurrentActor() actor: RequestActor) {
    return this.notificationsService.markAllAsRead(actor.userId);
  }
}
