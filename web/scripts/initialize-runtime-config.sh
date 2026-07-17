#!/bin/sh
set -eu

config_dir="/app/config"
default_dir="/app/default-config"

mkdir -p "$config_dir"
cp -R -n "$default_dir/." "$config_dir/"

if [ "$#" -eq 0 ]; then
  set -- run --config /etc/caddy/Caddyfile --adapter caddyfile
fi

exec /usr/bin/caddy "$@"
