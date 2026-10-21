#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SIDENOTE_STATIC_PORT:-8765}"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1024 || PORT > 65535)); then
  printf 'SIDENOTE_STATIC_PORT must be an integer between 1024 and 65535.\n' >&2
  exit 2
fi

export SIDENOTE_CORS_ORIGIN="${SIDENOTE_CORS_ORIGIN:-http://127.0.0.1:$PORT}"

python3 "$ROOT/backend/server.py" &
API_PID=$!
SIDENOTE_STATIC_PORT="$PORT" python3 "$ROOT/backend/preview_server.py" &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'SideNote preview: http://127.0.0.1:%s/preview.html\n' "$PORT"
printf 'Stop both local servers with Ctrl+C.\n'
wait -n "$API_PID" "$WEB_PID"
