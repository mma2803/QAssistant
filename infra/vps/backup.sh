#!/usr/bin/env bash
# Nightly Postgres backup (local only, per the confirmed decision — no
# off-site copy for now). Also invoked by deploy.sh immediately before
# migrations run, so a bad migration can be rolled back by restoring the
# dump taken just before it.
#
# Schedule with cron as the deploy user, e.g.:
#   0 3 * * * /opt/qassistant/app/infra/vps/backup.sh >> /opt/qassistant/backups/backup.log 2>&1
set -euo pipefail

APP_DIR=/opt/qassistant/app
ENV_FILE=/opt/qassistant/.env
BACKUP_DIR=/opt/qassistant/backups
RETENTION_DAYS=14

cd "$APP_DIR"
# shellcheck disable=SC1090
source "$ENV_FILE"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/qassistant-$STAMP.sql.gz"

echo "==> Dumping to $OUT_FILE"
docker compose -f infra/docker-compose.prod.yml --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "${DB_BOOTSTRAP_USER:-postgres}" -d "${DB_NAME:-qassistant}" \
  | gzip > "$OUT_FILE"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'qassistant-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "==> Backup complete: $(du -h "$OUT_FILE" | cut -f1)"
