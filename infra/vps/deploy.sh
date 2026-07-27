#!/usr/bin/env bash
# Invoked by .github/workflows/deploy.yml over SSH as the `deploy` user (a key
# restricted via authorized_keys command="..." to only run this script).
#
# Usage: deploy.sh <git-sha> <api-image> <web-image>
#
# Sequence (backup -> migrate -> swap, per the migration-safety review done
# during planning): sync config from the reviewed repo -> back up Postgres ->
# apply migrations -> pull + health-gated rollout of the new images.
set -euo pipefail

SHA="${1:?usage: deploy.sh <git-sha> <api-image> <web-image>}"
API_IMAGE="${2:?usage: deploy.sh <git-sha> <api-image> <web-image>}"
WEB_IMAGE="${3:?usage: deploy.sh <git-sha> <api-image> <web-image>}"

APP_DIR=/opt/qassistant/app
ENV_FILE=/opt/qassistant/.env
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file $ENV_FILE"

cd "$APP_DIR"

echo "==> Syncing repo to $SHA (config-as-code; only .env stays server-only)"
git fetch --depth 50 origin "$SHA"
git checkout --force "$SHA"
# .env lives outside the repo; symlink it in so both `--env-file` and the api
# service's `env_file: .env` (resolved relative to the compose project dir)
# point at the same file. .env is gitignored, so `git checkout --force` never
# touches it.
ln -sf "$ENV_FILE" .env

export API_IMAGE WEB_IMAGE
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "==> Bringing up postgres/minio (needed before migrations can run)"
$COMPOSE up -d --wait postgres minio minio-init

echo "==> Backing up Postgres before migrating"
./infra/vps/backup.sh

echo "==> Applying migrations"
$COMPOSE run --rm --no-deps api node --import tsx src/db/migrate.ts

echo "==> Pulling images and rolling out (health-gated, not fire-and-forget)"
$COMPOSE pull api web
$COMPOSE up -d --wait api web

echo "==> Pruning old images"
docker image prune -f --filter "label!=keep" >/dev/null 2>&1 || true

echo "==> Deploy of $SHA complete"
