// worker.js
// Worker/Consumer pool: subscribe dinamis ke banyak queue berdasarkan metadata di store.json
// - Menggunakan prefetch untuk rate control
// - HTTP forward via axios
// - Start/stop per queue dikendalikan oleh API (update consumerStatus di DB)

require('dotenv').config();
const amqp = require('amqplib');
const axios = require('axios');
const db = require('./db');
const qm = require('./queue-manager');
const { createLogger } = require('./logger');
const idleCleanup = require('./idle-cleanup');
const log = createLogger('worker');

// Untuk menjaga urutan per user, gunakan prefetch=1 sehingga FIFO per queue terjaga
const PREFETCH = Number(process.env.PREFETCH || 1);
const MAX_RETRY = 0; // contoh batas percobaan untuk backoff

let consumeChannel = null;
const consumerMap = new Map(); // userId -> { consumerTag, queueName }

async function getConsumeChannel() {
  if (consumeChannel) return consumeChannel;
  const conn = await qm.getConnection();
  const ch = await conn.createChannel();
  await ch.assertExchange(qm.EXCHANGE_NAME, 'direct', { durable: true });
  await ch.prefetch(PREFETCH);
  consumeChannel = ch;
  return consumeChannel;
}

async function startConsumer(userId) {
  const ch = await getConsumeChannel();
  if (consumerMap.has(userId)) return; // sudah jalan

  const queueName = `queue.user.${userId}`;
  // Pastikan queue ada (jika sempat expired karena idle)
  await qm.createQueueForUser(userId, Number(process.env.DEFAULT_QUEUE_TTL_MS || 600000));

  const { consumerTag } = await ch.consume(queueName, async (msg) => {
    if (!msg) return; // canceled
    try {
      const content = msg.content ? msg.content.toString('utf-8') : '{}';
      const data = JSON.parse(content);
      const { userId: uid, callbackUrl, payload, delayMs } = data || {};

      if (!callbackUrl) {
        // Tidak ada callbackUrl → drop dengan log
        db.updateQueue(uid || userId, {
          failed: (db.getQueue(uid || userId)?.failed || 0) + 1,
          lastError: 'Missing callbackUrl',
        });
        ch.ack(msg);
        log.error('missing-callback-url', { userId: uid || userId });
        return;
      }

      // Tentukan delay: prioritas ke delayMs pada pesan, jika tidak ada pakai defaultDelayMs dari metadata queue
      let effectiveDelay = 0;
      if (typeof delayMs === 'number' && delayMs > 0) {
        effectiveDelay = delayMs;
      } else {
        const meta = db.getQueue(uid || userId);
        if (meta && typeof meta.defaultDelayMs === 'number' && meta.defaultDelayMs > 0) {
          effectiveDelay = meta.defaultDelayMs;
        }
      }
      if (effectiveDelay > 0) {
        log.info('delay-start', { userId: uid || userId, delayMs: effectiveDelay });
        await new Promise((r) => setTimeout(r, effectiveDelay));
        log.info('delay-end', { userId: uid || userId, delayMs: effectiveDelay });
      }
      // Forward HTTP
      await axios.post(callbackUrl, payload, { timeout: 10000 });

      db.updateQueue(uid || userId, {
        processed: (db.getQueue(uid || userId)?.processed || 0) + 1,
        lastProcessedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(), // Update activity untuk idle tracking
        lastError: null,
      });
      ch.ack(msg);
      log.info('processed', { userId: uid || userId, routingKey: msg.fields.routingKey });
    } catch (err) {
      // Retry/backoff sederhana via re-publish dengan delay dan counter attempt di header
      const attempt = (msg.properties?.headers?.['x-attempt'] || 0);
      const routingKey = msg.fields.routingKey;
      const body = msg.content;
      const queueMeta = db.getQueue(uid || userId);
      const retryDisabled = queueMeta?.disableRetry || false;

      // Cek apakah retry disabled untuk queue ini
      if (!retryDisabled && attempt < MAX_RETRY) {
        const delayMs = Math.min(60000, 1000 * Math.pow(2, attempt));
        // Ack pesan original lalu re-publish dengan attempt+1 setelah delay
        ch.ack(msg);
        
        // Update counter retry
        db.updateQueue(uid || userId, {
          retried: (db.getQueue(uid || userId)?.retried || 0) + 1,
          lastError: `Retry attempt ${attempt + 1}: ${err?.message || 'unknown'}`,
        });
        
        setTimeout(async () => {
          try {
            const pubCh = await qm.getChannel();
            pubCh.publish(qm.EXCHANGE_NAME, routingKey, body, {
              contentType: 'application/json',
              persistent: true,
              headers: { 'x-attempt': attempt + 1 },
            });
            log.info('republish', { userId: uid || userId, routingKey, nextAttempt: attempt + 1, delayMs, error: err?.message });
          } catch (e) {
            // eslint-disable-next-line no-console
            log.error('republish-failed', { userId: uid || userId, error: e.message });
          }
        }, delayMs);
      } else {
        // Drop setelah mencapai max retry atau retry disabled
        const reason = retryDisabled ? 'retry-disabled' : 'max-retry-reached';
        db.updateQueue(uid || userId, {
          failed: (db.getQueue(uid || userId)?.failed || 0) + 1,
          lastError: `${reason}: ${err?.message || 'unknown'}`,
        });
        ch.nack(msg, false, false);
        log.error('failed-dropped', { userId: uid || userId, reason, attempt, error: err?.message });
      }
    }
  }, { noAck: false });

  consumerMap.set(userId, { consumerTag, queueName });
  db.updateQueue(userId, { consumerStatus: 'started' });
  log.info('consumer-started', { userId, queueName });
}

async function stopConsumer(userId) {
  const meta = consumerMap.get(userId);
  if (!meta) {
    db.updateQueue(userId, { consumerStatus: 'stopped' });
    return;
  }
  const ch = await getConsumeChannel();
  await ch.cancel(meta.consumerTag);
  consumerMap.delete(userId);
  db.updateQueue(userId, { consumerStatus: 'stopped' });
  log.info('consumer-stopped', { userId });
}

async function syncConsumers() {
  const list = db.listQueueArray();
  const managedUserIds = new Set(list.map((q) => q.userId));

  // Hentikan consumer untuk userId yang tidak lagi ada di metadata (DB)
  for (const [uid] of consumerMap.entries()) {
    if (!managedUserIds.has(uid)) {
      try { await stopConsumer(uid); } catch (_) {}
    }
  }

  // Sinkronkan status start/stop untuk queue yang dikelola
  for (const q of list) {
    if ((q.consumerStatus || 'stopped') === 'started') {
      await startConsumer(q.userId).catch(() => {});
    } else {
      await stopConsumer(q.userId).catch(() => {});
    }
  }
}

async function main() {
  await getConsumeChannel();
  await syncConsumers();
  
  // Start idle cleanup service
  idleCleanup.startCleanupService();
  
  // Poll setiap 5 detik untuk menyesuaikan status start/stop
  setInterval(() => { syncConsumers().catch(() => {}); }, 5000);

  // eslint-disable-next-line no-console
  console.log('Worker started. Prefetch =', PREFETCH, '| Auto cleanup enabled =', idleCleanup.AUTO_CLEANUP_ENABLED);
  log.info('worker-started', { 
    prefetch: PREFETCH, 
    autoCleanupEnabled: idleCleanup.AUTO_CLEANUP_ENABLED,
    idleTimeoutMinutes: Math.round(idleCleanup.IDLE_TIMEOUT_MS / 60000)
  });
}

process.on('unhandledRejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection:', e);
});

process.on('SIGINT', async () => {
  // eslint-disable-next-line no-console
  console.log('SIGINT received. Stopping services...');
  try { 
    // Stop cleanup service
    idleCleanup.stopCleanupService();
    // Close channel
    await consumeChannel?.close(); 
  } catch (_) {}
  process.exit(0);
});

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Worker init failed:', e);
  process.exit(1);
});



