FROM node:21-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /web
COPY package.json pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
COPY . .
RUN pnpm run build

FROM caddy:2.7.4
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /web/dist /dist
COPY config/. /root/.config/
COPY config/. /opt/app/default-config/
COPY scripts/ensure-runtime-config.sh /usr/local/bin/ensure-runtime-config.sh
RUN chmod +x /usr/local/bin/ensure-runtime-config.sh

ENTRYPOINT ["/usr/local/bin/ensure-runtime-config.sh"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
