#!/bin/sh
set -eu

URL="${POS_MOBILE_HEALTH_URL:-http://127.0.0.1:8787/healthz}"
LOG="${POS_MOBILE_HEALTH_LOG:-/home/jorge/pos_mobile/data/healthcheck.log}"

for attempt in 1 2 3; do
  if curl -fsS --max-time 10 "$URL" >/dev/null; then
    exit 0
  fi
  sleep 5
done

printf '%s healthcheck failed, restarting pos-mobile-orders\n' "$(date -Is)" >> "$LOG"
pm2 restart pos-mobile-orders >> "$LOG" 2>&1
