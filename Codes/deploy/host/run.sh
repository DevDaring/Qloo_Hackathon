#!/usr/bin/env bash
# LaunchLens (Qloo hackathon) - (re)start API on 127.0.0.1:8140 and the worker.
# Caddy terminates TLS for launchlens.koushikdeb.com and proxies here.
set -e
APP_DIR="/home/Debz/Host/launchlens"
cd "$APP_DIR"
"$APP_DIR/stop.sh" >/dev/null 2>&1 || true
mkdir -p logs data/assets
cd "$APP_DIR/backend"
setsid "$APP_DIR/backend/.venv/bin/uvicorn" launchlens.main:app --host 127.0.0.1 --port 8140 --workers 2 \
  --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 15 \
  >> "$APP_DIR/logs/api.log" 2>&1 < /dev/null &
echo $! > "$APP_DIR/logs/api.pid"
setsid "$APP_DIR/backend/.venv/bin/python" -m launchlens.worker.main >> "$APP_DIR/logs/worker.log" 2>&1 < /dev/null &
echo $! > "$APP_DIR/logs/worker.pid"
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8140/health/ready >/dev/null && { echo "launchlens up on 127.0.0.1:8140"; exit 0; }
  sleep 1
done
echo "launchlens did not become ready; see logs/api.log" >&2; exit 1
