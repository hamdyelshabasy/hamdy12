import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ensureSeeded } from './src/db/seed.ts';
import { invalidatePublicBootstrapCache, publicRouter } from './src/server/routes/public.ts';
import {
  invalidateAllAuthCache,
  invalidateAllContentCaches,
} from './src/server/cache.ts';
import { authRouter } from './src/server/routes/auth.ts';
import { studentRouter } from './src/server/routes/student.ts';
import { examsRouter } from './src/server/routes/exams.ts';
import { adminRouter } from './src/server/routes/admin.ts';
import { adminExamsRouter } from './src/server/routes/adminExams.ts';
import { adminUpgradeRouter } from './src/server/routes/adminUpgrade.ts';
import {
  adminHomeworkRouter,
  homeworkFilesRouter,
  studentHomeworkRouter,
} from './src/server/routes/homework.ts';
import {
  adminQuestionBankRouter,
  questionBankFilesRouter,
} from './src/server/routes/questionBank.ts';
import {
  adminCurriculumRouter,
  studentCurriculumRouter,
} from './src/server/routes/curriculum.ts';
import {
  adminAnnouncementsRouter,
  announcementFilesRouter,
} from './src/server/routes/announcements.ts';
import { assertProductionSecretsOnStartup } from './src/server/config/secrets.ts';
import { isAllowedCorsOrigin, isPathWithinBaseDir } from './src/server/domain/securityHardening.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  assertProductionSecretsOnStartup();

  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((req, res, next) => {
    const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return cors({
      origin: (origin, callback) => {
        if (
          isAllowedCorsOrigin({
            origin,
            requestHost: reqHost,
            allowedOriginsEnv: process.env.ALLOWED_ORIGINS,
            isProd,
          })
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint', 'X-Device-Name', 'X-Proxy-Safe-Errors'],
      exposedHeaders: ['X-Original-Status'],
    })(req, res, next);
  });
  app.use(express.json({ limit: '10mb' }));

  // Async streaming gzip/deflate compression for API JSON, Vite dev modules, and static text assets
  app.use(
    compression({
      level: 5,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Serve generated and uploaded visual assets reliably with WebP content negotiation + browser caching
  const webpExistenceCache = new Map<string, boolean>();
  const makeWebpNegotiator = (baseDir: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const accept = String(req.headers.accept || '');
      if (!accept.includes('image/webp')) return next();
      const rawUrl = req.url.split('?')[0];
      if (!/\.(jpe?g|png)$/i.test(rawUrl) || rawUrl.includes('..')) return next();
      let decodedRel: string;
      try {
        decodedRel = decodeURIComponent(rawUrl).replace(/^\/+/, '');
      } catch {
        return next();
      }
      const webpDiskPath = path.resolve(baseDir, `${decodedRel}.webp`);
      if (!isPathWithinBaseDir(baseDir, webpDiskPath)) return next();
      let exists = webpExistenceCache.get(webpDiskPath);
      if (exists === undefined) {
        exists = fs.existsSync(webpDiskPath);
        if (webpExistenceCache.size < 500) {
          webpExistenceCache.set(webpDiskPath, exists);
        }
      }
      if (exists) {
        const qsIdx = req.url.indexOf('?');
        const qs = qsIdx >= 0 ? req.url.slice(qsIdx) : '';
        req.url = `${rawUrl}.webp${qs}`;
        res.setHeader('Vary', 'Accept');
        res.setHeader('Content-Type', 'image/webp');
      }
      return next();
    };
  };

  const imageCacheOpts = {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    },
  };
  const srcImagesDir = path.join(__dirname, 'src/assets/images');
  const publicAssetsDir = path.join(__dirname, 'public/assets');
  app.use('/src/assets/images', makeWebpNegotiator(srcImagesDir), express.static(srcImagesDir, imageCacheOpts));
  app.use('/assets', makeWebpNegotiator(publicAssetsDir), express.static(publicAssetsDir, imageCacheOpts));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Lazy idempotent DB seed on first API request (never eager at module import time)
  app.use('/api', async (_req, res, next) => {
    try {
      await ensureSeeded();
      return next();
    } catch (error) {
      console.error('Lazy seed middleware error:', error);
      return res.status(503).json({ error: 'قاعدة البيانات قيد التجهيز، يرجى المحاولة بعد ثوانٍ' });
    }
  });

  // Outer reverse proxies (such as Nginx with `proxy_intercept_errors on; error_page 403 = /forbidden.html;`)
  // strip upstream 403 JSON bodies and replace them with HTML, breaking Arabic error messages and structured
  // `reasonCode` payloads (e.g. DEVICE_LIMIT_EXCEEDED recovery). For frontend requests that opt in with
  // `X-Proxy-Safe-Errors: 1`, send HTTP 423 with `X-Original-Status: 403` so the full JSON passes untouched.
  app.use('/api', (req, res, next) => {
    if (req.headers['x-proxy-safe-errors'] === '1') {
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((statusCode: number, ...args: unknown[]) => {
        if (statusCode === 403) {
          res.statusCode = 423;
          res.setHeader('X-Original-Status', '403');
          return (origWriteHead as (...a: unknown[]) => Response)(423, ...args);
        }
        return (origWriteHead as (...a: unknown[]) => Response)(statusCode, ...args);
      }) as typeof res.writeHead;
    }
    next();
  });

  // Prevent proxies or shared caches from storing private authenticated API responses
  const setPrivateNoStore = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  };

  app.use('/api/public', publicRouter);
  app.use('/api/auth', setPrivateNoStore, authRouter);
  app.use('/api/homework', homeworkFilesRouter);
  app.use('/api/question-bank', questionBankFilesRouter);
  app.use('/api/announcements/files', announcementFilesRouter);
  app.use('/api/student/homework', setPrivateNoStore, studentHomeworkRouter);
  app.use('/api/student/curriculum', setPrivateNoStore, studentCurriculumRouter);
  app.use('/api/student', setPrivateNoStore, studentRouter);
  app.use('/api/exams', setPrivateNoStore, examsRouter);
  // Automatic cache invalidation on any successful admin mutation
  app.use('/api/admin', setPrivateNoStore, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          invalidateAllContentCaches();
          invalidatePublicBootstrapCache();
          if (/\/(students|staff|roles|sessions|manage|users|devices)/i.test(req.path)) {
            invalidateAllAuthCache();
          }
        }
      });
    }
    next();
  });

  app.use('/api/admin/question-bank', adminQuestionBankRouter);
  app.use('/api/admin/homework', adminHomeworkRouter);
  app.use('/api/admin/curriculum', adminCurriculumRouter);
  app.use('/api/admin/announcements', adminAnnouncementsRouter);
  app.use('/api/admin/phase2-exams', adminExamsRouter);
  app.use('/api/admin/manage', adminUpgradeRouter);
  app.use('/api/admin', adminRouter);

  // Ensure unmatched /api/* routes and Express middleware errors always return clean Arabic JSON (never HTML)
  app.use('/api', (_req, res) => {
    return res.status(404).json({ error: 'المسار المطلوب غير موجود على الخادم' });
  });
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
    const status = e?.status || e?.statusCode || 500;
    if (e?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'صيغة البيانات المرسلة غير صالحة' });
    }
    if (e?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'حجم البيانات المرسلة أكبر من الحد المسموح' });
    }
    console.error('Unhandled /api middleware error:', err);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: 'حدث خطأ مؤقت في الخادم، يرجى المحاولة مرة أخرى.',
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // When HMR/WS is disabled in proxied preview environments, Vite 8 still injects /@vite/client
    // which attempts to connect to a WebSocket on port 24678. Serve a clean WebSocket-free client
    // implementing the exact style/HMR exports without opening any socket.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    const distAssetsDir = path.join(distDir, 'assets');
    const gzipAssetCache = new Map<string, { buf: Buffer; contentType: string }>();

    // Serve immutable hashed JS/CSS chunks gzipped with 1-year browser caching
    app.get('/assets/:fileName', (req, res, next) => {
      const acceptEnc = String(req.headers['accept-encoding'] || '');
      const fileName = String(req.params.fileName || '');
      if (
        !acceptEnc.includes('gzip') ||
        fileName.includes('..') ||
        fileName.includes('/') ||
        (!fileName.endsWith('.js') && !fileName.endsWith('.css'))
      ) {
        return next();
      }
      const cached = gzipAssetCache.get(fileName);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', String(cached.buf.length));
        return res.end(cached.buf);
      }
      const fullPath = path.join(distAssetsDir, fileName);
      if (!fs.existsSync(fullPath)) {
        return next();
      }
      try {
        const raw = fs.readFileSync(fullPath);
        const zipped = zlib.gzipSync(raw, { level: 6 });
        const contentType = fileName.endsWith('.js')
          ? 'application/javascript; charset=utf-8'
          : 'text/css; charset=utf-8';
        if (gzipAssetCache.size < 120) {
          gzipAssetCache.set(fileName, { buf: zipped, contentType });
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', String(zipped.length));
        return res.end(zipped);
      } catch {
        return next();
      }
    });

    app.use(
      '/assets',
      express.static(distAssetsDir, {
        maxAge: '1y',
        immutable: true,
      }),
    );
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Physics LMS Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
