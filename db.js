// db.js
// Penyimpanan metadata queue berbasis JSON file sederhana.
// Struktur file: { "queues": { [userId]: { userId, queueName, routingKey, createdAt, consumerStatus, processed, failed, lastError, lastProcessedAt } } }

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'store.json');

function ensureStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = { queues: {} };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function readStore() {
  ensureStore();
  const raw = fs.readFileSync(STORE_FILE, 'utf-8');
  try {
    return JSON.parse(raw || '{"queues":{}}');
  } catch (e) {
    // Jika file korup, reset minimal
    return { queues: {} };
  }
}

function writeStore(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getAllQueues() {
  const store = readStore();
  return store.queues || {};
}

function getQueue(userId) {
  const store = readStore();
  return store.queues[userId] || null;
}

function upsertQueue(meta) {
  const store = readStore();
  const existing = store.queues[meta.userId] || {};
  store.queues[meta.userId] = {
    processed: 0,
    failed: 0,
    ...existing,
    ...meta,
  };
  writeStore(store);
  return store.queues[meta.userId];
}

function updateQueue(userId, partial) {
  const store = readStore();
  if (!store.queues[userId]) return null;
  store.queues[userId] = { ...store.queues[userId], ...partial };
  writeStore(store);
  return store.queues[userId];
}

function deleteQueue(userId) {
  const store = readStore();
  delete store.queues[userId];
  writeStore(store);
}

function listQueueArray() {
  const store = readStore();
  return Object.values(store.queues || {});
}

module.exports = {
  getAllQueues,
  getQueue,
  upsertQueue,
  updateQueue,
  deleteQueue,
  listQueueArray,
  STORE_FILE,
};



