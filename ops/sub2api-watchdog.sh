#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
CONTAINER_NAME="${CONTAINER_NAME:-sub2api}"

if curl -fsS --max-time 8 "$HEALTH_URL" >/dev/null; then
  exit 0
fi

logger -t sub2api-watchdog "health check failed for ${HEALTH_URL}; restarting ${CONTAINER_NAME}"

if command -v docker >/dev/null 2>&1; then
  /usr/bin/docker restart "$CONTAINER_NAME" >/dev/null
fi

if command -v systemctl >/dev/null 2>&1; then
  /usr/bin/systemctl try-restart nginx.service >/dev/null || true
fi
