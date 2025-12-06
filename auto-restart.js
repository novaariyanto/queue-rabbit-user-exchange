const { exec } = require("child_process");

// Interval 3 jam = 3 * 60 * 60 * 1000 ms
const interval = 3 * 60 * 60 * 1000;

function restartPM2() {
  console.log(`[${new Date().toISOString()}] Restarting PM2 ...`);

  exec("pm2 restart all", (error, stdout, stderr) => {
    if (error) {
      console.error(`[ERROR] ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`[STDERR] ${stderr}`);
    }
    console.log(`[STDOUT] ${stdout}`);
  });
}

// Jalankan pertama kali saat start
//restartPM2();

// Jalankan setiap 3 jam
setInterval(restartPM2, interval);

