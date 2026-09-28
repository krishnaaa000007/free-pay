-- 003_rls.sql
-- Row-level security. Every table the API touches has RLS ENABLED and FORCED.
-- Policies read app_user_id() / app_role(), which withUser() sets per transaction.
--
-- Cross-tenant facts the fraud engine needs (has this nonce been seen anywhere?) are
-- exposed through SECURITY DEFINER functions that return booleans/aggregates only,
-- so a vendor can never read another vendor's rows.

-- ---------------------------------------------------------------------------
-- Safe projections and helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, name, avatar_seed, role FROM users WHERE is_active;
GRANT SELECT ON public_profiles TO freepay_app;

CREATE OR REPLACE FUNCTION app_nonce_exists(p_nonce text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM transactions WHERE nonce = p_nonce)
      OR EXISTS (SELECT 1 FROM ngo_credits WHERE nonce = p_nonce);
$$;

CREATE OR REPLACE FUNCTION app_txn_exists(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM transactions WHERE id = p_id);
$$;

CREATE OR REPLACE FUNCTION app_merchant_exists(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM merchants WHERE id = p_id);
$$;

CREATE OR REPLACE FUNCTION app_device_belongs_to(p_device_id text, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM devices d
    WHERE d.device_id = p_device_id AND d.user_id = p_user_id AND d.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION app_payer_offline_total(p_payer uuid, p_from timestamptz, p_to timestamptz) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions
  WHERE payer_id = p_payer AND mode = 'OFFLINE' AND status <> 'FAILED'
    AND created_at >= p_from AND created_at < p_to;
$$;

CREATE OR REPLACE FUNCTION app_payer_txn_count(p_payer uuid, p_from timestamptz) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM transactions WHERE payer_id = p_payer AND created_at >= p_from;
$$;

-- Atomically redeem an NGO credit. Returns the credit row or NULL if already redeemed/unknown.
CREATE OR REPLACE FUNCTION app_redeem_ngo_credit(p_credit uuid, p_merchant uuid, p_txn uuid)
RETURNS ngo_credits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r ngo_credits;
BEGIN
  UPDATE ngo_credits
     SET redeemed_at = now(), redeemed_merchant_id = p_merchant, redeemed_txn_id = p_txn
   WHERE id = p_credit AND redeemed_at IS NULL AND expires_at > now()
   RETURNING * INTO r;
  IF r.id IS NOT NULL THEN
    UPDATE ngos SET credits_redeemed = credits_redeemed + 1 WHERE id = r.ngo_id;
  END IF;
  RETURN r;
END $$;

GRANT EXECUTE ON FUNCTION
  app_nonce_exists(text), app_txn_exists(uuid), app_merchant_exists(uuid),
  app_device_belongs_to(text, uuid), app_payer_offline_total(uuid, timestamptz, timestamptz),
  app_payer_txn_count(uuid, timestamptz), app_redeem_ngo_credit(uuid, uuid, uuid)
TO freepay_app;

-- ---------------------------------------------------------------------------
-- Enable + force RLS everywhere
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','admin_users','devices','merchants','wallet_certificates','settlements','ngos','ngo_credits',
    'sync_batches','transactions','rejected_transactions','transaction_annotations','emergencies',
    'emergency_locations','lost_persons','crowd_zones','crowd_zone_edges','crowd_readings','audit_log','vendor_sync_state']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Helper macro-ish predicate: any authenticated app context.
CREATE OR REPLACE FUNCTION app_is_authenticated() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('PILGRIM','VENDOR','ADMIN') $$;
GRANT EXECUTE ON FUNCTION app_is_authenticated() TO freepay_app;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (id = app_user_id() OR app_is_admin() OR app_is_system());
DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_is_system());
DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app_user_id() OR app_is_admin() OR app_is_system())
  WITH CHECK (id = app_user_id() OR app_is_admin() OR app_is_system());

-- admin_users
DROP POLICY IF EXISTS admin_users_select ON admin_users;
CREATE POLICY admin_users_select ON admin_users FOR SELECT
  USING (app_is_system() OR (app_is_admin() AND id = app_user_id()));
DROP POLICY IF EXISTS admin_users_update ON admin_users;
CREATE POLICY admin_users_update ON admin_users FOR UPDATE
  USING (app_is_system() OR (app_is_admin() AND id = app_user_id()));

-- devices
DROP POLICY IF EXISTS devices_select ON devices;
CREATE POLICY devices_select ON devices FOR SELECT
  USING (user_id = app_user_id() OR app_is_admin() OR app_is_system());
DROP POLICY IF EXISTS devices_insert ON devices;
CREATE POLICY devices_insert ON devices FOR INSERT
  WITH CHECK (user_id = app_user_id() OR app_is_system());
DROP POLICY IF EXISTS devices_update ON devices;
CREATE POLICY devices_update ON devices FOR UPDATE
  USING (user_id = app_user_id() OR app_is_admin() OR app_is_system());

-- merchants: directory is readable by every authenticated user
DROP POLICY IF EXISTS merchants_select ON merchants;
CREATE POLICY merchants_select ON merchants FOR SELECT
  USING (app_is_authenticated() OR app_is_system());
DROP POLICY IF EXISTS merchants_insert ON merchants;
CREATE POLICY merchants_insert ON merchants FOR INSERT
  WITH CHECK ((app_role() = 'VENDOR' AND owner_id = app_user_id()) OR app_is_admin() OR app_is_system());
DROP POLICY IF EXISTS merchants_update ON merchants;
CREATE POLICY merchants_update ON merchants FOR UPDATE
  USING (owner_id = app_user_id() OR app_is_admin());

-- wallet_certificates
DROP POLICY IF EXISTS wallet_certificates_select ON wallet_certificates;
CREATE POLICY wallet_certificates_select ON wallet_certificates FOR SELECT
  USING (user_id = app_user_id() OR app_is_admin());
DROP POLICY IF EXISTS wallet_certificates_insert ON wallet_certificates;
CREATE POLICY wallet_certificates_insert ON wallet_certificates FOR INSERT
  WITH CHECK (user_id = app_user_id());

-- ---------------------------------------------------------------------------
-- transactions (append-only ledger)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS transactions_select ON transactions;
CREATE POLICY transactions_select ON transactions FOR SELECT
  USING (payer_id = app_user_id() OR app_owns_merchant(merchant_id) OR app_is_admin());
DROP POLICY IF EXISTS transactions_insert ON transactions;
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (
    (app_role() = 'VENDOR' AND app_owns_merchant(merchant_id))
    OR (app_role() = 'PILGRIM' AND payer_id = app_user_id())
    OR app_is_admin()
  );
DROP POLICY IF EXISTS transactions_update ON transactions;
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (app_owns_merchant(merchant_id) OR app_is_admin())
  WITH CHECK (app_owns_merchant(merchant_id) OR app_is_admin());
-- (no DELETE policy: deletes are impossible for the app role)

DROP POLICY IF EXISTS rejected_select ON rejected_transactions;
CREATE POLICY rejected_select ON rejected_transactions FOR SELECT
  USING (app_owns_merchant(merchant_id) OR app_is_admin());
DROP POLICY IF EXISTS rejected_insert ON rejected_transactions;
CREATE POLICY rejected_insert ON rejected_transactions FOR INSERT
  WITH CHECK ((app_role() = 'VENDOR' AND app_owns_merchant(merchant_id)) OR app_is_admin());

DROP POLICY IF EXISTS annotations_select ON transaction_annotations;
CREATE POLICY annotations_select ON transaction_annotations FOR SELECT
  USING (app_is_admin() OR EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id AND app_owns_merchant(t.merchant_id)));
DROP POLICY IF EXISTS annotations_insert ON transaction_annotations;
CREATE POLICY annotations_insert ON transaction_annotations FOR INSERT
  WITH CHECK (app_is_admin());

DROP POLICY IF EXISTS sync_batches_select ON sync_batches;
CREATE POLICY sync_batches_select ON sync_batches FOR SELECT
  USING (vendor_user_id = app_user_id() OR app_is_admin());
DROP POLICY IF EXISTS sync_batches_insert ON sync_batches;
CREATE POLICY sync_batches_insert ON sync_batches FOR INSERT
  WITH CHECK (vendor_user_id = app_user_id() AND app_owns_merchant(merchant_id));
DROP POLICY IF EXISTS sync_batches_update ON sync_batches;
CREATE POLICY sync_batches_update ON sync_batches FOR UPDATE
  USING (vendor_user_id = app_user_id());

-- vendor_sync_state
DROP POLICY IF EXISTS vendor_sync_state_select ON vendor_sync_state;
CREATE POLICY vendor_sync_state_select ON vendor_sync_state FOR SELECT
  USING (vendor_user_id = app_user_id() OR app_is_admin());
DROP POLICY IF EXISTS vendor_sync_state_insert ON vendor_sync_state;
CREATE POLICY vendor_sync_state_insert ON vendor_sync_state FOR INSERT
  WITH CHECK (vendor_user_id = app_user_id() AND app_owns_merchant(merchant_id));
DROP POLICY IF EXISTS vendor_sync_state_update ON vendor_sync_state;
CREATE POLICY vendor_sync_state_update ON vendor_sync_state FOR UPDATE
  USING (vendor_user_id = app_user_id());

-- settlements
DROP POLICY IF EXISTS settlements_select ON settlements;
CREATE POLICY settlements_select ON settlements FOR SELECT
  USING (app_owns_merchant(merchant_id) OR app_is_admin());
DROP POLICY IF EXISTS settlements_insert ON settlements;
CREATE POLICY settlements_insert ON settlements FOR INSERT
  WITH CHECK (app_owns_merchant(merchant_id) OR app_is_admin());
DROP POLICY IF EXISTS settlements_update ON settlements;
CREATE POLICY settlements_update ON settlements FOR UPDATE
  USING (app_owns_merchant(merchant_id) OR app_is_admin());

-- ---------------------------------------------------------------------------
-- NGOs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ngos_select ON ngos;
CREATE POLICY ngos_select ON ngos FOR SELECT USING (app_is_authenticated());
DROP POLICY IF EXISTS ngos_write ON ngos;
CREATE POLICY ngos_write ON ngos FOR ALL USING (app_is_admin()) WITH CHECK (app_is_admin());

DROP POLICY IF EXISTS ngo_credits_select ON ngo_credits;
CREATE POLICY ngo_credits_select ON ngo_credits FOR SELECT
  USING (app_is_admin() OR (redeemed_merchant_id IS NOT NULL AND app_owns_merchant(redeemed_merchant_id)));
DROP POLICY IF EXISTS ngo_credits_insert ON ngo_credits;
CREATE POLICY ngo_credits_insert ON ngo_credits FOR INSERT WITH CHECK (app_is_admin());

-- ---------------------------------------------------------------------------
-- Crowd
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crowd_zones_select ON crowd_zones;
CREATE POLICY crowd_zones_select ON crowd_zones FOR SELECT USING (app_is_authenticated() OR app_is_system());
DROP POLICY IF EXISTS crowd_zones_write ON crowd_zones;
CREATE POLICY crowd_zones_write ON crowd_zones FOR ALL USING (app_is_admin()) WITH CHECK (app_is_admin());

DROP POLICY IF EXISTS crowd_edges_select ON crowd_zone_edges;
CREATE POLICY crowd_edges_select ON crowd_zone_edges FOR SELECT USING (app_is_authenticated());
DROP POLICY IF EXISTS crowd_edges_write ON crowd_zone_edges;
CREATE POLICY crowd_edges_write ON crowd_zone_edges FOR ALL USING (app_is_admin()) WITH CHECK (app_is_admin());

DROP POLICY IF EXISTS crowd_readings_select ON crowd_readings;
CREATE POLICY crowd_readings_select ON crowd_readings FOR SELECT USING (app_is_authenticated());
DROP POLICY IF EXISTS crowd_readings_insert ON crowd_readings;
CREATE POLICY crowd_readings_insert ON crowd_readings FOR INSERT WITH CHECK (app_is_authenticated());

-- ---------------------------------------------------------------------------
-- Safety: emergencies are visible to responders ONLY inside the sharing window
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS emergencies_select ON emergencies;
CREATE POLICY emergencies_select ON emergencies FOR SELECT
  USING (user_id = app_user_id() OR (app_is_admin() AND expires_at > now()));
DROP POLICY IF EXISTS emergencies_insert ON emergencies;
CREATE POLICY emergencies_insert ON emergencies FOR INSERT
  WITH CHECK (user_id = app_user_id());
DROP POLICY IF EXISTS emergencies_update ON emergencies;
CREATE POLICY emergencies_update ON emergencies FOR UPDATE
  USING (user_id = app_user_id() OR (app_is_admin() AND expires_at > now()));

DROP POLICY IF EXISTS emergency_locations_select ON emergency_locations;
CREATE POLICY emergency_locations_select ON emergency_locations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM emergencies e WHERE e.id = emergency_id
      AND (e.user_id = app_user_id() OR (app_is_admin() AND e.expires_at > now()))));
DROP POLICY IF EXISTS emergency_locations_insert ON emergency_locations;
CREATE POLICY emergency_locations_insert ON emergency_locations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM emergencies e WHERE e.id = emergency_id AND e.user_id = app_user_id()));

-- Aggregate-only history for the dashboard (no locations leak after expiry).
CREATE OR REPLACE FUNCTION app_emergency_stats()
RETURNS TABLE (active bigint, resolved_24h bigint, total bigint, avg_ack_minutes numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*) FILTER (WHERE status IN ('ACTIVE','ACKNOWLEDGED') AND expires_at > now()),
    COUNT(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at > now() - interval '24 hours'),
    COUNT(*),
    ROUND(AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at)) / 60.0)::numeric, 1)
  FROM emergencies;
$$;
GRANT EXECUTE ON FUNCTION app_emergency_stats() TO freepay_app;

-- lost persons: anyone can help find someone
DROP POLICY IF EXISTS lost_persons_select ON lost_persons;
CREATE POLICY lost_persons_select ON lost_persons FOR SELECT USING (app_is_authenticated());
DROP POLICY IF EXISTS lost_persons_insert ON lost_persons;
CREATE POLICY lost_persons_insert ON lost_persons FOR INSERT WITH CHECK (reported_by = app_user_id());
DROP POLICY IF EXISTS lost_persons_update ON lost_persons;
CREATE POLICY lost_persons_update ON lost_persons FOR UPDATE USING (reported_by = app_user_id() OR app_is_admin());

-- audit log: anyone may append, only admins may read
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log FOR SELECT USING (app_is_admin());
DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (app_is_authenticated() OR app_is_system());
