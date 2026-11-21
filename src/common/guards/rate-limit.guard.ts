import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

export const RATE_LIMIT_KEY = 'rateLimitPolicy';

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

/**
 * Applies a sliding/fixed per-IP rate limit policy to a controller route.
 */
export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } satisfies RateLimitPolicy);

interface RateBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly reflector: Reflector) {}

  private resolveClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
      return forwarded.split(',')[0].trim();
    }
    if (
      Array.isArray(forwarded) &&
      forwarded.length > 0 &&
      forwarded[0].trim().length > 0
    ) {
      return forwarded[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  private pruneExpired(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<
      RateLimitPolicy | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!policy || policy.limit <= 0 || policy.windowMs <= 0) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (req?.method === 'OPTIONS') {
      return true;
    }
    const res = http.getResponse<Response>();
    const now = Date.now();
    this.pruneExpired(now);

    const routeId = `${context.getClass().name}.${context.getHandler().name}`;
    const clientIp = this.resolveClientIp(req);
    const key = `${routeId}:${clientIp}`;

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      return true;
    }

    if (existing.count >= policy.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );
      if (typeof res?.setHeader === 'function') {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
      throw new HttpException(
        `Too many requests. Please try again in ${retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
    return true;
  }
}
