FROM node:24.17.0-alpine3.24 AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
WORKDIR /web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM caddy:2.11.4-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /web/dist /app/dist
COPY config/. /app/default-config/
COPY scripts/initialize-runtime-config.sh /usr/local/bin/initialize-runtime-config.sh
RUN chmod +x /usr/local/bin/initialize-runtime-config.sh

ENTRYPOINT ["/usr/local/bin/initialize-runtime-config.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
