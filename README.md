# Sistem Antrian Per-User dengan RabbitMQ + Node.js (Express) + Worker + Admin Panel

Catatan: contoh ini development-ready, bukan full production-hardened. Tambahan hardening (auth/SSL/retry policy/policies RabbitMQ) disarankan untuk produksi.

## Arsitektur Singkat

```
[Producer/API] --(direct exchange:user_exchange,routingKey=user.{userId})--> [RabbitMQ]
                                                                     \
                                                                      -> [Queue durable: queue.user.{userId}] -> [Worker] -> HTTP POST ke callbackUrl
```

- Exchange: direct `user_exchange`
- Per user: routing key `user.{userId}` dan queue `queue.user.{userId}` (durable, x-expires idle 10 menit)
- Worker: consumer pool, subscribe dinamis, `prefetch` dikonfigurasi lewat env
- Admin Panel: Bootstrap 5 + polling 5s, aksi Start/Stop/Purge per queue dan global

## Folder/Files

- `api.js`: Express API (producer + admin endpoints) dan static admin panel
- `worker.js`: consumer logic (dynamic subscribe, retry/backoff sederhana)
- `queue-manager.js`: helper RabbitMQ (assert/publish/purge/stats)
- `db.js` dan `store.json`: metadata queue (userId, queueName, routingKey, createdAt, statusConsumer, counters)
- `public/`: UI Admin
- `Dockerfile`, `docker-compose.yml`
- `.env.example`: variabel contoh

## Variabel Lingkungan (.env)

```
RABBIT_URL=amqp://guest:guest@localhost:5672
PORT=3001
ADMIN_API_KEY=change-me
PREFETCH=5
SHARD_COUNT=10
DEFAULT_QUEUE_TTL_MS=600000
```

## Menjalankan Secara Lokal (tanpa Docker)

1. Install deps: `npm install`
2. Jalankan RabbitMQ lokal atau via Docker (`docker-compose up rabbitmq`)
3. Jalankan API: `npm run start`
4. Jalankan Worker: `npm run worker`
5. Buka Admin Panel: `http://localhost:3001/` (isi API key header di UI)

## Menjalankan dengan Docker Compose

```
docker-compose up -d --build
```

- API di `http://localhost:3001`
- RabbitMQ Management UI di `http://localhost:15672` (guest/guest)

## API Endpoints

- `POST /create-queue` body: `{ "userId": "u1", "ttlMs": 600000 }`
  - Result: `{ success, queueName, routingKey }`
- `POST /send-message` body: `{ "userId": "u1" | "instance_key": "u1", "callbackUrl": "http://localhost:3001/_test/callback", "payload": { "hello": "world" }, "delaySeconds": 5 }`
  - Result: `{ success, messageId }`
- Admin (kirim header `x-api-key: <ADMIN_API_KEY>`)
  - `POST /admin/stop-consumer` `{ userId }`
  - `POST /admin/start-consumer` `{ userId }`
  - `POST /admin/reset-queue` `{ userId }`
  - `POST /admin/stop-all`
  - `POST /admin/reset-all`
  - `GET /admin/queues`

### Contoh curl

```
curl -X POST http://localhost:3001/create-queue -H "Content-Type: application/json" -d '{"userId":"u1"}'

curl -X POST http://localhost:3001/send-message -H "Content-Type: application/json" \
  -d '{"instance_key":"u1","callbackUrl":"http://localhost:3001/_test/callback","payload":{"hello":"world"},"delaySeconds":5}'

curl -X POST http://localhost:3001/admin/start-consumer -H "x-api-key: change-me" -H "Content-Type: application/json" -d '{"userId":"u1"}'
curl -X POST http://localhost:3001/admin/stop-consumer -H "x-api-key: change-me" -H "Content-Type: application/json" -d '{"userId":"u1"}'
curl -X POST http://localhost:3001/admin/reset-queue -H "x-api-key: change-me" -H "Content-Type: application/json" -d '{"userId":"u1"}'
curl -X POST http://localhost:3001/admin/stop-all -H "x-api-key: change-me"
curl -X POST http://localhost:3001/admin/reset-all -H "x-api-key: change-me"
curl -X GET http://localhost:3001/admin/queues -H "x-api-key: change-me"
```

### Endpoint Callback Uji (untuk demo)

- `POST /_test/callback` akan log payload di server API dan balas `{ ok: true }`

## Retry/Backoff

- Worker menerapkan retry sederhana dengan exponential backoff di memori: jika HTTP gagal, pesan di-ack dan di-republish dengan header `x-attempt` dinaikkan, delay `min(60s, 2^attempt * 1s)`, maksimum 5x.
- Untuk produksi: pertimbangkan menggunakan delay queue (x-dead-letter-exchange + x-message-ttl) agar backoff terkelola oleh broker, juga circuit breaker & idempotensi di callback.

## Keamanan (Contoh)

- Admin API dilindungi API key sederhana (header `x-api-key`). Untuk produksi, gunakan auth lebih kuat (mTLS, OIDC), rate limit, audit logging, dan TLS.

## Skalabilitas (hingga 10.000 user)

1) Per-user queue (direct exchange) – implementasi contoh ini
   - Kelebihan: isolasi per user, ordering per queue terjaga, kontrol granular start/stop
   - Kekurangan: overhead resource (queue/consumer), manajemen banyak objek broker
   - Rekomendasi: gunakan consumer pool (1 worker untuk banyak queue), TTL `x-expires` untuk hapus queue idle, purge queue lama, serta batasi jumlah consumer aktif bersamaan.

2) Topic exchange atau single-queue pattern (direkomendasikan untuk skala sangat besar)
   - Gunakan `topic exchange` dengan binding `user.*` atau satu queue global, `userId` di payload
   - Kelebihan: objek broker jauh lebih sedikit, lebih hemat resource
   - Kekurangan: ordering per user dikendalikan di kode (mis. shard + per-key serialization)

3) Sharding
   - Buat N shard: `shard.0..N-1`
   - Pilih shard dengan `hash(userId) % N`
   - Worker pool per shard untuk paralelisme dan isolasi

## Tuning & Monitoring RabbitMQ

- Gunakan vhost terpisah, atur policy TTL, lazy queues jika cocok
- Batasi channel/connection sesuai kapasitas, gunakan connection pooling
- Aktifkan management UI dan Prometheus exporter untuk metrik (lag, rata-rata ack, rate publish)

## Catatan Produksi

- Pastikan callback endpoint idempotent (gunakan messageId), TLS aktif, timeouts dan retries terkontrol
- Pertimbangkan dead-letter exchange untuk pesan gagal permanen, observabilitas (traceId), logs terstruktur



