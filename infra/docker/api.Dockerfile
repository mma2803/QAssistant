# Backend API image (self-hosted VPS migration). Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t qassistant-api .
#
# node:20-bookworm-slim (Debian, not Alpine) deliberately: sidesteps musl
# prebuilt-binary gaps for @node-rs/argon2 and other native deps across the
# whole app, not just this one image.
#
# Keeps full source (not just dist) in the runtime image so the one-off
# migration script (run via `tsx` against TS source, matching
# apps/api/package.json's db:migrate script exactly) works from the same
# image as the compiled server — simpler than a second migration-only image
# at this scale, and the extra size is a non-issue on a normal disk.

FROM node:20-bookworm-slim AS build
WORKDIR /app

# Copy just the workspace manifests first so `npm ci` is cached across builds
# that only change application code.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @qassistant/shared
RUN npm run build --workspace @qassistant/api

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 1001 --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app
COPY --from=build --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/package.json ./package.json
COPY --from=build --chown=appuser:appuser /app/packages/shared ./packages/shared
COPY --from=build --chown=appuser:appuser /app/apps/api ./apps/api

USER appuser
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
