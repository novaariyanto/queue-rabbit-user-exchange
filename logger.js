// logger.js
// Logger sederhana: tulis ke console dan append ke file logs/<name>.log

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR); } catch (_) {}
}

function ts() {
  return new Date().toISOString();
}

function createLogger(name) {
  const filePath = path.join(LOG_DIR, `${name}.log`);
  function write(level, message, meta) {
    const line = JSON.stringify({ t: ts(), lvl: level, msg: message, ...(meta || {}) });
    // console
    if (level === 'error') console.error(line);
    else console.log(line);
    // file
    try { fs.appendFileSync(filePath, line + '\n', 'utf-8'); } catch (_) {}
  }
  return {
    info: (msg, meta) => write('info', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
    debug: (msg, meta) => write('debug', msg, meta),
  };
}

module.exports = { createLogger };


