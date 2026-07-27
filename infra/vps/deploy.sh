#!/usr/bin/env bash
# Invoked by infra/vps/deploy-entrypoint.sh, which has already synced the repo
# to the target SHA and symlinked .env in, then execs this file as a
# brand-new process reading it fresh off disk -- so any change here takes
# effect on the very next deploy. Do not add a self-checkout to this file;
# keep that in the entrypoint only (see its header comment for why).
#
# Usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>
#
# The GHCR packages are private (never made public) and the token is the
# calling workflow run's own GITHUB_TOKEN, scoped to that run and expiring
# when it ends -- it is used only for the `docker login`/pull below and is
# never written to disk or to the server's persistent .env.
#
# Sequence (backup -> migrate -> swap, per the migration-safety review done
# during planning): back up Postgres -> pull the new images -> apply
# migrations (using the new api image, since it carries this deploy's
# migration files) -> health-gated rollout.
set -euo pipefail

main() {
  SHA="${1:?usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"
  API_IMAGE="${2:?usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"
  WEB_IMAGE="${3:?usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"
  GHCR_USERNAME="${4:?usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"
  GHCR_TOKEN="${5:?usage: deploy.sh <git-sha> <api-image> <web-image> <ghcr-username> <ghcr-token>}"

  APP_DIR=/opt/qassistant/app
  ENV_FILE=/opt/qassistant/.env
  COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file $ENV_FILE"

  cd "$APP_DIR"

  export API_IMAGE WEB_IMAGE
  # shellcheck disable=SC1090
  source "$ENV_FILE"

  echo "==> Bringing up postgres/minio (needed before migrations can run)"
  $COMPOSE up -d --wait postgres minio
  # minio-init is a one-shot container that exits 0 by design; --wait treats a
  # non-running exited container as a failed wait target, so it's run
  # separately. -d is required here too: without it, `up` runs attached and
  # compose v2 returns non-zero once any service's container exits, even with
  # exit code 0.
  $COMPOSE up -d minio-init

  # infra/local/postgres-init/01-roles.sql is mounted for local dev only (see
  # its own header comment) and hardcodes dev-default passwords -- it cannot
  # see this server's real generated .env secrets, and docker-entrypoint-
  # initdb.d scripts only run once anyway, on a brand new pgdata volume.
  # Confirmed on this VPS that the roles never actually got created by any
  # init script at all (a bare \du showed only the postgres superuser), so
  # deploy.sh owns role bootstrapping in prod outright: create each role if
  # missing, then (re)set its password to whatever is currently in .env.
  # Idempotent -- a no-op body once roles exist and passwords already match
  # -- so this is safe to run on every deploy, including the very first one
  # and any future secret rotation.
  echo "==> Ensuring DB roles exist with .env passwords"
  $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "${DB_BOOTSTRAP_USER:-postgres}" -d "${DB_NAME:-qassistant}" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
        CREATE ROLE app_migrator LOGIN PASSWORD '${DB_MIGRATOR_PASSWORD}' CREATEDB;
      ELSE
        ALTER ROLE app_migrator PASSWORD '${DB_MIGRATOR_PASSWORD}';
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD '${DB_PASSWORD}';
      ELSE
        ALTER ROLE app_user PASSWORD '${DB_PASSWORD}';
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin') THEN
        CREATE ROLE app_superadmin LOGIN PASSWORD '${DB_SUPERADMIN_PASSWORD}' BYPASSRLS;
      ELSE
        ALTER ROLE app_superadmin PASSWORD '${DB_SUPERADMIN_PASSWORD}';
      END IF;
    END
    \$\$;
    GRANT ALL ON SCHEMA public TO app_migrator;
    GRANT USAGE ON SCHEMA public TO app_user, app_superadmin;
EOSQL

  echo "==> Backing up Postgres before migrating"
  ./infra/vps/backup.sh

  # Migrations must run against the NEW api image (it carries this deploy's
  # migration files), so GHCR login/pull has to happen before the migrate
  # step, not after -- `docker compose run` on an image that isn't pulled
  # locally yet tries to auto-pull it, and fails "unauthorized" before login
  # has happened.
  echo "==> Logging into GHCR and pulling images"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
  $COMPOSE pull api web
  docker logout ghcr.io >/dev/null

  echo "==> Applying migrations"
  $COMPOSE run --rm --no-deps api node --import tsx src/db/migrate.ts

  echo "==> Rolling out (health-gated, not fire-and-forget)"
  $COMPOSE up -d --wait api web

  echo "==> Pruning old images"
  docker image prune -f --filter "label!=keep" >/dev/null 2>&1 || true

  echo "==> Deploy of $SHA complete"
}

main "$@"
