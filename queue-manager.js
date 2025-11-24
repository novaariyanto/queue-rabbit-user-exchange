// queue-manager.js
// Abstraksi operasi RabbitMQ: koneksi, assert exchange/queue, bind, publish, purge, stats

const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const EXCHANGE_NAME = 'user_exchange'; // direct exchange per spesifikasi

let connection = null;
let channel = null; // channel umum untuk operasi manajemen/publish
let connectionPromise = null; // guard agar hanya satu proses koneksi berjalan

async function getConnection() {
  if (connection) return connection;
  if (connectionPromise) return connectionPromise;

  const baseUrl = process.env.RABBIT_URL || 'amqp://localhost:5672';
  const url = baseUrl.includes('?')
    ? `${baseUrl}&heartbeat=30&connection_timeout=30000`
    : `${baseUrl}?heartbeat=30&connection_timeout=30000`;

  // Retry ringan dengan backoff: 0.5s, 1s, 2s, 5s (max ~8.5s)
  const delays = [500, 1000, 2000, 5000];
  connectionPromise = (async () => {
    let lastError = null;
    for (let i = 0; i <= delays.length; i += 1) {
      try {
        const conn = await amqp.connect(url);
        connection = conn;
        conn.on('close', (e) => {
          // eslint-disable-next-line no-console
          console.error('amqp-connection-close', e?.message || e);
          connection = null;
          channel = null;
          connectionPromise = null;
        });
        conn.on('error', (e) => {
          // eslint-disable-next-line no-console
          console.error('amqp-connection-error', e?.message || e);
        });
        return conn;
      } catch (e) {
        lastError = e;
        if (i < delays.length) {
          await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
    }
    connectionPromise = null;
    throw lastError || new Error('Failed to connect to RabbitMQ');
  })();

  return connectionPromise;
}

async function getChannel() {
  if (channel) return channel;
  const conn = await getConnection();
  const ch = await conn.createChannel();
  ch.on('close', (e) => {
    // eslint-disable-next-line no-console
    console.error('amqp-channel-close', e?.message || e);
    if (channel === ch) channel = null;
  });
  ch.on('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('amqp-channel-error', e?.message || e);
  });
  await ch.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
  channel = ch;
  return channel;
}

async function createQueueForUser(userId, ttlMs) {
  const ch = await getChannel();
  const queueName = `queue.user.${userId}`;
  const routingKey = `user.${userId}`;
  const expires = typeof ttlMs === 'number' ? ttlMs : Number(process.env.DEFAULT_QUEUE_TTL_MS || 600000);

  // Durable queue dengan x-expires (idle TTL)
  await ch.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
  await ch.assertQueue(queueName, {
    durable: true,
    arguments: {
      'x-expires': expires,
    },
  });
  await ch.bindQueue(queueName, EXCHANGE_NAME, routingKey);
  return { queueName, routingKey };
}

async function publishToUser(userId, message, options = {}) {
  const ch = await getChannel();
  const routingKey = `user.${userId}`;
  const msgId = uuidv4();
  const payload = Buffer.from(JSON.stringify({ ...message, messageId: msgId }));
  const ok = ch.publish(EXCHANGE_NAME, routingKey, payload, {
    contentType: 'application/json',
    persistent: true, // persist message
    messageId: msgId,
    timestamp: Date.now(),
    ...options,
  });
  if (!ok) {
    await new Promise((resolve) => ch.once('drain', resolve));
  }
  return msgId;
}

async function purgeQueueByName(queueName) {
  const ch = await getChannel();
  try {
    await ch.purgeQueue(queueName);
    return true;
  } catch (e) {
    return false;
  }
}

async function purgeQueueByUser(userId) {
  return purgeQueueByName(`queue.user.${userId}`);
}

async function deleteQueueByName(queueName) {
  const ch = await getChannel();
  try {
    await ch.deleteQueue(queueName, { ifUnused: false, ifEmpty: false });
    return true;
  } catch (e) {
    return false;
  }
}

async function deleteQueueByUser(userId) {
  return deleteQueueByName(`queue.user.${userId}`);
}

async function getQueueStats(queueName) {
  const ch = await getChannel();
  try {
    // checkQueue mengembalikan messageCount & consumerCount jika queue ada
    const info = await ch.checkQueue(queueName);
    return {
      queueName: info.queue,
      messageCount: info.messageCount,
      consumerCount: info.consumerCount,
    };
  } catch (e) {
    return { queueName, messageCount: 0, consumerCount: 0, missing: true };
  }
}

module.exports = {
  EXCHANGE_NAME,
  getConnection,
  getChannel,
  createQueueForUser,
  publishToUser,
  purgeQueueByName,
  purgeQueueByUser,
  deleteQueueByName,
  deleteQueueByUser,
  getQueueStats,
};



