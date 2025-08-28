// queue-manager.js
// Abstraksi operasi RabbitMQ: koneksi, assert exchange/queue, bind, publish, purge, stats

const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const EXCHANGE_NAME = 'user_exchange'; // direct exchange per spesifikasi

let connection = null;
let channel = null; // channel umum untuk operasi manajemen/publish

async function getConnection() {
  if (connection) return connection;
  const url = process.env.RABBIT_URL || 'amqp://localhost:5672';
  connection = await amqp.connect(url);
  connection.on('close', () => { connection = null; channel = null; });
  connection.on('error', () => {});
  return connection;
}

async function getChannel() {
  if (channel) return channel;
  const conn = await getConnection();
  channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
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
  getQueueStats,
};



