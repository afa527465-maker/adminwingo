import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { eq } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { platformSettings } from './src/db/schema.ts';
import { authRouter } from './src/server/routes/authRoutes.ts';
import { gameRouter } from './src/server/routes/gameRoutes.ts';
import { walletRouter } from './src/server/routes/walletRoutes.ts';
import { communityRouter } from './src/server/routes/communityRoutes.ts';
import { adminRouter } from './src/server/routes/adminRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.set('trust proxy', 1);

  // Security headers (iframe-compatible; no X-Frame-Options blocking AI Studio preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Strict same-origin / allowlisted CORS (never wildcard * on authenticated routes)
  const allowedOrigins = new Set(
    String(process.env.CORS_ORIGINS || process.env.APP_URL || '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean)
  );
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        allowedOrigins.has(origin.replace(/\/$/, '')))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  // Public platform info & announcement (synced live with Admin Panel -> Announcements)
  app.get('/api/public/announcement', async (_req, res) => {
    try {
      const [listRow] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'announcements_list'))
        .limit(1);

      let announcement: { text: string; enabled: boolean } | null = null;
      if (listRow && Array.isArray(listRow.valueJson)) {
        const active = (listRow.valueJson as Array<{ content?: string; enabled?: boolean }>).find(
          (a) => a.enabled && a.content
        );
        if (active?.content) {
          announcement = { text: active.content, enabled: true };
        }
      }

      if (!announcement) {
        const [row] = await db
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.key, 'announcement'))
          .limit(1);
        const val = row?.valueJson as { text?: string; enabled?: boolean } | undefined;
        announcement = {
          text:
            val?.text ||
            'WinGo uses server-controlled rounds, cryptographic seed commitments, and an auditable PostgreSQL ledger.',
          enabled: val?.enabled ?? true,
        };
      }

      return res.json({
        announcement,
        mode: process.env.WINGO_MODE || 'development',
        currency: process.env.WINGO_CURRENCY || 'USD',
      });
    } catch (error) {
      console.error('Public announcement error:', error);
      return res.json({
        announcement: {
          text: 'WinGo uses server-controlled rounds, cryptographic seed commitments, and an auditable PostgreSQL ledger.',
          enabled: true,
        },
        mode: process.env.WINGO_MODE || 'development',
        currency: process.env.WINGO_CURRENCY || 'USD',
      });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'wingo-api', timestamp: new Date().toISOString() });
  });

  // Allowlisted standalone ZIP package downloads (zero secrets; strictly two exact archives)
  const ALLOWED_EXPORTS = new Set(['wingo-game-page.zip', 'wingo-admin-panel.zip']);
  app.get('/downloads/:filename', (req, res) => {
    const filename = path.basename(String(req.params.filename || ''));
    if (!ALLOWED_EXPORTS.has(filename)) {
      return res.status(404).json({ error: 'Export archive not found.' });
    }
    const archivePath = path.resolve(__dirname, filename);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(archivePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Export archive not generated yet. Run npm run export:zips.' });
      }
    });
  });

  // Mount WinGo Backend API routers
  app.use('/api/auth', authRouter);
  app.use('/api/game', gameRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api', communityRouter);
  app.use('/api/admin', adminRouter);

  // Unknown API route handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Vite dev middleware or static production build (skipped when API_ONLY=true)
  if (process.env.API_ONLY !== 'true') {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WinGo Platform running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
