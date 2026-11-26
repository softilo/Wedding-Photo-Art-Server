import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InquiriesModule } from './modules/inquiries/inquiries.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ScheduleModule } from './modules/schedule/schedule.module.js';
import { StudioContentModule } from './modules/studio-content/studio-content.module.js';
import { StudioModule } from './modules/studio/studio.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObserveModule.forRoot({
      enabled: Boolean(process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET),
      appKey: process.env.OBSERVE_APP_KEY,
      appSecret: process.env.OBSERVE_APP_SECRET,
      serviceId: 'event-management-server',
    }),
    PrismaModule,
    NotificationsModule,
    AuthModule,
    StudioModule,
    CatalogModule,
    StudioContentModule,
    ReviewsModule,
    InquiriesModule,
    QuotesModule,
    PaymentsModule,
    ScheduleModule,
    BookingsModule,
    OperationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
