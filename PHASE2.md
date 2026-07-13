# Phase 2 — Infrastructure: Off-site Backup ke Cloudflare R2

## Overview

Phase 2 menambahkan off-site backup ke **Cloudflare R2** sebagai pelengkap backup lokal harian.
Backup tetap jalan setiap jam 02:00 UTC (cron), dump lokal + upload ke R2 secara otomatis.

---

## 1. Arsitektur

```
Cron (02:00 UTC)
    │
    ▼
scripts/backup-db.sh
    │
    ├──► Local: /home/fadlan/homelab/backups/wms/wms-YYYYMMDD-HHMMSS.sql.gz
    │           Retention: 30 hari (auto-delete)
    │
    └──► R2:    rclone copy → r2:wms-backups-zeyadev/daily/
                Retention: 60 hari (auto-delete via --min-age)
```

**Konsekuensi:**
- Jika disk server mati → backup di R2 tetap aman (off-site)
- Jika R2 tidak reachable → backup lokal tetap jalan (graceful degradation)

---

## 2. Prasyarat

- Cloudflare account dengan R2 enabled
- R2 bucket `wms-backups-zeyadev` sudah dibuat (Standard, free tier)
- R2 API token (Object Read & Write) scoped ke bucket tersebut
- `rclone` binary di `~/.local/bin/rclone`
- `~/.config/rclone/rclone.conf` dengan remote `[r2]`

---

## 3. Setup

### 3.1 Buat R2 Bucket (via Cloudflare Dashboard)

1. Buka https://dash.cloudflare.com → sidebar **R2**
2. **Create bucket**
   - Bucket name: `wms-backups-zeyadev`
   - Location: Automatic (atau APAC)
   - Default Storage Class: **Standard** (free tier)
3. Klik **Create bucket**

### 3.2 Generate R2 API Token (via Cloudflare Dashboard)

1. R2 sidebar → **Manage R2 API Tokens**
2. **Create API Token**
   - Permission: **Object Read & Write**
   - Token name: `wms-backup-action`
   - Specify bucket: pilih `wms-backups-zeyadev` saja (least privilege)
   - TTL: **Forever**
3. Copy & simpan aman:

```
Access Key ID:     e24e91431440ff8d1ad4370379849718
Secret Access Key: 835bae3572ab650c0b77391a98121d186a7b3fd83e0f4189e1ea94b77580015a
Account ID:        fd1adeee26101e91c078f711593f2394
```

> **⚠️ Secret Access Key hanya muncul sekali!** Simpan di password manager.

### 3.3 Install rclone (Sudah dilakukan)

```bash
curl -sSLO https://downloads.rclone.org/rclone-current-linux-amd64.deb
dpkg -x rclone-current-linux-amd64.deb /tmp/rclone-extract
mkdir -p ~/.local/bin
cp /tmp/rclone-extract/usr/bin/rclone ~/.local/bin/
chmod +x ~/.local/bin/rclone
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
rm -f rclone-current-linux-amd64.deb
rm -rf /tmp/rclone-extract
```

### 3.4 Konfigurasi rclone remote (Sudah dilakukan)

```bash
mkdir -p ~/.config/rclone
cat > ~/.config/rclone/rclone.conf <<'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = e24e91431440ff8d1ad4370379849718
secret_access_key = 835bae3572ab650c0b77391a98121d186a7b3fd83e0f4189e1ea94b77580015a
endpoint = https://fd1adeee26101e91c078f711593f2394.r2.cloudflarestorage.com
no_check_bucket = true
EOF
chmod 600 ~/.config/rclone/rclone.conf
```

### 3.5 Update Script Backup (Sudah dilakukan)

File: `scripts/backup-db.sh`

Perubahan:
- Menambah variabel `R2_REMOTE="r2:wms-backups-zeyadev"` dan `RCLONE_LOG`
- Setelah dump lokal + cleanup, tambah block upload ke R2:
  ```bash
  if command -v rclone &>/dev/null && [ -f "$HOME/.config/rclone/rclone.conf" ]; then
    rclone copy "$BACKUP_FILE" "$R2_REMOTE/daily/" --log-file "$RCLONE_LOG" --log-level INFO
    rclone delete "$R2_REMOTE/daily/" --min-age 60d &>/dev/null || true
  fi
  ```
- **Graceful:** jika rclone tidak terinstall atau config hilang, backup lokal tetap jalan tanpa error

---

## 4. File Locations

| Item | Path |
|------|------|
| Script backup | `/home/fadlan/homelab/wms/scripts/backup-db.sh` |
| Backup lokal | `/home/fadlan/homelab/backups/wms/` |
| Log rclone | `/home/fadlan/homelab/backups/wms/rclone.log` |
| Config rclone | `~/.config/rclone/rclone.conf` (chmod 600) |
| Binary rclone | `~/.local/bin/rclone` |
| R2 bucket | `r2:wms-backups-zeyadev/daily/` |
| Script auto-deploy | `/home/fadlan/homelab/wms/scripts/auto-deploy.sh` (chmod 700) |
| Log auto-deploy | `/home/fadlan/homelab/backups/wms/deploy.log` |
| Lock file | `/tmp/wms-deploy.lock` (cegah overlap) |
| Cron backup | `0 2 * * * /home/fadlan/homelab/wms/scripts/backup-db.sh >> /home/fadlan/homelab/backups/wms/backup.log 2>&1` |
| Cron auto-deploy | `*/5 * * * * /home/fadlan/homelab/wms/scripts/auto-deploy.sh` |
| Telegram bot | Credentials di `.env.telegram` (tidak di-commit) |

---

## 4. Auto-Deploy (via Cron + Telegram)

Setiap 5 menit cron mengecek branch `dev-fadlan`. Jika ada commit baru:

```
Git push → repo
   │
Cron */5 * * * *
   ├── git fetch → tidak ada perubahan? → skip (0 notifikasi)
   │
   └── ada commit baru?
         ├── 1. backup-db.sh (safety)
         ├── 2. git pull + docker compose build --pull
         ├── 3. docker compose up -d
         ├── 4. health check (/api/health)
         ├── 200? → Telegram ✅
         └── gagal? → git reset --hard ke commit sebelumnya
                        → rebuild + redeploy
                        → Telegram ❌ + rollback ✅/❌
```

### Script

`/home/fadlan/homelab/wms/scripts/auto-deploy.sh`

- **Lock file:** `/tmp/wms-deploy.lock` (cegah overlap jika build >5 menit)
- **Log:** `/home/fadlan/homelab/backups/wms/deploy.log`
- **Notifikasi:** Telegram via bot — credentials di `.env.telegram` (tidak di-commit)

### Cron

```cron
*/5 * * * * /home/fadlan/homelab/wms/scripts/auto-deploy.sh
```

### Trigger Manual

```bash
bash /home/fadlan/homelab/wms/scripts/auto-deploy.sh
```

---

### 5.1 Cek Backup Lokal

```bash
ls -lh /home/fadlan/homelab/backups/wms/
```

### 5.2 Cek Backup di R2

```bash
rclone ls r2:wms-backups-zeyadev/daily/
```

### 5.3 Test Restore dari R2 (full cycle)

```bash
# Download file terbaru dari R2
rclone copy r2:wms-backups-zeyadev/daily/ /tmp/r2-test/

# Verify integrity
gunzip -t /tmp/r2-test/*.sql.gz

# Restore ke temporary database
docker exec wms-db-1 createdb -U wms wms_restore_test
gunzip -c /tmp/r2-test/*.sql.gz | docker exec -i wms-db-1 psql -U wms -d wms_restore_test -q

# Verify data
docker exec wms-db-1 psql -U wms -d wms_restore_test -c "\dt"
docker exec wms-db-1 psql -U wms -d wms_restore_test -t -c 'SELECT COUNT(*) FROM users;'

# Cleanup
docker exec wms-db-1 dropdb -U wms wms_restore_test
rm -rf /tmp/r2-test/
```

---

## 6. Backup Retention Policy

| Location | Retention | Mechanism |
|----------|-----------|-----------|
| Local (`/home/fadlan/homelab/backups/wms/`) | 30 hari | `find -mtime +30 -delete` |
| R2 (`r2:wms-backups-zeyadev/daily/`) | 60 hari | `rclone delete --min-age 60d`|

---

## 7. Maintenance

### Menambah R2 Token Baru (jika expire)

1. Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create
2. Update `~/.config/rclone/rclone.conf`
3. `chmod 600 ~/.config/rclone/rclone.conf`
4. Test: `rclone ls r2:wms-backups-zeyadev/daily/`

### Force Backup Sekarang

```bash
bash /home/fadlan/homelab/wms/scripts/backup-db.sh
```

### Cek Status

```bash
# Running?
docker ps --format "table {{.Names}}\t{{.Status}}"

# Cron aktif?
crontab -l | grep -E "backup|deploy"

# Log auto-deploy
tail -f /home/fadlan/homelab/backups/wms/deploy.log

# Disk usage backup lokal
du -sh /home/fadlan/homelab/backups/wms/

# R2 usage
rclone ls r2:wms-backups-zeyadev/daily/ | awk '{sum+=$1} END {printf "%.2f MB\n", sum/1048576}'
```

---

## 8. Hasil Test (Juli 2026)

Verifikasi end-to-end berhasil:

| Step | Status | Detail |
|------|--------|--------|
| rclone install (v1.74.4) | ✅ | Binary di `~/.local/bin/rclone` |
| rclone remote config | ✅ | Object Read & Write scoped ke bucket |
| Upload ke R2 | ✅ | 569KB, 0.4s transfer |
| Download + gunzip verify | ✅ | Integrity OK |
| Full script end-to-end | ✅ | Lokal + R2 upload, 1 file di R2 |
| Graceful degradation | ✅ | Script tetap error jika rclone tidak ada |
| Auto-deploy script created | ✅ | `scripts/auto-deploy.sh` (chmod 700) |
| No-change skip | ✅ | Exit 0 tanpa notifikasi |
| Cron `*/5 * * * *` | ✅ | Terdaftar di crontab |
| Telegram bot integration | ✅ | Notifikasi ✅/❌ via bot ke chat admin |
| Rollback logic | ✅ | `git reset --hard` ke commit sebelumnya + rebuild + redeploy |
| Lock file (cegah overlap) | ✅ | `flock /tmp/wms-deploy.lock` |

---

## 9. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `AccessDenied` pada `rclone lsd` | Token tidak punya ListBuckets permission | Normal — gunakan `rclone ls r2:wms-backups-zeyadev/` langsung |
| Upload gagal | Token expired / revoked | Buat token baru → update `rclone.conf` |
| Script error "command not found: rclone" | PATH tidak set | Jalankan dengan `export PATH="$HOME/.local/bin:$PATH"` dulu |
| File kosong di R2 | DB connection issue | Cek `docker compose logs db` — pastikan PostgreSQL running |
| R2 file lebih besar dari lokal | Encryption overhead (slight) | Normal — R2 server-side encryption |
| Auto-deploy skip terus | Cron mati / lock file stuck | `crontab -l` cek cron, `rm /tmp/wms-deploy.lock` hapus lock |
| Auto-deploy rollback terus | Code ada breaking change | Cek `deploy.log`, fix code, push ulang, trigger manual `auto-deploy.sh` |
| Telegram notif tidak masuk | Bot token / chat ID salah | Cek `.env.telegram` — pastikan `BOT_TOKEN` dan `CHAT_ID` benar |
