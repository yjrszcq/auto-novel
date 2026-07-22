#!/bin/sh
set -eu

config_dir="${AUTO_NOVEL_CONFIG_DIR:-/app/config}"
default_dir="${AUTO_NOVEL_DEFAULT_CONFIG_DIR:-/app/default-config}"

mkdir -p "$config_dir"
if [ -z "$(find "$config_dir" -mindepth 1 -print -quit)" ]; then
  cp -R "$default_dir/." "$config_dir/"
fi

if [ "$#" -eq 0 ]; then
  set -- caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi

exec "$@"
