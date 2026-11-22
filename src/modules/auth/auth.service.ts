import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SOFTILO_DEFAULT_BRANDING } from '../../common/branding/branding-defaults.js';
import { verifyPasswordAsync } from '../../common/crypto/password.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import { StudioService } from '../studio/studio.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly studioService?: StudioService,
  ) {}

  private async getStudioSummary() {
    if (this.studioService) {
      const summary = await this.studioService.getCachedStudioSettingsSummary();
      return {
        name: summary.publicBranding.displayName,
        timezone: summary.publicBranding.timezone,
        currency: summary.publicBranding.currency,
      };
    }
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: { name: true, timezone: true, currency: true },
    });
    return {
      name: studio?.name || SOFTILO_DEFAULT_BRANDING.displayName,
      timezone: studio?.timezone ?? 'Asia/Dhaka',
      currency: studio?.currency ?? 'BDT',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive || !(await verifyPasswordAsync(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException('Authentication secret is not configured');
    }

    const [accessToken, studio] = await Promise.all([
      Promise.resolve(
        signAuthToken(
          {
            sub: user.id,
            email: user.email,
            role: user.role,
          },
          secret,
        ),
      ),
      this.getStudioSummary(),
    ]);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      },
      studio,
    };
  }

  async getProfile(userId: string) {
    const [user, studio] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      }),
      this.getStudioSummary(),
    ]);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      ...user,
      studio,
    };
  }
}
