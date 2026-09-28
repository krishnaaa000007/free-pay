-- 002_app_role.sql
-- Creates the NON-SUPERUSER role the API connects as. Because it has neither SUPERUSER
-- nor BYPASSRLS, every row-level-security policy is enforced for it.
-- ${APP_DB_PASSWORD} is substituted by the migration runner from DB_PASSWORD.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freepay_app') THEN
    CREATE ROLE freepay_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE freepay_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT CONNECT ON DATABASE ${DB_NAME} TO freepay_app;
GRANT USAGE ON SCHEMA public TO freepay_app;

-- Read/write on data tables. No DELETE anywhere: the ledger is append-only and even
-- soft entities are closed via status columns, never removed.
GRANT SELECT, INSERT, UPDATE ON
  users, admin_users, devices, merchants, wallet_certificates, settlements, ngos, ngo_credits,
  sync_batches, transactions, rejected_transactions, transaction_annotations, emergencies,
  emergency_locations, lost_persons, crowd_zones, crowd_zone_edges, crowd_readings, audit_log,
  vendor_sync_state
TO freepay_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO freepay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO freepay_app;

GRANT EXECUTE ON FUNCTION app_user_id(), app_role(), app_is_admin(), app_is_system(), app_owns_merchant(uuid) TO freepay_app;

-- The migration bookkeeping table stays owner-only.
REVOKE ALL ON schema_migrations FROM freepay_app;
