#!/bin/sh
set -e

CONFIG_DIR="/root/.config"
DEFAULT_DIR="/opt/app/default-config"

mkdir -p "$CONFIG_DIR"

copy_default() {
  file="$1"
  if [ ! -f "$CONFIG_DIR/$file" ] && [ -f "$DEFAULT_DIR/$file" ]; then
    cp "$DEFAULT_DIR/$file" "$CONFIG_DIR/$file"
  fi
}

copy_default "config.json"
copy_default "info.html"

if [ "$#" -gt 0 ]; then
  exec /usr/bin/caddy "$@"
else
  exec /usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi
