#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname "$script_dir")
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM

default_dir="$test_root/default-config"
empty_config_dir="$test_root/empty-config"
existing_config_dir="$test_root/existing-config"

mkdir -p "$default_dir" "$empty_config_dir" "$existing_config_dir"
cp -R "$project_dir/config/." "$default_dir/"

AUTO_NOVEL_CONFIG_DIR="$empty_config_dir" \
AUTO_NOVEL_DEFAULT_CONFIG_DIR="$default_dir" \
  sh "$script_dir/initialize-runtime-config.sh" /bin/true

diff -r "$default_dir" "$empty_config_dir"

printf '%s\n' '{"custom":true}' > "$existing_config_dir/config.json"
AUTO_NOVEL_CONFIG_DIR="$existing_config_dir" \
AUTO_NOVEL_DEFAULT_CONFIG_DIR="$default_dir" \
  sh "$script_dir/initialize-runtime-config.sh" /bin/true

test "$(cat "$existing_config_dir/config.json")" = '{"custom":true}'
test ! -e "$existing_config_dir/html"
test ! -e "$existing_config_dir/images"

echo "Runtime config initialization smoke passed"
