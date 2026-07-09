#!/bin/bash
set -e

BACKUP_DIR=/home/fadlan/homelab/backups/wms
COMPOSE_FILE=/home/fadlan/homelab/wms/docker-compose.yml
SECRET_FILE=/home/fadlan/homelab/wms/.env.secret
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

if [ -f "$SECRET_FILE" ]; then
  source "$SECRET_FILE"
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/wms-$TIMESTAMP.sql.gz"

cd "$(dirname "$COMPOSE_FILE")"
docker compose exec -T db pg_dump -U wms wms | gzip > "$BACKUP_FILE"

find "$BACKUP_DIR" -name "wms-*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
