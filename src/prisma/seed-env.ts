import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Loads seed credentials from `.env` and optionally `.env.seed` (or `SEED_ENV_FILE`),
 * while preserving any explicit shell environment overrides.
 */
export function loadSeedEnvironment(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  const seedFile = env.SEED_ENV_FILE?.trim() || '.env.seed';
  loadDotenv({
    path: [resolve(cwd, '.env'), resolve(cwd, seedFile)],
    processEnv: env,
    quiet: true,
  });
}
