#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.dev/pids"
SERVICES=(genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui)

process_matches() {
  local pid="$1"
  local executable="$2"
  ps -p "$pid" -o args= 2>/dev/null | grep -Fq -- "$executable"
}

for service in "${SERVICES[@]}"; do
  pid_file="$PID_DIR/$service.pid"
  [[ -f "$pid_file" ]] || continue

  pid="$(<"$pid_file")"
  executable="$ROOT_DIR/dist/bin/$service"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null || \
    ! process_matches "$pid" "$executable"; then
    echo "Removing stale PID file for $service."
    rm -f "$pid_file"
    continue
  fi

  kill -TERM "$pid"
  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done

  if kill -0 "$pid" 2>/dev/null && process_matches "$pid" "$executable"; then
    echo "$service did not stop gracefully; sending SIGKILL."
    kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  echo "Stopped $service (pid $pid)."
done