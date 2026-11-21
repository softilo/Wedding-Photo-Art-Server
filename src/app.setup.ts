import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { validateEnvironment } from './common/config/env.validation.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';

export function configureApp(app: INestApplication): void {
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter?.getInstance?.();
  if (typeof instance?.disable === 'function') {
    instance.disable('x-powered-by');
  }
  if (typeof instance?.set === 'function') {
    instance.set('trust proxy', 1);
  }

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const allowedOrigins =
    configuredOrigins.length > 0
      ? configuredOrigins
      : process.env.NODE_ENV === 'production'
        ? []
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      optionsSuccessStatus: 204,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
}

/**
 * Validates required environment variables and instantiates a fully configured NestJS app.
 */
export async function createConfiguredApp(): Promise<INestApplication> {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  configureApp(app);
  return app;
}
