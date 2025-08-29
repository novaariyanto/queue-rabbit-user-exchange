// idle-cleanup.js
// Service untuk auto cleanup queue yang idle lebih dari timeout tertentu

require('dotenv').config();
const db = require('./db');
const qm = require('./queue-manager');
const { createLogger } = require('./logger');

const log = createLogger('idle-cleanup');

// Konfigurasi
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_QUEUE_TIMEOUT_MS || 300000); // 5 minutes
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 60000); // 1 minute check
const AUTO_CLEANUP_ENABLED = (process.env.AUTO_CLEANUP_ENABLED || 'true') === 'true';

let cleanupInterval = null;

async function cleanupIdleQueues() {
  try {
    if (!AUTO_CLEANUP_ENABLED) {
      return;
    }

    const idleQueues = db.getIdleQueues(IDLE_TIMEOUT_MS);
    
    if (idleQueues.length === 0) {
      log.debug('cleanup-check', { idleQueues: 0 });
      return;
    }

    log.info('cleanup-start', { 
      idleQueues: idleQueues.length, 
      timeoutMinutes: Math.round(IDLE_TIMEOUT_MS / 60000)
    });

    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const queue of idleQueues) {
      try {
        // Stop consumer jika masih aktif
        if (queue.consumerStatus === 'started') {
          db.updateQueue(queue.userId, { consumerStatus: 'stopped' });
        }

        // Delete queue dari RabbitMQ
        const deleted = await qm.deleteQueueByName(queue.queueName);
        
        if (deleted) {
          // Hapus metadata
          db.deleteQueue(queue.userId);
          deletedCount++;
          
          log.info('queue-auto-deleted', {
            userId: queue.userId,
            queueName: queue.queueName,
            idleTimeMinutes: queue.idleTimeMinutes,
            lastActivity: queue.lastActivityAt
          });
        } else {
          errorCount++;
          errors.push(`Failed to delete queue ${queue.queueName}`);
          log.error('queue-delete-failed', {
            userId: queue.userId,
            queueName: queue.queueName,
            error: 'Delete operation failed'
          });
        }
      } catch (error) {
        errorCount++;
        errors.push(`Error deleting ${queue.userId}: ${error.message}`);
        log.error('queue-cleanup-error', {
          userId: queue.userId,
          error: error.message
        });
      }
    }

    if (deletedCount > 0 || errorCount > 0) {
      log.info('cleanup-summary', {
        deletedCount,
        errorCount,
        totalProcessed: idleQueues.length,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    return {
      deletedCount,
      errorCount,
      totalProcessed: idleQueues.length,
      errors
    };

  } catch (error) {
    log.error('cleanup-service-error', { error: error.message });
    return null;
  }
}

function startCleanupService() {
  if (cleanupInterval) {
    return;
  }

  if (!AUTO_CLEANUP_ENABLED) {
    log.info('cleanup-service-disabled');
    return;
  }

  log.info('cleanup-service-start', {
    idleTimeoutMinutes: Math.round(IDLE_TIMEOUT_MS / 60000),
    checkIntervalMinutes: Math.round(CLEANUP_INTERVAL_MS / 60000),
    enabled: AUTO_CLEANUP_ENABLED
  });

  // Jalankan cleanup pertama kali setelah 1 menit (untuk memberikan waktu sistem startup)
  setTimeout(cleanupIdleQueues, 60000);

  // Setup interval cleanup
  cleanupInterval = setInterval(cleanupIdleQueues, CLEANUP_INTERVAL_MS);
}

function stopCleanupService() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('cleanup-service-stopped');
  }
}

// Manual cleanup function untuk testing/debugging
async function manualCleanup() {
  log.info('manual-cleanup-triggered');
  return await cleanupIdleQueues();
}

// Get current idle queues without deleting (untuk monitoring)
function getIdleQueueStatus() {
  const idleQueues = db.getIdleQueues(IDLE_TIMEOUT_MS);
  return {
    enabled: AUTO_CLEANUP_ENABLED,
    idleTimeoutMinutes: Math.round(IDLE_TIMEOUT_MS / 60000),
    checkIntervalMinutes: Math.round(CLEANUP_INTERVAL_MS / 60000),
    currentIdleQueues: idleQueues.length,
    queues: idleQueues.map(q => ({
      userId: q.userId,
      queueName: q.queueName,
      idleTimeMinutes: q.idleTimeMinutes,
      lastActivity: q.lastActivityAt,
      consumerStatus: q.consumerStatus
    }))
  };
}

module.exports = {
  startCleanupService,
  stopCleanupService,
  manualCleanup,
  cleanupIdleQueues,
  getIdleQueueStatus,
  IDLE_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  AUTO_CLEANUP_ENABLED
};
