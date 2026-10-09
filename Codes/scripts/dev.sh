#!/usr/bin/env bash
# Local process manager for LaunchLens (PID files, no pattern matching).
#   scripts/dev.sh start|stop|restart [api|worker|all]
#   scripts/dev.sh status
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/data/run"; LOGS="$ROOT/data/logs"
mkdir -p "$RUN" "$LOGS"
PORT="${LAUNCHLENS_PORT:-8140}"
PY="$ROOT/backend/.venv/bin/python"

alive() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start_api() {
  alive api && { echo "api already running"; return; }
  cd "$ROOT/backend" || exit 1
  setsid "$ROOT/backend/.venv/bin/uvicorn" launchlens.main:app --host 127.0.0.1 --port "$PORT" \
    --proxy-headers --forwarded-allow-ips=127.0.0.1 --timeout-graceful-shutdown 10 \
    >> "$LOGS/api.log" 2>&1 < /dev/null &
  echo $! > "$RUN/api.pid"
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/health/live" >/dev/null && { echo "api up on :$PORT"; return; }; sleep 0.5; done
  echo "api did not become live; see $LOGS/api.log" >&2
}

start_worker() {
  alive worker && { echo "worker already running"; return; }
  cd "$ROOT/backend" || exit 1
  setsid "$PY" -m launchlens.worker.main >> "$LOGS/worker.log" 2>&1 < /dev/null &
  echo $! > "$RUN/worker.pid"
  echo "worker started (pid $(cat "$RUN/worker.pid"))"
}

stop() {
  if alive "$1"; then
    kill "$(cat "$RUN/$1.pid")"
    for _ in $(seq 1 40); do alive "$1" || break; sleep 0.5; done
    alive "$1" && kill -9 "$(cat "$RUN/$1.pid")"
    echo "$1 stopped"
  fi
  rm -f "$RUN/$1.pid"
}

what="${2:-all}"
case "${1:-status}" in
  start)   [[ $what == api || $what == all ]] && start_api; [[ $what == worker || $what == all ]] && start_worker ;;
  stop)    [[ $what == api || $what == all ]] && stop api; [[ $what == worker || $what == all ]] && stop worker ;;
  restart) [[ $what == api || $what == all ]] && { stop api; start_api; }; [[ $what == worker || $what == all ]] && { stop worker; start_worker; } ;;
  status)  for s in api worker; do alive $s && echo "$s: running (pid $(cat "$RUN/$s.pid"))" || echo "$s: stopped"; done ;;
  *) echo "usage: $0 start|stop|restart|status [api|worker|all]"; exit 2 ;;
esac
