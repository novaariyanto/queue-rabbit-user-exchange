// api.js
// Express API: create-queue, send-message, dan endpoints admin + serve Admin Panel

require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const db = require('./db');
const qm = require('./queue-manager');
const { createLogger } = require('./logger');
const log = createLogger('api');

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Static admin UI
app.use('/', express.static(path.join(__dirname, 'public')));

// Endpoint callback uji (untuk demo forwarding). Jangan aktifkan di produksi.
app.post('/_test/callback', (req, res) => {
  // eslint-disable-next-line no-console
  console.log('Received callback payload:', req.body);
  res.json({ ok: true, receivedAt: new Date().toISOString() });
});

// Middleware auth sederhana untuk /admin (API Key)
function adminAuth(req, res, next) {
  const apiKey = req.header('x-api-key') || req.query.apiKey;
  if (!process.env.ADMIN_API_KEY) return res.status(500).json({ error: 'ADMIN_API_KEY not set' });
  if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Helper validasi
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// A. POST /create-queue
app.post('/create-queue', async (req, res) => {
  try {
    const { userId, ttlMs } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const { queueName, routingKey } = await qm.createQueueForUser(userId, ttlMs);
    const now = new Date().toISOString();
    // Default: consumerStatus 'started' agar worker auto-subscribe
    db.upsertQueue({ userId, queueName, routingKey, createdAt: now, consumerStatus: 'started' });
    log.info('create-queue', { userId, queueName, routingKey, ttlMs: ttlMs ?? process.env.DEFAULT_QUEUE_TTL_MS });
    return res.json({ success: true, queueName, routingKey });
  } catch (e) {
    log.error('create-queue-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// B. POST /send-message
app.post('/send-message', async (req, res) => {
  try {
    // Dukungan alias: instance_key sebagai userId
    const userId = req.body?.userId || req.body?.instance_key;
    const { callbackUrl, payload, options } = req.body || {};
    const delaySeconds = req.body?.delaySeconds;
    const delayMs = req.body?.delayMs ?? (typeof delaySeconds === 'number' ? delaySeconds * 1000 : undefined);

    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId/instance_key required (string)' });
    if (!isNonEmptyString(callbackUrl)) return res.status(400).json({ error: 'callbackUrl required (string)' });
    if (typeof payload === 'undefined') return res.status(400).json({ error: 'payload required' });

    // Opsional: auto-create queue jika belum ada agar pesan tidak hilang
    const existing = db.getQueue(userId);
    if (!existing) {
      await qm.createQueueForUser(userId, Number(process.env.DEFAULT_QUEUE_TTL_MS || 600000));
      const now = new Date().toISOString();
      db.upsertQueue({ userId, queueName: `queue.user.${userId}`, routingKey: `user.${userId}`, createdAt: now, consumerStatus: 'started' });
    }

    const ts = Date.now();
    const messageId = await qm.publishToUser(userId, { userId, callbackUrl, payload, ts, delayMs }, options || {});
    log.info('send-message', { userId, messageId, delayMs, callbackHost: (new URL(callbackUrl)).host });
    return res.json({ success: true, messageId });
  } catch (e) {
    log.error('send-message-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Admin endpoints (require API key)
app.post('/admin/stop-consumer', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const q = db.getQueue(userId);
    if (!q) return res.status(404).json({ error: 'queue not managed' });
    db.updateQueue(userId, { consumerStatus: 'stopped' });
    log.info('admin-stop-consumer', { userId });
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-stop-consumer-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.post('/admin/start-consumer', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const q = db.getQueue(userId);
    if (!q) {
      // Jika belum ada, buat queue
      await qm.createQueueForUser(userId, Number(process.env.DEFAULT_QUEUE_TTL_MS || 600000));
      const now = new Date().toISOString();
      db.upsertQueue({ userId, queueName: `queue.user.${userId}`, routingKey: `user.${userId}`, createdAt: now, consumerStatus: 'started' });
    } else {
      db.updateQueue(userId, { consumerStatus: 'started' });
    }
    log.info('admin-start-consumer', { userId });
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-start-consumer-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.post('/admin/reset-queue', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const q = db.getQueue(userId);
    if (!q) return res.status(404).json({ error: 'queue not managed' });
    const ok = await qm.purgeQueueByName(q.queueName);
    log.info('admin-reset-queue', { userId, ok });
    return res.json({ success: ok });
  } catch (e) {
    log.error('admin-reset-queue-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Hapus queue: stop consumer, delete queue di broker, hapus metadata
app.post('/admin/delete-queue', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const q = db.getQueue(userId);
    if (!q) return res.status(404).json({ error: 'queue not managed' });
    // Hapus di broker
    const ok = await qm.deleteQueueByName(q.queueName);
    // Hapus metadata lokal
    db.deleteQueue(userId);
    log.info('admin-delete-queue', { userId, ok });
    return res.json({ success: ok });
  } catch (e) {
    log.error('admin-delete-queue-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.post('/admin/stop-all', adminAuth, async (req, res) => {
  try {
    const all = db.getAllQueues();
    Object.keys(all).forEach((userId) => db.updateQueue(userId, { consumerStatus: 'stopped' }));
    log.info('admin-stop-all', {});
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-stop-all-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.post('/admin/reset-all', adminAuth, async (req, res) => {
  try {
    const arr = db.listQueueArray();
    let count = 0;
    for (const q of arr) {
      const ok = await qm.purgeQueueByName(q.queueName);
      if (ok) count += 1;
    }
    log.info('admin-reset-all', { purged: count });
    return res.json({ success: true, purged: count });
  } catch (e) {
    log.error('admin-reset-all-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Set default delay antar pesan per user (ms)
app.post('/admin/set-default-delay', adminAuth, async (req, res) => {
  try {
    const { userId, delayMs } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
    const ms = Number(delayMs);
    if (!Number.isFinite(ms) || ms < 0) return res.status(400).json({ error: 'delayMs must be >= 0' });
    const q = db.getQueue(userId);
    if (!q) return res.status(404).json({ error: 'queue not managed' });
    db.updateQueue(userId, { defaultDelayMs: ms });
    log.info('admin-set-default-delay', { userId, delayMs: ms });
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-set-default-delay-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.get('/admin/queues', adminAuth, async (req, res) => {
  try {
    const arr = db.listQueueArray();
    const result = [];
    for (const q of arr) {
      const stats = await qm.getQueueStats(q.queueName);
      result.push({
        userId: q.userId,
        queueName: q.queueName,
        routingKey: q.routingKey,
        createdAt: q.createdAt,
        consumerStatus: q.consumerStatus || 'stopped',
        defaultDelayMs: q.defaultDelayMs || 0,
        processed: q.processed || 0,
        failed: q.failed || 0,
        lastError: q.lastError || null,
        lastProcessedAt: q.lastProcessedAt || null,
        pendingCount: stats.messageCount || 0,
        consumers: stats.consumerCount || 0,
      });
    }
    // Ringkasan
    const totalQueues = result.length;
    const totalPending = result.reduce((a, b) => a + (b.pendingCount || 0), 0);
    const activeConsumers = result.filter((x) => x.consumerStatus === 'started').length;
    return res.json({ success: true, totalQueues, totalPending, activeConsumers, queues: result });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Reset data/counter per queue (processed, failed, lastError, lastProcessedAt)
app.post('/admin/reset-data', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId required (string)' });
    }
    const q = db.getQueue(userId);
    if (!q) return res.status(404).json({ error: 'queue not managed' });
    db.updateQueue(userId, { processed: 0, failed: 0, lastError: null, lastProcessedAt: null });
    log.info('admin-reset-data', { userId });
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-reset-data-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Reset data/counter semua queue
app.post('/admin/reset-data-all', adminAuth, async (req, res) => {
  try {
    const all = db.getAllQueues();
    Object.keys(all).forEach((uid) => db.updateQueue(uid, { processed: 0, failed: 0, lastError: null, lastProcessedAt: null }));
    log.info('admin-reset-data-all', {});
    return res.json({ success: true });
  } catch (e) {
    log.error('admin-reset-data-all-error', { error: e.message });
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
  log.info('api-started', { port: PORT });
});


