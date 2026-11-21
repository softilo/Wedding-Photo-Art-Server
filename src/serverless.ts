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
export function normalizeVercelRequestUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return '/';
  }

  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenPath = parsed.searchParams.get('__vercel_path');
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
    req.url = normalizeVercelRequestUrl(req.url);
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
  preloadPdfkitStandardFonts();
  const app = await createConfiguredApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as ExpressRequestHandler;
}

export const handleVercelRequest = createVercelDispatcher(
  bootstrapServerlessHandler,
);
