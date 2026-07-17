#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$repo_root/web"

if ! command -v corepack >/dev/null 2>&1; then
  echo "未找到 corepack。请安装 Node.js 22（或启用 Corepack）后重试。" >&2
  exit 1
fi

cd "$web_dir"

echo "正在同步前端依赖..."
corepack pnpm install --frozen-lockfile

echo "正在启动本地开发服务器（默认地址：http://127.0.0.1:5173）"
exec corepack pnpm exec vite --host 127.0.0.1 "$@"
