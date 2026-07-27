-- Local-dev-only bootstrap of the database roles described in the contract
-- section 8. In prod, infra/vps/deploy.sh creates/reconciles these same
-- roles using this server's real .env secrets on every deploy (not this
-- script -- docker-entrypoint-initdb.d scripts only ever run once, on a
-- brand new pgdata volume, and can't see the VPS's real passwords anyway).
-- Passwords here match .env.example defaults and are for local emulators only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD 'app_migrator_pw' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_pw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superadmin') THEN
    CREATE ROLE app_superadmin LOGIN PASSWORD 'app_superadmin_pw' BYPASSRLS;
  END IF;
END
$$;

-- Migrator owns the schema and runs DDL. Grant connect on the bootstrap db.
GRANT ALL ON SCHEMA public TO app_migrator;
-- Let app_user / app_superadmin use the public schema; table-level grants are
-- applied by the migrations (contract section 8).
GRANT USAGE ON SCHEMA public TO app_user, app_superadmin;
