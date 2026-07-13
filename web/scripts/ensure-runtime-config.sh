#!/bin/sh
set -e

CONFIG_DIR="/app/config"
DEFAULT_DIR="/app/default-config"

mkdir -p "$CONFIG_DIR/html" "$CONFIG_DIR/images"

copy_default() {
  file="$1"
  target="$CONFIG_DIR/$file"
  default="$DEFAULT_DIR/$file"
  mkdir -p "$(dirname "$target")"
  if [ ! -f "$target" ] && [ -f "$default" ]; then
    cp "$default" "$target"
  fi
}

copy_legacy_panel() {
  file="$1"
  legacy="$CONFIG_DIR/$file"
  target="$CONFIG_DIR/html/$file"
  if [ ! -f "$target" ] && [ -f "$legacy" ]; then
    cp "$legacy" "$target"
  fi
}

copy_default "config.json"
copy_legacy_panel "info-gpt.html"
copy_legacy_panel "info-sakura.html"
copy_legacy_panel "info.html"
copy_default "html/info-gpt.html"
copy_default "html/info-sakura.html"
copy_default "html/info.html"

if [ "$#" -gt 0 ]; then
  exec /usr/bin/caddy "$@"
else
  exec /usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi
