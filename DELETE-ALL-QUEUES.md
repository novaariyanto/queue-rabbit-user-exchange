# 🗑️ Delete All Queues Feature

## 📋 **Overview**

Fitur **Delete All Queues** memungkinkan administrator untuk menghapus semua queue sekaligus dalam satu operasi. Fitur ini dirancang dengan multiple layer security untuk mencegah penghapusan yang tidak disengaja.

## 🚨 **Peringatan Keamanan**

⚠️ **OPERASI BERBAHAYA** - Fitur ini akan:
- Menghapus **SEMUA queue** dari RabbitMQ
- Menghapus **SEMUA metadata** queue dari store.json
- Menghentikan **SEMUA consumer** yang aktif
- **KEHILANGAN SEMUA DATA** queue yang ada

## 🛡️ **Security Measures**

### **Triple Confirmation System:**

1. **Konfirmasi Pertama - Warning Dialog**
   - Peringatan bahaya dengan detail konsekuensi
   - Penjelasan apa yang akan terjadi

2. **Konfirmasi Kedua - Text Confirmation**
   - User harus mengetik persis: `DELETE ALL QUEUES`
   - Case-sensitive validation

3. **Konfirmasi Terakhir - Final Warning**
   - Konfirmasi final sebelum eksekusi
   - Peringatan tidak dapat dibatalkan

### **API Level Security:**
```javascript
// Required confirmation text di request body
{
  "confirmText": "DELETE ALL QUEUES"
}
```

## 🔧 **Implementation Details**

### **API Endpoint:**
```
POST /admin/delete-all-queues
```

**Headers:**
```
x-api-key: your-admin-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "confirmText": "DELETE ALL QUEUES"
}
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 15,
  "errorCount": 0,
  "totalQueues": 15,
  "errors": []
}
```

### **Process Flow:**

1. **Stop All Consumers**
   - Set semua consumer status = 'stopped'
   - Prevent processing messages during deletion

2. **Delete Queues from RabbitMQ**
   - Loop through semua queue
   - Call `qm.deleteQueueByName()` untuk setiap queue

3. **Delete Metadata**
   - Remove entry dari store.json
   - Clean up local tracking data

4. **Return Statistics**
   - Count berhasil vs gagal
   - List error jika ada

## 🖥️ **Dashboard Usage**

### **Button Location:**
Tombol "Delete All Queues" berada di toolbar utama dashboard, dengan icon 🗑️.

### **User Flow:**
1. Click tombol **"Delete All Queues"**
2. Baca peringatan dengan seksama
3. Click **OK** jika yakin melanjutkan
4. Ketik **"DELETE ALL QUEUES"** (persis)
5. Click **OK** pada konfirmasi terakhir
6. Tunggu proses selesai
7. Lihat statistik hasil

### **Visual Feedback:**
- **Notification toast** selama proses
- **Alert dialog** dengan statistik detail
- **Dashboard refresh** otomatis setelah selesai

## 🧪 **Testing**

### **Manual Test via Dashboard:**
1. Buat beberapa test queue
2. Akses dashboard monitoring
3. Klik "Delete All Queues"
4. Ikuti flow konfirmasi
5. Verify semua queue terhapus

### **API Test via cURL:**
```bash
curl -X POST http://localhost:3001/admin/delete-all-queues \
  -H "x-api-key: change-me" \
  -H "Content-Type: application/json" \
  -d '{"confirmText": "DELETE ALL QUEUES"}'
```

### **Expected Results:**
```json
{
  "success": true,
  "deletedCount": 5,
  "errorCount": 0,
  "totalQueues": 5
}
```

## 🔍 **Error Handling**

### **Common Errors:**

1. **Missing Confirmation:**
```json
{
  "error": "Confirmation required. Send confirmText: \"DELETE ALL QUEUES\""
}
```

2. **Wrong Confirmation Text:**
```json
{
  "error": "Confirmation required. Send confirmText: \"DELETE ALL QUEUES\""
}
```

3. **Partial Deletion:**
```json
{
  "success": true,
  "deletedCount": 3,
  "errorCount": 2,
  "totalQueues": 5,
  "errors": [
    "Failed to delete queue queue.user.user4",
    "Error deleting user5: Queue not found"
  ]
}
```

## 📊 **Monitoring & Logging**

### **Log Events:**
```javascript
// Successful deletion
log.info('admin-delete-queue-bulk', { 
  userId: 'user1', 
  queueName: 'queue.user.user1' 
});

// Error during deletion
log.error('admin-delete-queue-bulk-error', { 
  userId: 'user2', 
  error: 'Queue not found' 
});

// Operation summary
log.info('admin-delete-all-queues', {
  deletedCount: 3,
  errorCount: 2,
  totalQueues: 5
});
```

### **Dashboard Metrics:**
After deletion, dashboard akan show:
- **Total Queues: 0**
- **Total Pending: 0** 
- **Active Consumers: 0**
- **Empty state** message di table

## 🎯 **Use Cases**

### **Development:**
- Clean up test queues setelah development
- Reset environment untuk testing baru
- Clear accumulated test data

### **Maintenance:**
- Complete system reset
- Prepare untuk migration
- Emergency cleanup

### **Troubleshooting:**
- Resolve corrupted queue states
- Clear problematic queues
- Start fresh after major issues

## ⚡ **Performance Considerations**

### **Operation Time:**
- Depends on jumlah queue (average ~100ms per queue)
- Blocking operation - dashboard akan wait
- RabbitMQ operations are sequential

### **Resource Usage:**
- Minimal CPU impact
- Brief network usage to RabbitMQ
- File I/O untuk store.json update

## 🔄 **Recovery**

### **After Accidental Deletion:**
1. **Stop panic** - data mungkin bisa direcover
2. **Check RabbitMQ Management UI** - queue mungkin masih ada
3. **Restart services** jika ada inconsistency
4. **Recreate queues** dari application logic

### **Prevention:**
- **Double-check** sebelum confirm
- **Backup store.json** sebelum major operations
- **Use individual delete** untuk targeted cleanup

## 📝 **Notes**

- ✅ Operation is **atomic** per queue (all-or-nothing per queue)
- ✅ **Detailed error reporting** jika ada failures
- ✅ **Safe to retry** jika ada partial failures
- ✅ **No data corruption** risk
- ❌ **Cannot be undone** once executed
- ❌ **Will affect** all applications using these queues
