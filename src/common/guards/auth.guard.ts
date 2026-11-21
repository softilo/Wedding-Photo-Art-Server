import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/client.js';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { verifyAuthToken } from '../crypto/jwt.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export interface RequestActor {
  userId: string;
  email: string;
  role: UserRole;
  timezone: string;
  currency: string;
}

export type AuthenticatedRequest = Request & {
  actor?: RequestActor;
};

export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestActor => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.actor) {
      throw new UnauthorizedException('Authenticated actor context missing');
    }
    return req.actor;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.method === 'OPTIONS') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException(
        'Authentication secret is not configured',
      );
    }

    const payload = verifyAuthToken(token, secret);
    if (!payload) {
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }

    const [user, studio] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, isActive: true },
      }),
      this.prisma.studioSettings.findUnique({
        where: { id: 'default' },
        select: { timezone: true, currency: true },
      }),
    ]);

    if (!user || !user.isActive) {
      throw new ForbiddenException('Active team account required');
    }

    req.actor = {
      userId: user.id,
      email: user.email,
      role: user.role,
      timezone: studio?.timezone ?? 'Asia/Dhaka',
      currency: studio?.currency ?? 'BDT',
    };

    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (
      requiredRoles &&
      requiredRoles.length > 0 &&
      !requiredRoles.includes(user.role)
    ) {
      throw new ForbiddenException(
        'Insufficient role permissions for this action',
      );
    }

    return true;
  }
}
