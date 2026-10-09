#!/usr/bin/env bash
# LaunchLens watchdog (cron @reboot and every 5 min): restarts if the API or worker is down.
APP_DIR="/home/Debz/Host/launchlens"
[ -x "$APP_DIR/run.sh" ] || exit 0
ok=1
ss -tln 2>/dev/null | grep -q '127.0.0.1:8140 ' || ok=0
[ -f "$APP_DIR/logs/worker.pid" ] && kill -0 "$(cat "$APP_DIR/logs/worker.pid")" 2>/dev/null || ok=0
[ "$ok" = 1 ] && exit 0
mkdir -p "$APP_DIR/logs"
echo "$(date -Is) autostart: (re)starting launchlens" >> "$APP_DIR/logs/autostart.log"
"$APP_DIR/run.sh" >> "$APP_DIR/logs/autostart.log" 2>&1
