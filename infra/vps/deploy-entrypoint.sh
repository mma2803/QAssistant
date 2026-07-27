#!/usr/bin/env bash
# Invoked by .github/workflows/deploy.yml over SSH as the `deploy` user (a key
# restricted via authorized_keys command="..." to only run this script).
#
# This file is intentionally tiny and should rarely need to change: its only
# job is to sync the repo to the requested SHA, then exec into the
# freshly-checked-out infra/vps/deploy.sh as a brand-new process reading it
# straight off disk. If the deploy logic lived here instead, this same file
# would rewrite itself mid-run via the checkout below -- a real, previously
# confirmed hazard: a fix to the post-checkout logic had no effect on the
# very deploy that pulled it in, because that run kept executing whatever
# had already been read off disk before the checkout. Splitting sync from
# logic means a fix to deploy.sh always takes effect on the very next
# deploy, not one run later.
#
# Usage: deploy-entrypoint.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>
set -euo pipefail

SHA="${1:?usage: deploy-entrypoint.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"
APP_DIR=/opt/qassistant/app
ENV_FILE=/opt/qassistant/.env

cd "$APP_DIR"

echo "==> Syncing repo to $SHA (config-as-code; only .env stays server-only)"
git fetch --depth 50 origin "$SHA"
git checkout --force "$SHA"
# .env lives outside the repo; symlink it in so both `--env-file` (CLI flag,
# used for ${VAR} interpolation) and the api service's `env_file: .env` key
# can find it. The latter is resolved by Compose relative to the *compose
# file's own directory* (infra/), not the CWD.
ln -sf "$ENV_FILE" .env
ln -sf "$ENV_FILE" infra/.env

exec "$APP_DIR/infra/vps/deploy.sh" "$@"
