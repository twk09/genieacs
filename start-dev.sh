#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT_DIR/.dev"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
SERVICES=(genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui)

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Dependencies are missing. Run 'npm install' in $ROOT_DIR first." >&2
  exit 1
fi

mkdir -p "$PID_DIR" "$LOG_DIR"
NODE_ENV=development npm --prefix "$ROOT_DIR" run build

CONFIG_DIR="$ROOT_DIR/config"
if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
  node -e '
    const fs = require("fs");
    const { randomBytes } = require("crypto");
    const [src, dst] = process.argv.slice(1);
    const conf = JSON.parse(fs.readFileSync(src, "utf8"));
    conf.UI_JWT_SECRET = randomBytes(32).toString("hex");
    fs.writeFileSync(dst, JSON.stringify(conf, null, 2) + "\n", { mode: 0o600 });
  ' "$CONFIG_DIR/config.example.json" "$CONFIG_DIR/config.json"
  echo "Created $CONFIG_DIR/config.json with a generated UI_JWT_SECRET."
fi
# The runtime root is dist/, which is wiped on every build
export GENIEACS_CONFIG_DIR="$CONFIG_DIR"

for service in "${SERVICES[@]}"; do
  pid_file="$PID_DIR/$service.pid"
  executable="$ROOT_DIR/dist/bin/$service"

  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && \
      ps -p "$pid" -o args= | grep -Fq -- "$executable"; then
      echo "$service is already running (pid $pid)."
      continue
    fi
    rm -f "$pid_file"
  fi

  nohup "$executable" >>"$LOG_DIR/$service.log" 2>&1 </dev/null &
  pid=$!
  printf '%s\n' "$pid" >"$pid_file"
  echo "Started $service (pid $pid); log: $LOG_DIR/$service.log"
done

echo "GenieACS UI: http://localhost:3000"