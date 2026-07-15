#!/bin/bash
set -e

REPO_DIR=/home/fadlan/homelab/wms
LOG_FILE=/home/fadlan/homelab/backups/wms/deploy.log
LOCK_FILE=/tmp/wms-deploy.lock
export PATH="$HOME/.local/bin:$PATH"

[ -f "$REPO_DIR/.env.telegram" ] && source "$REPO_DIR/.env.telegram"
[ -f "$REPO_DIR/.env.secret" ] && source "$REPO_DIR/.env.secret"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" >> "$LOG_FILE"; }

notify() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="${CHAT_ID}" \
    --data-urlencode "text=$1" \
    --data-urlencode "parse_mode=HTML" > /dev/null
}

exec 200>"$LOCK_FILE"
flock -n 200 || { log "Deploy already running, skipping"; exit 0; }
trap 'rm -f "$LOCK_FILE"' EXIT

cd "$REPO_DIR"

git fetch origin dev-fadlan 2>>"$LOG_FILE"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/dev-fadlan)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "No changes"
  exit 0
fi

SHORT_REMOTE=$(git log -1 --format='%an: %s' "$REMOTE")
log "New commit: $SHORT_REMOTE"

bash scripts/backup-db.sh >> "$LOG_FILE" 2>&1
PREV="$LOCAL"

set +e
git reset --hard origin/dev-fadlan >> "$LOG_FILE" 2>&1
log "Pull done: $REMOTE"

docker compose -p wms-dev build --pull >> "$LOG_FILE" 2>&1
BUILD_EXIT=$?
log "Build exit code: $BUILD_EXIT"

docker compose -p wms-dev up -d >> "$LOG_FILE" 2>&1
DEPLOY_EXIT=$?
log "Deploy exit code: $DEPLOY_EXIT"
set -e

sleep 10

HEALTH=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3080/api/health 2>/dev/null || echo "FAIL")
log "Health check: $HEALTH"

if [ "$BUILD_EXIT" -eq 0 ] && [ "$DEPLOY_EXIT" -eq 0 ] && [ "$HEALTH" = "200" ]; then
  notify "✅ WMS Deployed
🔗 https://wms-dev.zeyadev.web.id
📦 $SHORT_REMOTE"
  log "SUCCESS"
  exit 0
fi

log "FAILED, rolling back..."
git reset --hard "$PREV" >> "$LOG_FILE" 2>&1
set +e
docker compose -p wms-dev build >> "$LOG_FILE" 2>&1
docker compose -p wms-dev up -d >> "$LOG_FILE" 2>&1
set -e
sleep 10
RB_HEALTH=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3080/api/health 2>/dev/null || echo "FAIL")
log "Rollback health: $RB_HEALTH"

if [ "$BUILD_EXIT" -ne 0 ]; then
  FAIL_REASON="Build failed (exit $BUILD_EXIT)"
elif [ "$DEPLOY_EXIT" -ne 0 ]; then
  FAIL_REASON="Deploy failed (exit $DEPLOY_EXIT)"
else
  FAIL_REASON="Health check: $HEALTH"
fi

notify "❌ WMS Deploy FAILED → Rollback $([ "$RB_HEALTH" = "200" ] && echo '✅' || echo '❌')
🔧 $FAIL_REASON
📦 $SHORT_REMOTE
📋 Logs: $(tail -5 "$LOG_FILE" | head -3 | tr '\n' ' ')"

if [ "$RB_HEALTH" != "200" ]; then
  notify "🚨 Rollback juga gagal! DB backup tersedia di /home/fadlan/homelab/backups/wms/ (sebelum deploy)"
fi

exit 1