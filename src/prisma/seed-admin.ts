import { StudioService } from '../modules/studio/studio.service.js';

export interface SeedDefaultAdminResult {
  createdSettings: boolean;
  studioName: string;
  adminEmail: string;
  role: string;
}

const VALID_STUDIO_PRESETS = [
  'wedding-photography',
  'corporate',
  'neutral',
] as const;
type StudioPreset = (typeof VALID_STUDIO_PRESETS)[number];

const REQUIRED_SEED_ENV_KEYS = [
  'SEED_STUDIO_NAME',
  'SEED_STUDIO_PRESET',
  'SEED_STUDIO_TIMEZONE',
  'SEED_STUDIO_CURRENCY',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_NAME',
  'SEED_ADMIN_PASSWORD',
] as const;

function requireSeedEnv(
  env: NodeJS.ProcessEnv,
): Record<(typeof REQUIRED_SEED_ENV_KEYS)[number], string> {
  const missing = REQUIRED_SEED_ENV_KEYS.filter(
    (key) => !env[key] || env[key].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required seed environment variables: ${missing.join(', ')}. Configure them in .env.seed or process.env.`,
    );
  }

  return {
    SEED_STUDIO_NAME: env.SEED_STUDIO_NAME!.trim(),
    SEED_STUDIO_PRESET: env.SEED_STUDIO_PRESET!.trim(),
    SEED_STUDIO_TIMEZONE: env.SEED_STUDIO_TIMEZONE!.trim(),
    SEED_STUDIO_CURRENCY: env.SEED_STUDIO_CURRENCY!.trim().toUpperCase(),
    SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL!.trim().toLowerCase(),
    SEED_ADMIN_NAME: env.SEED_ADMIN_NAME!.trim(),
    SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD!.trim(),
  };
}

export async function seedDefaultAdmin(
  studioService: StudioService,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedDefaultAdminResult> {
  const seedEnv = requireSeedEnv(env);

  if (seedEnv.SEED_ADMIN_PASSWORD.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');
  }

  if (
    !VALID_STUDIO_PRESETS.includes(seedEnv.SEED_STUDIO_PRESET as StudioPreset)
  ) {
    throw new Error(
      `Invalid SEED_STUDIO_PRESET "${seedEnv.SEED_STUDIO_PRESET}". Expected one of: ${VALID_STUDIO_PRESETS.join(', ')}.`,
    );
  }

  const result = await studioService.initializeStudio({
    name: seedEnv.SEED_STUDIO_NAME,
    preset: seedEnv.SEED_STUDIO_PRESET as StudioPreset,
    timezone: seedEnv.SEED_STUDIO_TIMEZONE,
    currency: seedEnv.SEED_STUDIO_CURRENCY,
    ownerEmail: seedEnv.SEED_ADMIN_EMAIL,
    ownerName: seedEnv.SEED_ADMIN_NAME,
    ownerPassword: seedEnv.SEED_ADMIN_PASSWORD,
  });

  return {
    createdSettings: result.createdSettings,
    studioName: result.studio.displayName,
    adminEmail: result.owner.email,
    role: result.owner.role,
  };
}
