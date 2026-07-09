# WMS Deployment Guide — Homelab `zeyadev.web.id`

Deploy WMS (Warehouse Management System) ke subdomain `wms-dev.zeyadev.web.id`
menggunakan Docker Compose + Cloudflare Tunnel.

---

## 1. Arsitektur

```
Browser ── HTTPS ──▶ Cloudflare ──▶ Cloudflare Tunnel ──▶ localhost:3080
                                                              │
                                                    ┌─────────▼──────────────┐
                                                    │  wms-frontend          │
                                                    │  nginx (React SPA)     │
                                                    │  reverse-proxy /api    │
                                                    │  → backend:3000        │
                                                    └─────────┬──────────────┘
                                                              │
                                                    ┌─────────▼──────────────┐
                                                    │  wms-backend           │
                                                    │  NestJS + Prisma       │
                                                    └─────────┬──────────────┘
                                                              │
                                                    ┌─────────▼──────────────┐
                                                    │  wms-db                │
                                                    │  PostgreSQL 16         │
                                                    └────────────────────────┘
```

- **Same-origin:** nginx reverse-proxy `/api` ke backend — tanpa CORS.
- **TLS/HTTPS:** Cloudflare (terminated di edge).
- **Database:** PostgreSQL 16 container — data persist di named volume `pgdata`.

---

## 2. Prasyarat

- Docker & Docker Compose plugin
- Cloudflare Tunnel (`cloudflared`) sudah running & terautentikasi
- Domain `zeyadev.web.id` terkelola di Cloudflare (DNS + proxy)
- Port **3080** tidak terpakai

Cek port:

```bash
ss -tlnp | grep 3080  # harus tidak ada output
```

---

## 3. Struktur Direktori

```
/home/fadlan/homelab/wms/
├── backend/
│   ├── src/
│   ├── prisma/
│   ├── package.json
│   ├── Dockerfile
│   └── .env.production              ← credentials (jangan commit)
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── DEPLOYMENT.md                    ← dokumentasi ini
```

---

## 4. Clone Repository

```bash
cd /home/fadlan/homelab
git clone https://github.com/aabizardd/WMS-Claude-POC wms
cd wms
```

---

## 5. Environment Configuration

### 5.1 Generate Secrets

```bash
# JWT Secret (64-char hex)
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# POSTGRES_PASSWORD (acak kuat)
POSTGRES_PASSWORD=$(node -e "
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p = '';
  for (let i = 0; i < 32; i++) p += c[Math.floor(Math.random() * c.length)];
  console.log(p);
")

echo "JWT_SECRET=$JWT_SECRET"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
```

Simpan `POSTGRES_PASSWORD` di tempat aman (password manager / `.env` terpisah).

### 5.2 `backend/.env.production`

```bash
touch backend/.env.production
chmod 600 backend/.env.production
```

Isi:

```env
NODE_ENV=production
PORT=3000

# Database — host "db" = container postgres di compose
DATABASE_URL="postgresql://wms:<POSTGRES_PASSWORD>@db:5432/wms?schema=public"

# JWT — 64-char hex
JWT_SECRET="<JWT_SECRET>"
JWT_EXPIRES_IN="1d"

# CORS — kosong karena same-origin
FRONTEND_ORIGIN=""

# Oracle / ERP bridge
ERP_BASE_URL="https://api-bridge-sb.motorsights.com/api/v1/bridge"
ERP_CLIENT_ID="apikey_a83d7c5e91b24f6a0d3e8b7c2f9a1456"
ERP_CLIENT_SECRET="1f7a9c3d5e2b8a6c4d0e1f9b7a3c5d8e2f6a1b4c9d7e3f0a8c6b2d5e1f9a7c3d"
ERP_SYNC_PAGE_SIZE=200
ERP_SYNC_PAGE_DELAY_MS=1500

# Background Oracle sync scheduler (incremental)
ERP_SYNC_SCHEDULER_ENABLED=true
ERP_SYNC_INTERVAL_MS=3600000
```

Ganti `<POSTGRES_PASSWORD>` dan `<JWT_SECRET>` dengan hasil generate.

---

## 6. Docker Compose

File: `/home/fadlan/homelab/wms/docker-compose.yml`

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wms}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-wms}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-wms}']
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    restart: unless-stopped
    env_file:
      - ./backend/.env.production
    environment:
      DATABASE_URL: >-
        postgresql://${POSTGRES_USER:-wms}:${POSTGRES_PASSWORD}
        @db:5432/${POSTGRES_DB:-wms}?schema=public
      PORT: 3000
    depends_on:
      db:
        condition: service_healthy
    expose:
      - '3000'

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: ''
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - '3080:80'

volumes:
  pgdata:
```

**Catatan:** Port frontend di-*remap* dari `80:80` → `3080:80` untuk menghindari bentrok dengan service lain.

---

## 7. Build & Deploy

### 7.1 Build dan Start

```bash
cd /home/fadlan/homelab/wms

export POSTGRES_PASSWORD="<isi dari langkah 5.1>"

docker compose up -d --build
```

### 7.2 Pantau Proses Startup

```bash
# Cek status semua container
docker compose ps

# Pantau log backend (migration + startup)
docker compose logs -f backend
```

Tunggu sampai backend siap (migration selesai dan server start). Look for log seperti:

```
[Prisma] Migrations applied: wms
[Nest] INFO Starting Nest application...
[Nest] INFO Nest application successfully started
```

### 7.3 Seed Database

```bash
# Seed default admin + permissions (cukup sekali)
docker compose exec backend npm run prisma:seed
```

Output yang diharapkan:
```
Seeding default permissions...
Seeding admin role...
Seeding staff role...
Seeding admin user...
```

### 7.4 Verifikasi Lokal

```bash
# Frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:3080
# Expected: 200

# API
curl -s -X POST http://localhost:3080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | head -c 200
# Expected: JSON response dengan access_token
```

---

## 8. Cloudflare Tunnel Configuration

### 8.1 Edit Config

Edit `/etc/cloudflared/config.yml`:

```yaml
tunnel: f0ebb7c5-e5dd-427b-a0fe-ab1dd99e9f4f
credentials-file: /home/fadlan/.cloudflared/f0ebb7c5-e5dd-427b-a0fe-ab1dd99e9f4f.json

ingress:
  - hostname: photos.zeyadev.web.id
    service: http://localhost:2283

  - hostname: media.zeyadev.web.id
    service: http://localhost:8096

  - hostname: status.zeyadev.web.id
    service: http://localhost:3001

  - hostname: portainer.zeyadev.web.id
    service: https://localhost:9443
    originRequest:
      noTLSVerify: true

  - hostname: code.zeyadev.web.id
    service: http://localhost:3000

  - hostname: cloud.zeyadev.web.id
    service: http://localhost:8080

  # ── WMS ──
  - hostname: wms-dev.zeyadev.web.id
    service: http://localhost:3080

  - service: http_status:404
```

### 8.2 Restart Tunnel

```bash
sudo systemctl restart cloudflared
```

### 8.3 Verifikasi Tunnel

```bash
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 20 --no-pager
```

Cari log seperti:
```
INF Request / origin IP: ...  host="wms-dev.zeyadev.web.id"
```

---

## 9. DNS Configuration (Cloudflare Dashboard)

Tambah CNAME record:

1. Buka https://dash.cloudflare.com → pilih `zeyadev.web.id`
2. **DNS → Records → Add record**
3. Isi:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| `CNAME` | `wms-dev` | `f0ebb7c5-e5dd-427b-a0fe-ab1dd99e9f4f.cfargotunnel.com` | Proxied (orange cloud) |

> Jika ragu dengan `cfargotunnel.com`, cek tunnel ID:
> ```bash
> sudo /usr/bin/cloudflared tunnel list
> # Format target: <tunnel-id>.cfargotunnel.com
> ```

---

## 10. Final Verification

```bash
# Dari server lokal
curl -s -o /dev/null -w "%{http_code}" http://localhost:3080

# Via Cloudflare (dari luar)
curl -s -o /dev/null -w "%{http_code}" https://wms-dev.zeyadev.web.id
```

Buka browser → https://wms-dev.zeyadev.web.id

**Login:**
| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

> **⚠️ WAJIB:** Ganti password segera setelah login pertama!

---

## 11. Maintenance

### Restart Services

```bash
cd /home/fadlan/homelab/wms
docker compose restart
```

### Rebuild + Deploy (setelah update code)

```bash
cd /home/fadlan/homelab/wms
git pull
docker compose build --no-cache
docker compose up -d
```

### Logs

```bash
docker compose logs -f            # semua service
docker compose logs -f backend     # backend saja
docker compose logs -f frontend    # frontend saja
```

### Backup Database

```bash
docker compose exec -T db pg_dump -U wms wms > ~/backups/wms-$(date +%Y%m%d-%H%M%S).sql
```

### Reseed (idempotent)

```bash
docker compose exec backend npm run prisma:seed
```

### Reset Database (data hilang)

```bash
cd /home/fadlan/homelab/wms
docker compose down
docker volume rm wms_pgdata
docker compose up -d
# tunggu db siap lalu:
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
```

---

## 12. Troubleshooting

| Masalah | Kemungkinan | Solusi |
|---------|-------------|--------|
| `502 Bad Gateway` | Backend belum siap | `docker compose logs -f backend` — tunggu migration + startup |
| Login gagal (`401`) | Belum seed | `docker compose exec backend npm run prisma:seed` |
| `ECONNREFUSED` database | db container belum siap | `docker compose logs -f db` — cek healthcheck |
| Cloudflare `521` / `522` | Tunnel mati | `sudo systemctl restart cloudflared` |
| Port `3080` bentrok | Service lain pakai port itu | `ss -tlnp \| grep 3080` — ganti port di compose |
| API `404` | nginx proxy_pass salah | Cek `frontend/nginx.conf` — pastikan `proxy_pass http://backend:3000;` |
| CORS error di browser | FRONTEND_ORIGIN salah / split-origin | Set `FRONTEND_ORIGIN=""` untuk same-origin |

---

## 13. Rollback

```bash
cd /home/fadlan/homelab/wms

# Hentikan dan hapus containers
docker compose down

# Hapus volume database (data hilang!)
docker volume rm wms_pgdata

# Hapus dari Cloudflare Tunnel
# Edit /etc/cloudflared/config.yml → hapus baris wms-dev.zeyadev.web.id
sudo systemctl restart cloudflared

# Hapus directory (optional)
cd /home/fadlan/homelab && rm -rf wms
```
