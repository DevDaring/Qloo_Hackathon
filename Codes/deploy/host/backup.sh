#!/usr/bin/env bash
# Nightly backup: pg_dump of the application DB (incl. langgraph schema) + media
# archive, 14-day retention. Restore: see docs/operations.md.
set -euo pipefail
APP_DIR="/home/Debz/Host/launchlens"
DEST="$APP_DIR/backups"; mkdir -p "$DEST"
TS="$(date +%Y%m%d-%H%M%S)"
URL="$(grep '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2- | sed 's/+asyncpg//')"
pg_dump --no-owner --format=custom "$URL" > "$DEST/db-$TS.dump"
tar -C "$APP_DIR/data" -czf "$DEST/assets-$TS.tar.gz" assets
find "$DEST" -name 'db-*.dump' -mtime +14 -delete
find "$DEST" -name 'assets-*.tar.gz' -mtime +14 -delete
echo "$(date -Is) backup written: $TS"
