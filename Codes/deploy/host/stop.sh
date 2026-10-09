#!/usr/bin/env bash
# Stop LaunchLens processes recorded in pid files (never pattern-matches other apps).
APP_DIR="/home/Debz/Host/launchlens"
for svc in api worker; do
  f="$APP_DIR/logs/$svc.pid"
  [ -f "$f" ] || continue
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -- "-$pid" 2>/dev/null || kill "$pid"
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$f"
done
echo "launchlens stopped"
