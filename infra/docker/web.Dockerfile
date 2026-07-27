# Web image: the built dashboard SPA served by Caddy, which also
# reverse-proxies /api/v1 and /health to the api container and terminates TLS
# (self-hosted VPS migration). Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile -t qassistant-web .
#
# No VITE_API_BASE_URL build arg: the dashboard and API share one origin
# behind Caddy in prod, so the dashboard talks same-origin via a relative
# "/api/v1" path — no CORS, nothing tenant/host-specific baked into the bundle.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/dashboard apps/dashboard
RUN npm run build --workspace @qassistant/shared
RUN npm run build --workspace @qassistant/dashboard

FROM caddy:2 AS runtime
COPY --from=build /app/apps/dashboard/dist /srv/dashboard
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
