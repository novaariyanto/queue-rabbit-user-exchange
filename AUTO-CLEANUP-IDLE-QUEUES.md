# 🕐 Auto Cleanup Idle Queues Feature

## 📋 **Overview**

Fitur **Auto Cleanup Idle Queues** secara otomatis menghapus queue yang tidak aktif (idle) lebih dari waktu yang ditentukan. Ini membantu menjaga kebersihan sistem dan mengoptimalkan penggunaan resource.

## ⚙️ **Konfigurasi**

### **Default Settings:**
```javascript
IDLE_TIMEOUT_MS = 300000        // 5 minutes (300000ms)
CLEANUP_INTERVAL_MS = 60000     // 1 minute check interval
AUTO_CLEANUP_ENABLED = true     // Enable/disable auto cleanup
```

### **Cara Konfigurasi:**
Ubah langsung di kode atau melalui environment variables:
```bash
IDLE_QUEUE_TIMEOUT_MS=300000    # 5 minutes
AUTO_CLEANUP_ENABLED=true
CLEANUP_INTERVAL_MS=60000       # 1 minute
```

## 🎯 **Cara Kerja**

### **1. Activity Tracking**
Sistem melacak aktivitas queue melalui:
- **Message Processing** - Setiap kali pesan diproses
- **New Messages** - Setiap kali ada pesan baru masuk
- **lastActivityAt** timestamp diupdate otomatis

### **2. Idle Detection**
```javascript
// Queue dianggap idle jika:
const idleTime = currentTime - lastActivityAt;
if (idleTime > IDLE_TIMEOUT_MS) {
  // Queue idle, akan dihapus
}
```

### **3. Auto Cleanup Process**
1. **Check Interval** - Setiap 1 menit sistem mengecek queue idle
2. **Stop Consumer** - Consumer distop sebelum deletion
3. **Delete from RabbitMQ** - Queue dihapus dari broker
4. **Remove Metadata** - Data queue dihapus dari store.json
5. **Logging** - Semua operasi dicatat di log

## 🖥️ **Dashboard Features**

### **Auto Cleanup Status Panel:**
- ✅ **Status**: Enabled/Disabled indicator
- ⏰ **Idle Timeout**: Durasi timeout (default 5 minutes)
- 📊 **Current Idle Queues**: Jumlah queue yang sedang idle
- 🔄 **Check Interval**: Interval pengecekan (default 1 minute)

### **Idle Queue Details Panel:**
- 📋 **List** queue yang sedang idle
- ⏱️ **Idle Duration** untuk setiap queue
- 🔧 **Status** consumer setiap queue

### **Action Buttons:**
- 🧹 **Cleanup Now** - Trigger manual cleanup
- 🔄 **Refresh** - Update status terkini

### **Queue Table Enhancements:**
- 📅 **Activity Time** - Timestamp aktivitas terakhir
- 🎨 **Visual Indicators** untuk queue status

## 🔧 **API Endpoints**

### **1. Get Idle Status**
```
GET /admin/idle-status
```

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "idleTimeoutMinutes": 5,
  "checkIntervalMinutes": 1,
  "currentIdleQueues": 3,
  "queues": [
    {
      "userId": "user1",
      "queueName": "queue.user.user1",
      "idleTimeMinutes": 7,
      "lastActivity": "2024-01-01T10:00:00Z",
      "consumerStatus": "started"
    }
  ]
}
```

### **2. Manual Cleanup**
```
POST /admin/cleanup-idle
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 2,
  "errorCount": 0,
  "totalProcessed": 2,
  "errors": []
}
```

## 📊 **Monitoring & Logging**

### **Log Events:**
```javascript
// Service startup
log.info('cleanup-service-start', {
  idleTimeoutMinutes: 5,
  checkIntervalMinutes: 1,
  enabled: true
});

// Queue auto deleted
log.info('queue-auto-deleted', {
  userId: 'user1',
  queueName: 'queue.user.user1',
  idleTimeMinutes: 7,
  lastActivity: '2024-01-01T10:00:00Z'
});

// Cleanup summary
log.info('cleanup-summary', {
  deletedCount: 2,
  errorCount: 0,
  totalProcessed: 2
});
```

### **Error Handling:**
```javascript
// Individual queue errors
log.error('queue-cleanup-error', {
  userId: 'user1',
  error: 'Connection timeout'
});

// Service errors
log.error('cleanup-service-error', {
  error: 'RabbitMQ connection failed'
});
```

## 🧪 **Testing**

### **Manual Test:**
1. Buat test queue
2. Kirim beberapa pesan
3. Tunggu 5+ menit tanpa aktivitas
4. Queue akan otomatis terhapus

### **Manual Cleanup Test:**
```bash
# Via Dashboard
1. Buka dashboard
2. Lihat "Auto Cleanup Status"
3. Klik "Cleanup Now"
4. Lihat hasil di notification

# Via API
curl -X POST http://localhost:3001/admin/cleanup-idle \
  -H "x-api-key: change-me"
```

### **Status Check:**
```bash
curl -X GET http://localhost:3001/admin/idle-status \
  -H "x-api-key: change-me"
```

## ⚠️ **Important Notes**

### **Best Practices:**
1. **Monitor Logs** - Check cleanup activity regularly
2. **Adjust Timeout** - Sesuaikan dengan use case aplikasi
3. **Test Thoroughly** - Test di development sebelum production
4. **Backup Data** - Backup store.json secara berkala

### **Considerations:**
- ✅ **Queue kosong** akan dihapus jika idle
- ✅ **Queue dengan pesan pending** tetap bisa dihapus jika idle
- ✅ **Consumer active** tidak mencegah deletion jika idle
- ❌ **Data recovery** tidak mungkin setelah queue dihapus

### **Impact:**
- **Performance** - Mengurangi memory usage di RabbitMQ
- **Resource** - Cleanup ringan, tidak mempengaruhi kinerja
- **Applications** - Aplikasi harus handle queue recreation

## 🚨 **Safety Measures**

### **Graceful Deletion:**
1. **Stop Consumer** sebelum delete
2. **Log Detail** setiap deletion
3. **Error Handling** untuk partial failures
4. **Non-blocking** - Tidak mengganggu queue lain

### **Monitoring Alerts:**
```javascript
// Setup alerts untuk:
- High cleanup frequency (> 10 queue/hour)
- Cleanup errors
- Service downtime
```

## 🔄 **Integration with Worker**

### **Worker Integration:**
```javascript
// Di worker.js
const idleCleanup = require('./idle-cleanup');

// Start service
idleCleanup.startCleanupService();

// Graceful shutdown
process.on('SIGINT', () => {
  idleCleanup.stopCleanupService();
});
```

### **Activity Updates:**
```javascript
// Otomatis update activity saat:
1. Pesan diproses (worker.js)
2. Pesan baru masuk (api.js)
3. Consumer start/stop
```

## 📈 **Benefits**

### **Resource Optimization:**
- 🔥 **Reduced Memory** - Fewer queue objects di RabbitMQ
- 💨 **Better Performance** - Cleaner queue management
- 📊 **Efficient Monitoring** - Focus pada queue aktif

### **Maintenance:**
- 🧹 **Self-Cleaning** - Otomatis maintenance
- 🔍 **Better Visibility** - Clear idle queue identification
- ⚡ **Quick Recovery** - Queue recreated otomatis saat needed

### **Operational:**
- 🎯 **Reduced Noise** - Monitoring fokus queue aktif
- 📝 **Better Logs** - Cleaner log output
- 🛡️ **System Health** - Prevent queue accumulation

## 🎯 **Use Cases**

### **Development:**
- Auto cleanup test queues
- Development environment maintenance
- Temporary queue management

### **Production:**
- Inactive user cleanup
- Seasonal application queues
- Microservice queue lifecycle

### **Testing:**
- Test environment cleanup
- Load testing cleanup
- CI/CD environment maintenance

## 📋 **Configuration Examples**

### **Aggressive Cleanup (1 minute):**
```javascript
IDLE_TIMEOUT_MS = 60000         // 1 minute
CLEANUP_INTERVAL_MS = 30000     // 30 seconds check
```

### **Conservative Cleanup (30 minutes):**
```javascript
IDLE_TIMEOUT_MS = 1800000       // 30 minutes
CLEANUP_INTERVAL_MS = 300000    // 5 minutes check
```

### **Disable Auto Cleanup:**
```javascript
AUTO_CLEANUP_ENABLED = false
```

Fitur ini memberikan **automated queue lifecycle management** yang membantu menjaga sistem tetap clean dan efficient! 🚀
