import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StudioService } from '../modules/studio/studio.service.js';
import { seedDefaultAdmin } from './seed-admin.js';
import { loadSeedEnvironment } from './seed-env.js';

describe('seedDefaultAdmin', () => {
  it('initializes studio settings and OWNER account strictly from env values', async () => {
    const initializeStudio = vi.fn().mockResolvedValue({
      createdSettings: true,
      studio: { displayName: 'Apex Events' },
      owner: {
        id: 'user-1',
        email: 'owner@apex.test',
        name: 'Apex Owner',
        role: 'OWNER',
        isActive: true,
      },
    });

    const studioService = { initializeStudio } as unknown as StudioService;

    const result = await seedDefaultAdmin(studioService, {
      SEED_STUDIO_NAME: 'Apex Events',
      SEED_STUDIO_PRESET: 'corporate',
      SEED_STUDIO_TIMEZONE: 'UTC',
      SEED_STUDIO_CURRENCY: 'usd',
      SEED_ADMIN_EMAIL: '  OWNER@Apex.test ',
      SEED_ADMIN_NAME: 'Apex Owner',
      SEED_ADMIN_PASSWORD: 'StrongSeedPassword1!',
    });

    expect(initializeStudio).toHaveBeenCalledWith({
      name: 'Apex Events',
      preset: 'corporate',
      timezone: 'UTC',
      currency: 'USD',
      ownerEmail: 'owner@apex.test',
      ownerName: 'Apex Owner',
      ownerPassword: 'StrongSeedPassword1!',
    });
    expect(result).toEqual({
      createdSettings: true,
      studioName: 'Apex Events',
      adminEmail: 'owner@apex.test',
      role: 'OWNER',
    });
  });

  it('rejects missing seed environment variables instead of falling back to defaults', async () => {
    const studioService = {} as StudioService;

    await expect(seedDefaultAdmin(studioService, {})).rejects.toThrow(
      'Missing required seed environment variables: SEED_STUDIO_NAME, SEED_STUDIO_PRESET, SEED_STUDIO_TIMEZONE, SEED_STUDIO_CURRENCY, SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_PASSWORD',
    );
  });

  it('rejects short SEED_ADMIN_PASSWORD and invalid SEED_STUDIO_PRESET', async () => {
    const studioService = {} as StudioService;
    const baseEnv = {
      SEED_STUDIO_NAME: 'Studio',
      SEED_STUDIO_PRESET: 'wedding-photography',
      SEED_STUDIO_TIMEZONE: 'Asia/Dhaka',
      SEED_STUDIO_CURRENCY: 'BDT',
      SEED_ADMIN_EMAIL: 'owner@example.com',
      SEED_ADMIN_NAME: 'Owner',
      SEED_ADMIN_PASSWORD: 'short',
    };

    await expect(seedDefaultAdmin(studioService, baseEnv)).rejects.toThrow(
      'SEED_ADMIN_PASSWORD must be at least 8 characters.',
    );

    await expect(
      seedDefaultAdmin(studioService, {
        ...baseEnv,
        SEED_ADMIN_PASSWORD: 'StrongSeedPassword1!',
        SEED_STUDIO_PRESET: 'invalid-preset',
      }),
    ).rejects.toThrow('Invalid SEED_STUDIO_PRESET');
  });

  it('loads variables from .env with optional .env.seed fallback while preserving shell overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'softilo-seed-env-'));
    try {
      writeFileSync(
        join(dir, '.env'),
        'DATABASE_URL="postgresql://localhost:5432/db"\nSEED_ADMIN_EMAIL="owner@env.test"\n',
      );
      writeFileSync(
        join(dir, '.env.seed'),
        'SEED_ADMIN_EMAIL="fallback@seed.test"\nSEED_ADMIN_PASSWORD="SeedPassword123!"\n',
      );

      const targetEnv: NodeJS.ProcessEnv = {
        SEED_ADMIN_NAME: 'Shell Override Owner',
      };

      loadSeedEnvironment(dir, targetEnv);

      expect(targetEnv.SEED_ADMIN_EMAIL).toBe('owner@env.test');
      expect(targetEnv.SEED_ADMIN_PASSWORD).toBe('SeedPassword123!');
      expect(targetEnv.SEED_ADMIN_NAME).toBe('Shell Override Owner');
      expect(targetEnv.DATABASE_URL).toBe('postgresql://localhost:5432/db');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
