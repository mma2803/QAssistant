-- Local-dev bootstrap of the database roles described in the contract section 8.
-- In prod these roles are created by an initial migration (see apps/api migrations);
-- locally we also create them here so docker-compose postgres is ready for the
-- runtime app_user and the privileged app_superadmin connection out of the box.
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
