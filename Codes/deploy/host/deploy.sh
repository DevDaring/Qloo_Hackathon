#!/usr/bin/env bash
# Deploy LaunchLens to this host at /home/Debz/Host/launchlens and serve it at
# https://launchlens.koushikdeb.com through the shared Caddy instance.
#
#   deploy/host/deploy.sh            # full deploy (sync, deps, build, migrate, restart, caddy, cron)
#   SKIP_FRONTEND=1 deploy/host/deploy.sh
#
# Idempotent. Never prints secrets. The app reads keys from the project .env
# (symlinked) and production overrides from .env.production.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="/home/Debz/Host/launchlens"
CADDYFILE="/home/Debz/Host/saarthi/Caddyfile"
DOMAIN="launchlens.koushikdeb.com"

echo "==> sync code $SRC -> $DST"
mkdir -p "$DST" "$DST/data/assets" "$DST/logs" "$DST/backups"
rsync -a --delete \
  --exclude '/.env' --exclude '/.env.*' --exclude '/data/' --exclude '/logs/' --exclude '/backups/' \
  --exclude '/backend/.venv/' --exclude '/frontend/node_modules/' --exclude '__pycache__/' --exclude '.pytest_cache/' \
  --exclude '/frontend/test-results/' --exclude '/frontend/playwright-report/' \
  --exclude '/run.sh' --exclude '/stop.sh' --exclude '/autostart.sh' --exclude '/backup.sh' \
  "$SRC/" "$DST/"
ln -sfn "$SRC/.env" "$DST/.env"
for f in run.sh stop.sh autostart.sh backup.sh; do install -m 0755 "$SRC/deploy/host/$f" "$DST/$f"; done

if [ ! -f "$DST/.env.production" ]; then
  echo "==> write .env.production"
  cat > "$DST/.env.production" <<EOF
APP_ENV=production
APP_BASE_URL=https://$DOMAIN
FRONTEND_ORIGIN=https://$DOMAIN
CORS_ALLOWED_ORIGINS=https://$DOMAIN
SESSION_COOKIE_SECURE=true
LOCAL_ASSET_DIR=$DST/data/assets
FONT_ASSET_DIR=$DST/assets/fonts
PROVIDER_PRICING_FILE=$DST/deploy/provider-pricing.json
WORKER_CONCURRENCY=3
EOF
  chmod 600 "$DST/.env.production"
fi

echo "==> python deps"
[ -x "$DST/backend/.venv/bin/python" ] || python3.12 -m venv "$DST/backend/.venv"
"$DST/backend/.venv/bin/pip" install -q --upgrade pip
"$DST/backend/.venv/bin/pip" install -q -r "$DST/backend/requirements.lock"

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "==> frontend build"
  (cd "$SRC/frontend" && npm ci --no-audit --no-fund --silent && npm run build --silent)
  rsync -a --delete "$SRC/frontend/dist/" "$DST/frontend/dist/"
fi

echo "==> migrate + seed"
(cd "$DST/backend" && .venv/bin/alembic upgrade head && .venv/bin/python -m launchlens.demo.seed)

echo "==> restart"
"$DST/run.sh"

echo "==> caddy"
if ! grep -q '# >>> launchlens' "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"
  printf '\n' >> "$CADDYFILE"
  cat "$SRC/deploy/host/Caddyfile.snippet" >> "$CADDYFILE"
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
caddy reload --config "$CADDYFILE" --adapter caddyfile

echo "==> cron watchdog + nightly backup"
CRON_TMP="$(mktemp)"
crontab -l 2>/dev/null > "$CRON_TMP" || true
grep -q 'launchlens/autostart.sh' "$CRON_TMP" || {
  echo "@reboot sleep 50 && $DST/autostart.sh  # LaunchLens" >> "$CRON_TMP"
  echo "*/5 * * * * $DST/autostart.sh  # LaunchLens watchdog" >> "$CRON_TMP"
  echo "40 3 * * * flock -n /tmp/launchlens_backup.lock $DST/backup.sh >> $DST/logs/backup.log 2>&1  # LaunchLens backup" >> "$CRON_TMP"
  crontab "$CRON_TMP"
}
rm -f "$CRON_TMP"

echo "==> health"
curl -fsS http://127.0.0.1:8140/health/ready | head -c 400; echo
echo "Deployed. Public URL (after DNS A record '$DOMAIN' -> this host): https://$DOMAIN"
