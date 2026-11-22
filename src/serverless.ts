import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import { createConfiguredApp } from './app.setup.js';

export type ExpressRequestHandler = (req: Request, res: Response) => unknown;

const requireFromModule = createRequire(import.meta.url);

/**
 * Statically references pdfkit's CJS standard font modules so serverless file tracers
 * (`@vercel/nft`) include them via package exports without `includeFiles` symlink globs.
 */
export function preloadPdfkitStandardFonts(): void {
  requireFromModule('pdfkit/standard-fonts/Helvetica');
  requireFromModule('pdfkit/standard-fonts/HelveticaBold');
  requireFromModule('pdfkit/standard-fonts/HelveticaOblique');
  requireFromModule('pdfkit/standard-fonts/HelveticaBoldOblique');
}

/**
 * Restores the original client request path when Vercel rewrites traffic to `/api`.
 */
export function normalizeVercelRequestUrl(
  rawUrl: string | undefined,
  fallbackRewrittenPath?: string,
): string {
  if (!rawUrl) {
    return '/';
  }

  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenPath =
    parsed.searchParams.get('__vercel_path') ?? fallbackRewrittenPath ?? null;
  if (rewrittenPath === null) {
    return rawUrl;
  }

  parsed.searchParams.delete('__vercel_path');
  const search = parsed.searchParams.toString();
  const querySuffix = search ? `?${search}` : '';

  if (parsed.pathname === '/api' || parsed.pathname === '/api/index') {
    const withLeadingSlash = rewrittenPath.startsWith('/')
      ? rewrittenPath
      : `/${rewrittenPath}`;
    const normalizedPathname = new URL(withLeadingSlash, 'http://localhost')
      .pathname;
    return `${normalizedPathname}${querySuffix}`;
  }

  return `${parsed.pathname}${querySuffix}`;
}

/**
 * Strips Vercel's own `req.query` lazy getter/cache (which includes `__vercel_path`
 * and shadows Express 5's prototype `req.query` getter) after normalizing `req.url`.
 */
export function prepareVercelRequest(req: Request): void {
  const rawReq = req as Request & Record<string, unknown>;
  const existingQuery =
    rawReq.query && typeof rawReq.query === 'object'
      ? (rawReq.query as Record<string, unknown>)
      : undefined;
  const fallbackRewrittenPath =
    typeof existingQuery?.__vercel_path === 'string'
      ? existingQuery.__vercel_path
      : undefined;

  req.url = normalizeVercelRequestUrl(req.url, fallbackRewrittenPath);

  if (Object.prototype.hasOwnProperty.call(rawReq, 'query')) {
    if (!Reflect.deleteProperty(rawReq, 'query') && existingQuery) {
      delete existingQuery.__vercel_path;
    }
  }
}

/**
 * Creates a single-flight cached request dispatcher for Vercel serverless invocations.
 * Clears cached initialization state on failure so transient cold-start errors recover cleanly.
 */
export function createVercelDispatcher(
  initHandler: () => Promise<ExpressRequestHandler>,
): (req: Request, res: Response) => Promise<void> {
  let cachedHandlerPromise: Promise<ExpressRequestHandler> | undefined;

  const getHandler = async (): Promise<ExpressRequestHandler> => {
    if (!cachedHandlerPromise) {
      cachedHandlerPromise = initHandler().catch((error: unknown) => {
        cachedHandlerPromise = undefined;
        throw error;
      });
    }
    return cachedHandlerPromise;
  };

  return async (req: Request, res: Response): Promise<void> => {
    prepareVercelRequest(req);
    const handler = await getHandler();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        res.off('finish', onComplete);
        res.off('close', onComplete);
      };
      const onComplete = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      };

      res.on('finish', onComplete);
      res.on('close', onComplete);

      try {
        const result = handler(req, res);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch((error: unknown) => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(error);
            }
          });
        }
        if (res.writableEnded) {
          onComplete();
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      }
    });
  };
}

async function bootstrapServerlessHandler(): Promise<ExpressRequestHandler> {
  // Keep `preloadPdfkitStandardFonts` statically referenced for `@vercel/nft` tracing
  // without loading PDFKit font buffers during non-PDF serverless cold starts.
  const app = await createConfiguredApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as ExpressRequestHandler;
}

export const handleVercelRequest = createVercelDispatcher(
  bootstrapServerlessHandler,
);
