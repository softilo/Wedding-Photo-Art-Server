# Deploying to Vercel

This server is configured for **Vercel Functions** via pre-compiled TypeScript output (`dist/`) and an ESM serverless entrypoint (`api/index.mjs`). Compiling with `tsc` (`pnpm exec prisma generate && pnpm run build`) preserves NestJS decorator metadata (`emitDecoratorMetadata`) and ESM `.js` imports before Vercel packages `api/index.mjs`.

## Architecture Overview

- `vercel.json`: Configures `pnpm install --frozen-lockfile`, runs `pnpm exec prisma generate && pnpm run build`, uses `public/` as an empty static output directory (`public/.gitkeep`), sets `maxDuration: 30` on `api/index.mjs`, and rewrites all incoming paths (`/(.*)`) to `/api?__vercel_path=$1`.
- `api/index.mjs`: Thin Vercel Node.js Function handler importing `handleVercelRequest` from `../dist/serverless.js`.
- `src/serverless.ts`: Lazily initializes and caches the NestJS Express adapter (`app.init()` without `app.listen()`), preloads `pdfkit` standard font CJS modules so Vercel traces them cleanly, restores original request paths from `__vercel_path`, and awaits response completion (`finish` / `close`).
- `package.json`: Pins `"engines": { "node": "24.x" }` (required by Prisma 7 CLI and `@nestjs/observe`).
- `src/prisma/prisma.service.ts`: Caps `pg.Pool` size conservatively in serverless mode (`PG_POOL_MAX`, defaulting to `5` when `VERCEL` is set).

## Required Vercel Environment Variables

Set these in **Vercel Project Settings -> Environment Variables** (Production / Preview as needed):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string. For serverless traffic, use a pooled connection URL (e.g. Neon pooler, Supabase pooler, or PgBouncer) with TLS enabled (`?sslmode=require`). |
| `AUTH_SECRET` | **Yes** | Random secret of at least 16 characters (32+ recommended) for signing JWTs and calendar feed tokens. |
| `CORS_ORIGINS` | **Yes (for browser clients)** | Comma-separated allowed frontend origins (e.g. `https://studio.example.com`). In production (`NODE_ENV=production`), CORS is closed by default unless `CORS_ORIGINS` is configured. |
| `PG_POOL_MAX` | Optional | Maximum `pg.Pool` connections per Vercel function instance (default: `5` on Vercel, `10` locally). |
| `CLOUDINARY_CLOUD_NAME` | For portfolio uploads | See [docs/EXTERNAL_SERVICES.md](./EXTERNAL_SERVICES.md). |
| `CLOUDINARY_API_KEY` | For portfolio uploads | See [docs/EXTERNAL_SERVICES.md](./EXTERNAL_SERVICES.md). |
| `CLOUDINARY_API_SECRET` | For portfolio uploads | Backend only. Never expose to frontend bundles. |
| `CLOUDINARY_UPLOAD_PRESET` | Optional | Optional signed Cloudinary preset. |
| `CLOUDINARY_FOLDER_PREFIX` | Optional | Defaults to `softilo/portfolio`; customize per white-label tenant. |
| `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` | Optional | Enables `@nestjs/observe` telemetry when both are set. |

## Database Migrations & Initial Seed

Do **not** run database migrations or seeding inside HTTP requests. Run them from your CI/CD pipeline or local terminal (Node.js `>=20.19` / `24.x`) against a **direct** (non-pooled) PostgreSQL URL before serving production traffic:

```bash
# Apply committed Prisma migrations
DATABASE_URL="<direct-postgres-url>" pnpm exec prisma migrate deploy

# Seed initial StudioSettings and OWNER account (idempotent; preserves existing owner edits)
DATABASE_URL="<direct-postgres-url>" \
  SEED_STUDIO_NAME="Your Studio Name" \
  SEED_ADMIN_EMAIL="owner@example.com" \
  SEED_ADMIN_PASSWORD="replace-with-strong-password" \
  pnpm run db:seed
```

## Deploying

1. Ensure `CORS_ORIGINS`, `DATABASE_URL`, and `AUTH_SECRET` are configured in Vercel.
2. Connect the repository in the Vercel Dashboard (Vercel automatically reads `vercel.json`) or run `vercel deploy` with the Vercel CLI.
3. Verify `GET /` returns `Hello World!` (`200 OK`) and `GET /public/branding` returns your studio branding projection (`200 OK`).
