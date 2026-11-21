import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { configureApp } from './app.setup.js';
import {
  createVercelDispatcher,
  normalizeVercelRequestUrl,
  preloadPdfkitStandardFonts,
} from './serverless.js';

function createMockResponse() {
  const emitter = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
  };
  emitter.writableEnded = false;
  return emitter as unknown as Response &
    EventEmitter & { writableEnded: boolean };
}

describe('Vercel serverless adapter', () => {
  it('preserves direct URLs and restores paths rewritten via __vercel_path', () => {
    expect(normalizeVercelRequestUrl(undefined)).toBe('/');
    expect(normalizeVercelRequestUrl('/public/branding?currency=BDT')).toBe(
      '/public/branding?currency=BDT',
    );
    expect(normalizeVercelRequestUrl('/api?__vercel_path=')).toBe('/');
    expect(normalizeVercelRequestUrl('/api/index?__vercel_path=')).toBe('/');
    expect(
      normalizeVercelRequestUrl(
        '/api?__vercel_path=bookings/123&status=CONFIRMED',
      ),
    ).toBe('/bookings/123?status=CONFIRMED');
    expect(
      normalizeVercelRequestUrl(
        '/bookings/123?status=CONFIRMED&__vercel_path=bookings%2F123',
      ),
    ).toBe('/bookings/123?status=CONFIRMED');
    expect(
      normalizeVercelRequestUrl(
        '/api?__vercel_path=public/portfolio%20showcase',
      ),
    ).toBe('/public/portfolio%20showcase');
  });

  it('caches the initialized handler across warm invocations and waits for response completion', async () => {
    let completed = false;
    const expressHandler = vi.fn((_req: Request, res: Response) => {
      setTimeout(() => {
        completed = true;
        (res as unknown as { writableEnded: boolean }).writableEnded = true;
        res.emit('finish');
      }, 10);
    });
    const init = vi.fn(async () => expressHandler);
    const dispatch = createVercelDispatcher(init);

    const req1 = { url: '/api?__vercel_path=public/branding' } as Request;
    const res1 = createMockResponse();
    await dispatch(req1, res1);

    expect(completed).toBe(true);
    expect(req1.url).toBe('/public/branding');

    const req2 = { url: '/api?__vercel_path=auth/me' } as Request;
    const res2 = createMockResponse();
    await dispatch(req2, res2);

    expect(init).toHaveBeenCalledTimes(1);
    expect(expressHandler).toHaveBeenCalledTimes(2);
    expect(req2.url).toBe('/auth/me');
  });

  it('clears cached handler promise if initialization fails so subsequent requests retry', async () => {
    const expressHandler = vi.fn((_req: Request, res: Response) => {
      (res as unknown as { writableEnded: boolean }).writableEnded = true;
      res.emit('finish');
    });
    const init = vi
      .fn<() => Promise<(req: Request, res: Response) => unknown>>()
      .mockRejectedValueOnce(new Error('Transient DB startup failure'))
      .mockResolvedValueOnce(expressHandler);

    const dispatch = createVercelDispatcher(init);

    await expect(
      dispatch({ url: '/api?__vercel_path=' } as Request, createMockResponse()),
    ).rejects.toThrow('Transient DB startup failure');

    await dispatch(
      { url: '/api?__vercel_path=' } as Request,
      createMockResponse(),
    );
    expect(init).toHaveBeenCalledTimes(2);
    expect(expressHandler).toHaveBeenCalledTimes(1);
  });

  it('loads pdfkit standard font CJS modules cleanly for serverless tracing', () => {
    expect(() => preloadPdfkitStandardFonts()).not.toThrow();
  });

  it('configures trust proxy and normalizes trailing slashes in CORS_ORIGINS', () => {
    const previousCors = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS =
      'https://studio.example.com/, http://localhost:3000 ';

    try {
      const setCalls: Array<[string, unknown]> = [];
      const disableCalls: string[] = [];
      let corsOptions: { origin?: unknown; credentials?: boolean } | undefined;

      const mockApp = {
        getHttpAdapter: () => ({
          getInstance: () => ({
            disable: (key: string) => disableCalls.push(key),
            set: (key: string, val: unknown) => setCalls.push([key, val]),
          }),
        }),
        use: vi.fn(),
        enableCors: (opts: { origin?: unknown; credentials?: boolean }) => {
          corsOptions = opts;
        },
        useGlobalPipes: vi.fn(),
        useGlobalFilters: vi.fn(),
      };

      configureApp(mockApp as never);

      expect(disableCalls).toContain('x-powered-by');
      expect(setCalls).toContainEqual(['trust proxy', 1]);
      expect(corsOptions).toEqual({
        origin: ['https://studio.example.com', 'http://localhost:3000'],
        credentials: true,
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        optionsSuccessStatus: 204,
      });
    } finally {
      if (previousCors === undefined) {
        delete process.env.CORS_ORIGINS;
      } else {
        process.env.CORS_ORIGINS = previousCors;
      }
    }
  });
});
