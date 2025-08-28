// api.js
// Express API: create-queue, send-message, dan endpoints admin + serve Admin Panel

require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const db = require('./db');
const qm = require('./queue-manager');

const app = express();
const PORT = Number(process.env.PORT || 3000);

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
    return res.json({ success: true, queueName, routingKey });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// B. POST /send-message
app.post('/send-message', async (req, res) => {
  try {
    const { userId, callbackUrl, payload, options } = req.body || {};
    if (!isNonEmptyString(userId)) return res.status(400).json({ error: 'userId required (string)' });
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
    const messageId = await qm.publishToUser(userId, { userId, callbackUrl, payload, ts }, options || {});
    return res.json({ success: true, messageId });
  } catch (e) {
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
    return res.json({ success: true });
  } catch (e) {
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
    return res.json({ success: true });
  } catch (e) {
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
    return res.json({ success: ok });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

app.post('/admin/stop-all', adminAuth, async (req, res) => {
  try {
    const all = db.getAllQueues();
    Object.keys(all).forEach((userId) => db.updateQueue(userId, { consumerStatus: 'stopped' }));
    return res.json({ success: true });
  } catch (e) {
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
    return res.json({ success: true, purged: count });
  } catch (e) {
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
});


