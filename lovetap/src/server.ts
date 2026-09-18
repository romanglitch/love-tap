import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import webpush from 'web-push';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ Missing VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
  console.error('   Generate with: npx web-push generate-vapid-keys');
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:lovetap@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

// ─── Prisma ──────────────────────────────────────────────────────────────────
const prisma = new PrismaClient();

// ─── Express + HTTP + Socket.IO ─────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve sw.js at root scope
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────
// Per-user tap rate limit: max 1 tap per second
const tapRateLimiter = rateLimit({
  windowMs: 1000,
  max: 1,
  keyGenerator: (req) => req.body?.userId || req.ip || 'unknown',
  message: { error: 'Слишком быстро! Подождите секунду.' },
  standardHeaders: false,
  legacyHeaders: false,
});

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
  standardHeaders: false,
  legacyHeaders: false,
});

// ─── REST Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/vapid-key — return the public VAPID key for frontend subscription
 */
app.get('/api/vapid-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/**
 * POST /api/subscribe — save a push subscription
 */
app.post('/api/subscribe', apiLimiter, async (req, res) => {
  try {
    const { userId, subscription } = req.body;

    if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Некорректные данные подписки' });
    }

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, displayName: req.body.displayName || 'Аноним' },
    });

    // Upsert subscription (unique on endpoint)
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId,
      },
      create: {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Ошибка сохранения подписки' });
  }
});

/**
 * POST /api/user — create or update user display name
 */
app.post('/api/user', apiLimiter, async (req, res) => {
  try {
    const { userId, displayName } = req.body;
    if (!userId || !displayName) {
      return res.status(400).json({ error: 'Нужен userId и displayName' });
    }

    const user = await prisma.user.upsert({
      where: { id: userId },
      update: { displayName },
      create: { id: userId, displayName },
    });

    res.json({ user });
  } catch (err) {
    console.error('User upsert error:', err);
    res.status(500).json({ error: 'Ошибка сохранения пользователя' });
  }
});

/**
 * GET /api/taps?limit=20 — get recent heart taps
 */
app.get('/api/taps', apiLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const taps = await prisma.heartTap.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { displayName: true } } },
    });
    res.json({ taps });
  } catch (err) {
    console.error('Taps fetch error:', err);
    res.status(500).json({ error: 'Ошибка получения тапов' });
  }
});

/**
 * POST /api/tap — register a heart tap
 */
app.post('/api/tap', tapRateLimiter, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Нужен userId' });
    }

    // Ensure user exists
    const user = await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, displayName: 'Аноним' },
    });

    // Create tap record
    const tap = await prisma.heartTap.create({
      data: { userId },
      include: { user: { select: { displayName: true } } },
    });

    const tapPayload = {
      id: tap.id,
      userId: tap.userId,
      displayName: tap.user.displayName,
      createdAt: tap.createdAt.toISOString(),
    };

    // Broadcast to all connected clients via Socket.IO
    io.emit('heart-tap', tapPayload);

    // Send push notifications to all OTHER subscribed users
    sendPushToAllExcept(userId, tap.user.displayName).catch((err) => {
      console.error('Push notification batch error:', err);
    });

    res.json({ tap: tapPayload });
  } catch (err) {
    console.error('Tap error:', err);
    res.status(500).json({ error: 'Ошибка регистрации тапа' });
  }
});

// ─── Push Notification Helper ────────────────────────────────────────────────

async function sendPushToAllExcept(senderId: string, senderName: string): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { NOT: { userId: senderId } },
  });

  const payload = JSON.stringify({
    title: '💖 LoveTap',
    body: `${senderName} отправил(а) вам любовь! Они только что нажали на сердце.`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'heart-tap',
    renotify: true,
  });

  const invalidEndpoints: string[] = [];

  const promises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      );
    } catch (err: any) {
      // Clean up expired/invalid subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        invalidEndpoints.push(sub.endpoint);
      } else {
        console.error(`Push failed for ${sub.endpoint}:`, err.message);
      }
    }
  });

  await Promise.allSettled(promises);

  // Cleanup invalid subscriptions
  if (invalidEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: invalidEndpoints } },
    });
    console.log(`🧹 Cleaned ${invalidEndpoints.length} invalid push subscriptions`);
  }
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n💖 LoveTap server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready`);
  console.log(`🔑 VAPID Public Key: ${VAPID_PUBLIC_KEY.substring(0, 20)}...`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});
