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

// Untuk menjaga urutan per user, gunakan prefetch=1 sehingga FIFO per queue terjaga
const PREFETCH = Number(process.env.PREFETCH || 1);
const MAX_RETRY = 5; // contoh batas percobaan untuk backoff

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
        return;
      }

      // Jika ada delayMs, tunda eksekusi sebelum forward HTTP
      if (typeof delayMs === 'number' && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      // Forward HTTP
      await axios.post(callbackUrl, payload, { timeout: 10000 });

      db.updateQueue(uid || userId, {
        processed: (db.getQueue(uid || userId)?.processed || 0) + 1,
        lastProcessedAt: new Date().toISOString(),
        lastError: null,
      });
      ch.ack(msg);
    } catch (err) {
      // Retry/backoff sederhana via re-publish dengan delay dan counter attempt di header
      const attempt = (msg.properties?.headers?.['x-attempt'] || 0);
      const routingKey = msg.fields.routingKey;
      const body = msg.content;

      if (attempt < MAX_RETRY) {
        const delayMs = Math.min(60000, 1000 * Math.pow(2, attempt));
        // Ack pesan original lalu re-publish dengan attempt+1 setelah delay
        ch.ack(msg);
        setTimeout(async () => {
          try {
            const pubCh = await qm.getChannel();
            pubCh.publish(qm.EXCHANGE_NAME, routingKey, body, {
              contentType: 'application/json',
              persistent: true,
              headers: { 'x-attempt': attempt + 1 },
            });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Republish failed:', e.message);
          }
        }, delayMs);
      } else {
        // Drop setelah mencapai max retry
        db.updateQueue(userId, {
          failed: (db.getQueue(userId)?.failed || 0) + 1,
          lastError: err?.message || 'unknown',
        });
        ch.nack(msg, false, false);
      }
    }
  }, { noAck: false });

  consumerMap.set(userId, { consumerTag, queueName });
  db.updateQueue(userId, { consumerStatus: 'started' });
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
}

async function syncConsumers() {
  const list = db.listQueueArray();
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
  // Poll setiap 5 detik untuk menyesuaikan status start/stop
  setInterval(() => { syncConsumers().catch(() => {}); }, 5000);

  // eslint-disable-next-line no-console
  console.log('Worker started. Prefetch =', PREFETCH);
}

process.on('unhandledRejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection:', e);
});

process.on('SIGINT', async () => {
  // eslint-disable-next-line no-console
  console.log('SIGINT received. Closing channel...');
  try { await consumeChannel?.close(); } catch (_) {}
  process.exit(0);
});

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Worker init failed:', e);
  process.exit(1);
});



