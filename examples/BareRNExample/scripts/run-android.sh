#!/usr/bin/env bash
set -euo pipefail

PORT="${RCT_METRO_PORT:-8081}"
METRO_LOG="${TMPDIR:-/tmp}/basic-example-metro.log"
METRO_PID=""

metro_running() {
  curl -fs "http://localhost:${PORT}/status" 2>/dev/null | grep -q "packager-status:running"
}

cleanup() {
  if [[ -n "${METRO_PID}" ]] && kill -0 "${METRO_PID}" 2>/dev/null; then
    echo "Stopping Metro..."
    kill "${METRO_PID}" 2>/dev/null || true
    wait "${METRO_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if ! metro_running; then
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${PORT} is already in use, but it does not look like Metro."
    echo "Stop that process or set RCT_METRO_PORT to another port."
    exit 1
  fi

  echo "Starting Metro on port ${PORT}..."
  npx react-native start --port "${PORT}" >"${METRO_LOG}" 2>&1 &
  METRO_PID="$!"

  for _ in $(seq 1 60); do
    if metro_running; then
      break
    fi
    sleep 1
  done
fi

if ! metro_running; then
  echo "Metro did not start on port ${PORT}. See ${METRO_LOG}"
  exit 1
fi

echo "Metro is running on port ${PORT}."
npx react-native run-android --port "${PORT}" --no-packager

echo "App launched. Metro logs are streaming from ${METRO_LOG}."
tail -f "${METRO_LOG}"
