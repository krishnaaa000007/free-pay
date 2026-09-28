-- 001_schema.sql
-- Core schema for Free Pay. Idempotent: safe to re-run.
-- Money is stored as BIGINT paise. Timestamps are timestamptz (UTC).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('PILGRIM', 'VENDOR', 'ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_status') THEN
    CREATE TYPE txn_status AS ENUM ('PENDING_SYNC', 'SYNCED', 'SETTLED', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_mode') THEN
    CREATE TYPE txn_mode AS ENUM ('OFFLINE', 'ONLINE', 'NGO_CREDIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_status') THEN
    CREATE TYPE settlement_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'emergency_status') THEN
    CREATE TYPE emergency_status AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_status') THEN
    CREATE TYPE lost_status AS ENUM ('OPEN', 'FOUND', 'CLOSED');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text UNIQUE NOT NULL,
  email          text UNIQUE,
  name           text NOT NULL,
  role           user_role NOT NULL CHECK (role IN ('PILGRIM', 'VENDOR')),
  password_hash  text NOT NULL,
  language       text NOT NULL DEFAULT 'en',
  avatar_seed    int  NOT NULL DEFAULT floor(random() * 12),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      text UNIQUE NOT NULL,
  public_key     text NOT NULL,
  platform       text,
  model          text,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

-- ---------------------------------------------------------------------------
-- Crowd zones (needed by merchants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crowd_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'AREA',
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  radius_m    int NOT NULL DEFAULT 150,
  capacity    int NOT NULL DEFAULT 5000,
  map_x       int NOT NULL DEFAULT 500,
  map_y       int NOT NULL DEFAULT 500,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crowd_zone_edges (
  from_zone   uuid NOT NULL REFERENCES crowd_zones(id) ON DELETE CASCADE,
  to_zone     uuid NOT NULL REFERENCES crowd_zones(id) ON DELETE CASCADE,
  distance_m  int NOT NULL,
  PRIMARY KEY (from_zone, to_zone)
);

CREATE TABLE IF NOT EXISTS crowd_readings (
  id           bigserial PRIMARY KEY,
  zone_id      uuid NOT NULL REFERENCES crowd_zones(id) ON DELETE CASCADE,
  head_count   int NOT NULL CHECK (head_count >= 0),
  density      numeric(5,3) NOT NULL CHECK (density >= 0),
  source       text NOT NULL DEFAULT 'SIMULATED',
  reported_by  uuid,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crowd_readings_zone_time_idx ON crowd_readings(zone_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Merchants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code                  text UNIQUE NOT NULL,
  name                  text NOT NULL,
  category              text NOT NULL DEFAULT 'GENERAL',
  zone_id               uuid REFERENCES crowd_zones(id),
  settlement_account    text,
  is_verified           boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchants_owner_idx ON merchants(owner_id);

-- ---------------------------------------------------------------------------
-- Wallet certificates (audit trail of issued offline credentials)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       text NOT NULL,
  kid             text NOT NULL,
  issued_at       timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  per_txn_limit   bigint NOT NULL,
  daily_limit     bigint NOT NULL,
  cert_json       jsonb NOT NULL,
  sig             text NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_certificates_user_idx ON wallet_certificates(user_id, issued_at DESC);

-- ---------------------------------------------------------------------------
-- Settlements (created before transactions for the FK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES merchants(id),
  requested_by    uuid REFERENCES users(id),
  amount          bigint NOT NULL CHECK (amount >= 0),
  txn_count       int NOT NULL DEFAULT 0,
  status          settlement_status NOT NULL DEFAULT 'PENDING',
  provider        text NOT NULL DEFAULT 'MOCK_SANDBOX',
  provider_ref    text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  failure_reason  text
);
CREATE INDEX IF NOT EXISTS settlements_merchant_idx ON settlements(merchant_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- NGOs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ngos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  registration_no  text UNIQUE NOT NULL,
  category         text NOT NULL DEFAULT 'RELIEF',
  verified         boolean NOT NULL DEFAULT false,
  tenure_years     int NOT NULL DEFAULT 0,
  complaints       int NOT NULL DEFAULT 0,
  disbursed_total  bigint NOT NULL DEFAULT 0,
  credits_issued   int NOT NULL DEFAULT 0,
  credits_redeemed int NOT NULL DEFAULT 0,
  trust_score      numeric(5,2) NOT NULL DEFAULT 0,
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ngo_credits (
  id                    uuid PRIMARY KEY,
  ngo_id                uuid NOT NULL REFERENCES ngos(id),
  nonce                 text UNIQUE NOT NULL,
  amount                bigint NOT NULL CHECK (amount > 0),
  purpose               text NOT NULL,
  beneficiary_hint      text,
  issued_by             uuid,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  redeemed_at           timestamptz,
  redeemed_merchant_id  uuid REFERENCES merchants(id),
  redeemed_txn_id       uuid,
  credit_json           jsonb NOT NULL,
  sig                   text NOT NULL
);

-- ---------------------------------------------------------------------------
-- Transactions: APPEND-ONLY financial ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES merchants(id),
  vendor_user_id  uuid NOT NULL REFERENCES users(id),
  device_id       text,
  item_count      int NOT NULL DEFAULT 0,
  accepted        int NOT NULL DEFAULT 0,
  review          int NOT NULL DEFAULT 0,
  rejected        int NOT NULL DEFAULT 0,
  duplicates      int NOT NULL DEFAULT 0,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id                uuid PRIMARY KEY,
  nonce             text UNIQUE NOT NULL,
  payer_id          uuid REFERENCES users(id),
  merchant_id       uuid NOT NULL REFERENCES merchants(id),
  vendor_device_id  text,
  payer_device_id   text,
  amount            bigint NOT NULL CHECK (amount > 0),
  currency          char(3) NOT NULL DEFAULT 'INR',
  mode              txn_mode NOT NULL,
  status            txn_status NOT NULL,
  created_at        timestamptz NOT NULL,
  expires_at        timestamptz,
  accepted_at       timestamptz,
  synced_at         timestamptz,
  settled_at        timestamptz,
  fraud_decision    text,
  fraud_flags       text[] NOT NULL DEFAULT '{}',
  suspicious        boolean NOT NULL DEFAULT false,
  memo              text,
  payload           jsonb,
  receipt           jsonb,
  settlement_id     uuid REFERENCES settlements(id),
  sync_batch_id     uuid REFERENCES sync_batches(id),
  ngo_credit_id     uuid REFERENCES ngo_credits(id),
  inserted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_payer_idx    ON transactions(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_merchant_idx ON transactions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_status_idx   ON transactions(status);
CREATE INDEX IF NOT EXISTS transactions_created_idx  ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_payer_mode_idx ON transactions(payer_id, mode, created_at DESC);

-- Rejected transactions are kept for audit in a separate table (never in the ledger).
CREATE TABLE IF NOT EXISTS rejected_transactions (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid NOT NULL,
  nonce           text,
  merchant_id     uuid,
  payer_id        uuid,
  amount          bigint,
  reasons         text[] NOT NULL,
  payload         jsonb,
  sync_batch_id   uuid REFERENCES sync_batches(id),
  rejected_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_annotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id),
  admin_id        uuid REFERENCES admin_users(id),
  kind            text NOT NULL CHECK (kind IN ('NOTE', 'FLAG', 'UNFLAG', 'REVIEW_APPROVED', 'REVIEW_REJECTED')),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_annotations_txn_idx ON transaction_annotations(transaction_id);

-- Append-only guard: financial fields are immutable, status moves forward only, no deletes.
CREATE OR REPLACE FUNCTION transactions_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions are append-only: DELETE is not permitted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payer_device_id IS DISTINCT FROM OLD.payer_device_id
     OR NEW.vendor_device_id IS DISTINCT FROM OLD.vendor_device_id THEN
    RAISE EXCEPTION 'transactions are append-only: financial fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('SETTLED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'transaction status % is terminal', OLD.status USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'SYNCED' AND NEW.status NOT IN ('SYNCED', 'SETTLED', 'FAILED') THEN
    RAISE EXCEPTION 'invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_append_only ON transactions;
CREATE TRIGGER transactions_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_append_only_guard();

CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS settlements_no_delete ON settlements;
CREATE TRIGGER settlements_no_delete BEFORE DELETE ON settlements FOR EACH ROW EXECUTE FUNCTION forbid_delete();
DROP TRIGGER IF EXISTS annotations_no_delete ON transaction_annotations;
CREATE TRIGGER annotations_no_delete BEFORE DELETE OR UPDATE ON transaction_annotations FOR EACH ROW EXECUTE FUNCTION forbid_delete();
DROP TRIGGER IF EXISTS rejected_no_delete ON rejected_transactions;
CREATE TRIGGER rejected_no_delete BEFORE DELETE OR UPDATE ON rejected_transactions FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------------------
-- Vendor device heartbeat: lets the ops dashboard see unsynced volume per stall
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_sync_state (
  merchant_id     uuid PRIMARY KEY REFERENCES merchants(id),
  vendor_user_id  uuid NOT NULL REFERENCES users(id),
  device_id       text,
  pending_count   int NOT NULL DEFAULT 0,
  pending_amount  bigint NOT NULL DEFAULT 0,
  last_sync_at    timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  app_version     text,
  battery_pct     int,
  network         text
);

-- ---------------------------------------------------------------------------
-- Safety: emergencies and lost persons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergencies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  kind             text NOT NULL DEFAULT 'OTHER',
  note             text,
  lat              double precision,
  lng              double precision,
  accuracy_m       double precision,
  zone_id          uuid REFERENCES crowd_zones(id),
  status           emergency_status NOT NULL DEFAULT 'ACTIVE',
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES admin_users(id),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS emergencies_status_idx ON emergencies(status, expires_at DESC);

CREATE TABLE IF NOT EXISTS emergency_locations (
  id            bigserial PRIMARY KEY,
  emergency_id  uuid NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lost_persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by        uuid NOT NULL REFERENCES users(id),
  name               text NOT NULL,
  age                int,
  gender             text,
  description        text,
  last_seen_zone_id  uuid REFERENCES crowd_zones(id),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  contact_phone      text NOT NULL,
  status             lost_status NOT NULL DEFAULT 'OPEN',
  created_at         timestamptz NOT NULL DEFAULT now(),
  found_at           timestamptz
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    text,
  actor_role  text,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
DROP TRIGGER IF EXISTS audit_no_delete ON audit_log;
CREATE TRIGGER audit_no_delete BEFORE DELETE OR UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ---------------------------------------------------------------------------
-- RLS helper functions (read the transaction-local settings set by withUser())
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('app.user_id', true) ~ '^[0-9a-fA-F-]{36}$'
    THEN current_setting('app.user_id', true)::uuid
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_role() = 'ADMIN' $$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_role() = 'SYSTEM' $$;

-- SECURITY DEFINER so policies on other tables can consult merchant ownership
-- without recursing into the merchants policy. Returns only a boolean.
CREATE OR REPLACE FUNCTION app_owns_merchant(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM merchants m WHERE m.id = mid AND m.owner_id = app_user_id())
$$;
