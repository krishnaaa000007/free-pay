-- 004_seed.sql
-- Demo data for the Free Pay pitch environment. Idempotent.
-- Demo logins (password for every pilgrim/vendor: free1234, admin: admin1234):
--   Pilgrim  9000000001  Arjun Sharma
--   Vendor   9000000002  Shankar Prasad  -> "Shankar Chai & Snacks"
--   Admin    admin@freepay.demo

-- ---------------------------------------------------------------------------
-- Zones (a Kumbh-style ghat city). map_x/map_y are 0-1000 schematic coordinates.
-- ---------------------------------------------------------------------------
INSERT INTO crowd_zones (id, code, name, kind, lat, lng, radius_m, capacity, map_x, map_y) VALUES
  ('44444444-4444-4444-8444-000000000001', 'Z-SANGAM',  'Sangam Ghat',          'GHAT',    25.4266, 81.8846, 220, 60000, 500, 800),
  ('44444444-4444-4444-8444-000000000002', 'Z-TRIVENI', 'Triveni Marg',         'ROAD',    25.4299, 81.8812, 160, 20000, 500, 600),
  ('44444444-4444-4444-8444-000000000003', 'Z-BAZAAR',  'Sector 4 Bazaar',      'MARKET',  25.4321, 81.8768, 180, 25000, 290, 520),
  ('44444444-4444-4444-8444-000000000004', 'Z-AKHARA',  'Akhara Camp',          'CAMP',    25.4310, 81.8871, 200, 30000, 720, 520),
  ('44444444-4444-4444-8444-000000000005', 'Z-GATE',    'Main Gate',            'GATE',    25.4382, 81.8801, 120, 15000, 500, 120),
  ('44444444-4444-4444-8444-000000000006', 'Z-MEDICAL', 'Medical Post 3',       'MEDICAL', 25.4355, 81.8760, 90,   3000, 300, 300),
  ('44444444-4444-4444-8444-000000000007', 'Z-SHUTTLE', 'Parking & Shuttle',    'TRANSIT', 25.4368, 81.8862, 200, 18000, 720, 300),
  ('44444444-4444-4444-8444-000000000008', 'Z-ARAIL',   'Arail Ghat',           'GHAT',    25.4231, 81.8901, 200, 35000, 820, 800),
  ('44444444-4444-4444-8444-000000000009', 'Z-KALI',    'Kali Marg',            'ROAD',    25.4275, 81.8779, 150, 15000, 280, 720),
  ('44444444-4444-4444-8444-000000000010', 'Z-FOOD',    'Annakshetra Food Court','MARKET', 25.4258, 81.8878, 150, 12000, 700, 690)
ON CONFLICT (id) DO NOTHING;

INSERT INTO crowd_zone_edges (from_zone, to_zone, distance_m)
SELECT a.id, b.id, e.d FROM (VALUES
  ('Z-GATE','Z-MEDICAL',420), ('Z-GATE','Z-SHUTTLE',430), ('Z-GATE','Z-TRIVENI',620),
  ('Z-MEDICAL','Z-BAZAAR',380), ('Z-SHUTTLE','Z-AKHARA',400), ('Z-TRIVENI','Z-BAZAAR',360),
  ('Z-TRIVENI','Z-AKHARA',380), ('Z-TRIVENI','Z-SANGAM',330), ('Z-BAZAAR','Z-KALI',300),
  ('Z-KALI','Z-SANGAM',380), ('Z-AKHARA','Z-FOOD',290), ('Z-FOOD','Z-SANGAM',320),
  ('Z-FOOD','Z-ARAIL',260), ('Z-SANGAM','Z-ARAIL',480), ('Z-BAZAAR','Z-AKHARA',700)
) AS e(a, b, d)
JOIN crowd_zones a ON a.code = e.a JOIN crowd_zones b ON b.code = e.b
ON CONFLICT DO NOTHING;
-- make edges bidirectional
INSERT INTO crowd_zone_edges (from_zone, to_zone, distance_m)
SELECT to_zone, from_zone, distance_m FROM crowd_zone_edges ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
INSERT INTO users (id, phone, name, role, password_hash, language, avatar_seed, created_at) VALUES
  ('11111111-1111-4111-8111-000000000001', '9000000001', 'Arjun Sharma',   'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 3, now() - interval '20 days'),
  ('11111111-1111-4111-8111-000000000002', '9000000011', 'Meera Iyer',     'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'ta', 7, now() - interval '18 days'),
  ('11111111-1111-4111-8111-000000000003', '9000000012', 'Ravi Patel',     'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'gu', 1, now() - interval '16 days'),
  ('11111111-1111-4111-8111-000000000004', '9000000013', 'Lakshmi Nair',   'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'en', 9, now() - interval '15 days'),
  ('11111111-1111-4111-8111-000000000005', '9000000014', 'Sunita Devi',    'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 4, now() - interval '12 days'),
  ('11111111-1111-4111-8111-000000000006', '9000000015', 'Mohan Das',      'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'mr', 6, now() - interval '11 days'),
  ('11111111-1111-4111-8111-000000000007', '9000000016', 'Kavya Reddy',    'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'en', 2, now() - interval '9 days'),
  ('11111111-1111-4111-8111-000000000008', '9000000017', 'Harish Kumar',   'PILGRIM', '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 8, now() - interval '6 days'),
  ('22222222-2222-4222-8222-000000000001', '9000000002', 'Shankar Prasad', 'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 5, now() - interval '25 days'),
  ('22222222-2222-4222-8222-000000000002', '9000000003', 'Geeta Bai',      'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'mr', 10, now() - interval '24 days'),
  ('22222222-2222-4222-8222-000000000003', '9000000004', 'Ramesh Yadav',   'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 0, now() - interval '23 days'),
  ('22222222-2222-4222-8222-000000000004', '9000000005', 'Fatima Bano',    'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'en', 11, now() - interval '22 days'),
  ('22222222-2222-4222-8222-000000000005', '9000000006', 'Dinesh Gupta',   'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 3, now() - interval '21 days'),
  ('22222222-2222-4222-8222-000000000006', '9000000007', 'Anita Verma',    'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 6, now() - interval '20 days'),
  ('22222222-2222-4222-8222-000000000007', '9000000008', 'Raju Sahani',    'VENDOR',  '$2b$10$svygPODxbGB6TNjEgATwnuj2fazdUaCufCh28z.Oc47jbnPZsyBle', 'hi', 1, now() - interval '19 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_users (id, email, name, password_hash) VALUES
  ('55555555-5555-4555-8555-000000000001', 'admin@freepay.demo', 'Mela Control Room', '$2b$10$Yal/FurtH/SE8FxIbVlWJe3INdTdpRbbBCCsK50xevQ57LKyp7i2O')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Merchants
-- ---------------------------------------------------------------------------
INSERT INTO merchants (id, owner_id, code, name, category, zone_id, settlement_account, is_verified) VALUES
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'SHR-001', 'Shankar Chai & Snacks',     'FOOD',      '44444444-4444-4444-8444-000000000002', 'SBIN••••4821', true),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000002', 'GEE-002', 'Geeta Flower Garlands',      'PUJA',      '44444444-4444-4444-8444-000000000001', 'BARB••••1190', true),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000003', 'GAN-003', 'Ganga Prasad Bhandar',       'PUJA',      '44444444-4444-4444-8444-000000000009', 'PUNB••••7733', true),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000004', 'NOR-004', 'Noor Handicrafts',           'CRAFT',     '44444444-4444-4444-8444-000000000003', 'HDFC••••2054', true),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000005', 'KBR-005', 'Sangam Boat Rides',          'TRANSPORT', '44444444-4444-4444-8444-000000000001', 'UBIN••••9012', false),
  ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-000000000006', 'ANN-006', 'Annapurna Thali House',      'FOOD',      '44444444-4444-4444-8444-000000000010', 'ICIC••••3308', true),
  ('33333333-3333-4333-8333-000000000007', '22222222-2222-4222-8222-000000000007', 'SAH-007', 'Sahani Fruit Cart',          'FOOD',      '44444444-4444-4444-8444-000000000003', 'SBIN••••6617', true)
ON CONFLICT (id) DO NOTHING;

-- Demo devices (public keys are placeholders; real devices register their own keys at onboarding)
INSERT INTO devices (user_id, device_id, public_key, platform, model) VALUES
  ('11111111-1111-4111-8111-000000000002', 'seed-dev-meera',   'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'android', 'Redmi Note 12'),
  ('11111111-1111-4111-8111-000000000003', 'seed-dev-ravi',    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'android', 'Samsung M14'),
  ('11111111-1111-4111-8111-000000000004', 'seed-dev-lakshmi', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'ios',     'iPhone 13'),
  ('22222222-2222-4222-8222-000000000002', 'seed-vdev-geeta',  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'android', 'Realme C55')
ON CONFLICT (device_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- NGOs
-- ---------------------------------------------------------------------------
INSERT INTO ngos (id, name, registration_no, category, verified, tenure_years, complaints, disbursed_total, credits_issued, credits_redeemed, trust_score, description) VALUES
  ('66666666-6666-4666-8666-000000000001', 'Seva Bharati Relief Trust',  'NGO-UP-2009-11821', 'RELIEF',  true,  15, 1,  48250000, 640, 588, 0, 'Meals and medical kits for pilgrims travelling on foot.'),
  ('66666666-6666-4666-8666-000000000002', 'Annadaan Foundation',        'NGO-MH-2014-04410', 'FOOD',    true,  10, 0,  21500000, 410, 402, 0, 'Free langar meals across Sector 4 and Arail.'),
  ('66666666-6666-4666-8666-000000000003', 'Ganga Swachhta Samiti',      'NGO-UP-2017-22087', 'CIVIC',   true,  7,  3,   6400000, 120, 96,  0, 'Sanitation volunteers and drinking-water points.'),
  ('66666666-6666-4666-8666-000000000004', 'Yatri Sahayata Kendra',      'NGO-DL-2021-31099', 'RELIEF',  false, 3,  6,   1800000, 60,  31,  0, 'Newly registered helpdesk collective; verification pending.'),
  ('66666666-6666-4666-8666-000000000005', 'Bal Suraksha Network',       'NGO-UP-2011-08761', 'CHILD',   true,  13, 0,   9900000, 210, 205, 0, 'Lost-child reunification and safe spaces.')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Transactions: 14 days of realistic, deterministic history
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pilgrims  uuid[] := ARRAY[
    '11111111-1111-4111-8111-000000000001','11111111-1111-4111-8111-000000000002','11111111-1111-4111-8111-000000000003',
    '11111111-1111-4111-8111-000000000004','11111111-1111-4111-8111-000000000005','11111111-1111-4111-8111-000000000006',
    '11111111-1111-4111-8111-000000000007','11111111-1111-4111-8111-000000000008']::uuid[];
  merchants uuid[] := ARRAY[
    '33333333-3333-4333-8333-000000000001','33333333-3333-4333-8333-000000000002','33333333-3333-4333-8333-000000000003',
    '33333333-3333-4333-8333-000000000004','33333333-3333-4333-8333-000000000005','33333333-3333-4333-8333-000000000006',
    '33333333-3333-4333-8333-000000000007']::uuid[];
  -- weights: the chai stall and thali house are busiest
  merchant_weights int[] := ARRAY[28, 14, 12, 8, 6, 20, 12];
  amounts bigint[] := ARRAY[1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 45000, 60000, 80000, 120000, 160000, 180000, 195000];
  i int; n int := 480;
  r double precision; w int; acc int; mi int; pick int;
  t timestamptz; hour double precision; amt bigint; m uuid; p uuid; md txn_mode; st txn_status;
  flags text[]; susp boolean; dec text; synced timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM transactions) THEN RETURN; END IF;
  PERFORM setseed(0.42);
  FOR i IN 1..n LOOP
    -- day: bias towards recent days (pitch demo looks alive)
    t := date_trunc('day', now()) - (floor(power(random(), 1.4) * 14))::int * interval '1 day';
    -- hour-of-day: bimodal (morning snan + evening aarti)
    r := random();
    hour := CASE WHEN r < 0.45 THEN 5 + random() * 5 WHEN r < 0.8 THEN 16 + random() * 5 ELSE 10 + random() * 6 END;
    t := t + hour * interval '1 hour' + (random() * 60) * interval '1 minute';
    IF t > now() THEN t := now() - (random() * 90) * interval '1 minute'; END IF;

    p := pilgrims[1 + floor(random() * array_length(pilgrims, 1))::int];
    -- weighted pick (the FOR variable is loop-scoped in PL/pgSQL, so capture the choice explicitly)
    w := 1 + floor(random() * 100)::int; acc := 0; pick := array_length(merchants, 1);
    FOR mi IN 1..array_length(merchants, 1) LOOP
      acc := acc + merchant_weights[mi];
      IF w <= acc THEN pick := mi; EXIT; END IF;
    END LOOP;
    m := merchants[pick];
    amt := amounts[1 + floor(power(random(), 1.7) * array_length(amounts, 1))::int];

    r := random();
    md := CASE WHEN r < 0.66 THEN 'OFFLINE'::txn_mode WHEN r < 0.95 THEN 'ONLINE'::txn_mode ELSE 'NGO_CREDIT'::txn_mode END;
    synced := CASE WHEN md = 'OFFLINE' THEN t + (random() * random() * 8) * interval '1 hour' ELSE t + interval '2 seconds' END;
    IF synced > now() THEN synced := now() - interval '30 seconds'; END IF;
    st := CASE WHEN t < now() - interval '3 days' THEN 'SETTLED'::txn_status
               WHEN random() < 0.025 THEN 'FAILED'::txn_status
               ELSE 'SYNCED'::txn_status END;

    flags := '{}'; susp := false; dec := 'ACCEPT';
    IF amt > 150000 THEN flags := array_append(flags, 'ABOVE_REVIEW_THRESHOLD'); dec := 'REVIEW'; END IF;
    IF random() < 0.03 THEN flags := array_append(flags, 'DEVICE_MISMATCH'); susp := true; dec := 'REVIEW'; END IF;
    IF random() < 0.015 THEN flags := array_append(flags, 'UNKNOWN_MERCHANT'); susp := true; dec := 'REVIEW'; END IF;
    IF st = 'FAILED' THEN flags := ARRAY['SETTLEMENT_RETURNED']; dec := 'ACCEPT'; END IF;

    INSERT INTO transactions (id, nonce, payer_id, merchant_id, payer_device_id, vendor_device_id, amount, mode, status,
                              created_at, expires_at, accepted_at, synced_at, settled_at, fraud_decision, fraud_flags, suspicious, memo)
    VALUES (gen_random_uuid(), encode(gen_random_bytes(16), 'hex'),
            CASE WHEN md = 'NGO_CREDIT' THEN NULL ELSE p END, m,
            CASE WHEN md = 'NGO_CREDIT' THEN NULL ELSE 'seed-dev-' || substr(p::text, 33, 4) END,
            'seed-vdev-' || substr(m::text, 33, 4),
            amt, md, st, t,
            CASE WHEN md = 'OFFLINE' THEN t + interval '10 days' ELSE t + interval '15 minutes' END,
            t + interval '40 seconds', synced,
            CASE WHEN st = 'SETTLED' THEN date_trunc('day', t) + interval '2 days 6 hours' END,
            dec, flags, susp,
            CASE WHEN md = 'NGO_CREDIT' THEN 'NGO meal credit' ELSE NULL END);
  END LOOP;
END $$;

-- Rejected attempts (kept off-ledger for audit)
INSERT INTO rejected_transactions (transaction_id, nonce, merchant_id, payer_id, amount, reasons, rejected_at)
SELECT gen_random_uuid(), encode(gen_random_bytes(16), 'hex'), m, p, a, r, now() - (d * interval '1 hour')
FROM (VALUES
  ('33333333-3333-4333-8333-000000000001'::uuid, '11111111-1111-4111-8111-000000000005'::uuid, 250000, ARRAY['EXCEEDS_SINGLE_TXN_LIMIT'], 3.5),
  ('33333333-3333-4333-8333-000000000003'::uuid, '11111111-1111-4111-8111-000000000002'::uuid, 12000,  ARRAY['DUPLICATE_NONCE'], 7.2),
  ('33333333-3333-4333-8333-000000000006'::uuid, '11111111-1111-4111-8111-000000000003'::uuid, 8000,   ARRAY['REPLAYED_TRANSACTION_ID'], 12.0),
  ('33333333-3333-4333-8333-000000000002'::uuid, '11111111-1111-4111-8111-000000000006'::uuid, 15000,  ARRAY['STALE_OFFLINE_AUTHORIZATION'], 26.4),
  ('33333333-3333-4333-8333-000000000007'::uuid, '11111111-1111-4111-8111-000000000008'::uuid, 60000,  ARRAY['EXCEEDS_DAILY_LIMIT'], 30.1),
  ('33333333-3333-4333-8333-000000000004'::uuid, '11111111-1111-4111-8111-000000000001'::uuid, 45000,  ARRAY['INVALID_SIGNATURE'], 41.7)
) AS v(m, p, a, r, d)
WHERE NOT EXISTS (SELECT 1 FROM rejected_transactions);

-- Settlements: one COMPLETED per merchant for everything already SETTLED, plus PENDING for two stalls
DO $$
DECLARE m record; sid uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM settlements) THEN RETURN; END IF;
  FOR m IN SELECT merchant_id, SUM(amount) AS total, COUNT(*) AS cnt, MAX(settled_at) AS at
           FROM transactions WHERE status = 'SETTLED' GROUP BY merchant_id LOOP
    sid := gen_random_uuid();
    INSERT INTO settlements (id, merchant_id, requested_by, amount, txn_count, status, provider, provider_ref, requested_at, processed_at)
    SELECT sid, m.merchant_id, owner_id, m.total, m.cnt, 'COMPLETED', 'MOCK_SANDBOX', 'SBX-' || upper(substr(md5(sid::text), 1, 10)), m.at - interval '2 hours', m.at
    FROM merchants WHERE id = m.merchant_id;
    UPDATE transactions SET settlement_id = sid WHERE merchant_id = m.merchant_id AND status = 'SETTLED';
  END LOOP;
  INSERT INTO settlements (merchant_id, requested_by, amount, txn_count, status, requested_at)
  SELECT merchant_id, (SELECT owner_id FROM merchants WHERE id = t.merchant_id), SUM(amount), COUNT(*), 'PENDING', now() - interval '35 minutes'
  FROM transactions t WHERE status = 'SYNCED' AND merchant_id IN ('33333333-3333-4333-8333-000000000002', '33333333-3333-4333-8333-000000000006')
  GROUP BY merchant_id;
END $$;

-- Vendor sync heartbeat (what the ops "pending sync" tab watches)
INSERT INTO vendor_sync_state (merchant_id, vendor_user_id, device_id, pending_count, pending_amount, last_sync_at, last_seen_at, app_version, battery_pct, network) VALUES
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'seed-vdev-0001', 7,  84000,  now() - interval '48 minutes', now() - interval '3 minutes',  '0.1.0', 62, 'offline'),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000002', 'seed-vdev-geeta', 0,  0,      now() - interval '2 minutes',  now() - interval '2 minutes',  '0.1.0', 88, 'wifi'),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000003', 'seed-vdev-0003', 23, 312000, now() - interval '3 hours 10 minutes', now() - interval '41 minutes', '0.1.0', 19, 'offline'),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000004', 'seed-vdev-0004', 2,  60000,  now() - interval '12 minutes', now() - interval '1 minute',   '0.1.0', 74, 'cellular'),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000005', 'seed-vdev-0005', 11, 220000, now() - interval '1 hour 25 minutes', now() - interval '9 minutes', '0.1.0', 41, 'offline'),
  ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-000000000006', 'seed-vdev-0006', 0,  0,      now() - interval '1 minute',   now() - interval '1 minute',   '0.1.0', 93, 'wifi'),
  ('33333333-3333-4333-8333-000000000007', '22222222-2222-4222-8222-000000000007', 'seed-vdev-0007', 4,  17000,  now() - interval '27 minutes', now() - interval '6 minutes',  '0.1.0', 55, 'cellular')
ON CONFLICT (merchant_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Crowd readings: last 24h, hourly, with a realistic diurnal curve per zone kind
-- ---------------------------------------------------------------------------
INSERT INTO crowd_readings (zone_id, head_count, density, source, recorded_at)
SELECT z.id,
       GREATEST(0, round(z.capacity * d.f))::int,
       round(LEAST(1.35, d.f)::numeric, 3),
       'SIMULATED',
       d.ts
FROM crowd_zones z
CROSS JOIN LATERAL (
  SELECT ts,
         -- base diurnal curve + kind modifier + small noise
         (0.25 + 0.55 * exp(-power((EXTRACT(HOUR FROM ts) - 6.5) / 2.2, 2)) + 0.5 * exp(-power((EXTRACT(HOUR FROM ts) - 18.5) / 2.0, 2)))
         * CASE z.kind WHEN 'GHAT' THEN 1.25 WHEN 'ROAD' THEN 1.05 WHEN 'MARKET' THEN 0.9 WHEN 'GATE' THEN 0.95 WHEN 'MEDICAL' THEN 0.35 WHEN 'TRANSIT' THEN 0.7 ELSE 0.8 END
         * (0.92 + 0.16 * random()) AS f
  FROM generate_series(now() - interval '24 hours', now(), interval '1 hour') AS ts
) d
WHERE NOT EXISTS (SELECT 1 FROM crowd_readings);

-- ---------------------------------------------------------------------------
-- Emergencies (3 live, several resolved) and lost persons
-- ---------------------------------------------------------------------------
INSERT INTO emergencies (id, user_id, kind, note, lat, lng, accuracy_m, zone_id, status, created_at, expires_at, acknowledged_at, acknowledged_by, resolved_at) VALUES
  ('77777777-7777-4777-8777-000000000001', '11111111-1111-4111-8111-000000000005', 'MEDICAL',    'Elderly woman fainted near ghat steps', 25.4268, 81.8843, 12, '44444444-4444-4444-8444-000000000001', 'ACKNOWLEDGED', now() - interval '9 minutes',  now() + interval '51 minutes', now() - interval '6 minutes', '55555555-5555-4555-8555-000000000001', NULL),
  ('77777777-7777-4777-8777-000000000002', '11111111-1111-4111-8111-000000000003', 'LOST_CHILD', 'Boy, 6, red kurta, last seen at bazaar', 25.4323, 81.8771, 20, '44444444-4444-4444-8444-000000000003', 'ACTIVE',       now() - interval '4 minutes',  now() + interval '56 minutes', NULL, NULL, NULL),
  ('77777777-7777-4777-8777-000000000003', '11111111-1111-4111-8111-000000000007', 'SECURITY',   'Crowd pushing at Triveni junction',     25.4297, 81.8815, 15, '44444444-4444-4444-8444-000000000002', 'ACTIVE',       now() - interval '1 minute',   now() + interval '59 minutes', NULL, NULL, NULL),
  ('77777777-7777-4777-8777-000000000004', '11111111-1111-4111-8111-000000000002', 'MEDICAL',    'Dehydration',                           25.4310, 81.8870, 10, '44444444-4444-4444-8444-000000000004', 'RESOLVED',     now() - interval '5 hours',    now() - interval '4 hours',    now() - interval '4 hours 55 minutes', '55555555-5555-4555-8555-000000000001', now() - interval '4 hours 30 minutes'),
  ('77777777-7777-4777-8777-000000000005', '11111111-1111-4111-8111-000000000006', 'OTHER',      'Wallet stolen',                         25.4380, 81.8800, 25, '44444444-4444-4444-8444-000000000005', 'RESOLVED',     now() - interval '1 day 2 hours', now() - interval '1 day 1 hour', now() - interval '1 day 1 hour 52 minutes', '55555555-5555-4555-8555-000000000001', now() - interval '1 day'),
  ('77777777-7777-4777-8777-000000000006', '11111111-1111-4111-8111-000000000008', 'FIRE',       'Small stove fire at food court, contained', 25.4259, 81.8877, 8, '44444444-4444-4444-8444-000000000010', 'RESOLVED', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', now() - interval '2 days' + interval '3 minutes', '55555555-5555-4555-8555-000000000001', now() - interval '2 days' + interval '25 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO emergency_locations (emergency_id, lat, lng, recorded_at)
SELECT e.id, e.lat + (g - 3) * 0.00004, e.lng + (g - 3) * 0.00003, e.created_at + g * interval '1 minute'
FROM emergencies e CROSS JOIN generate_series(0, 3) g
WHERE e.status IN ('ACTIVE', 'ACKNOWLEDGED') AND NOT EXISTS (SELECT 1 FROM emergency_locations);

INSERT INTO lost_persons (id, reported_by, name, age, gender, description, last_seen_zone_id, last_seen_at, contact_phone, status, created_at, found_at) VALUES
  ('88888888-8888-4888-8888-000000000001', '11111111-1111-4111-8111-000000000003', 'Aarav Patel',     6,  'M', 'Red kurta, yellow cap, speaks Gujarati',      '44444444-4444-4444-8444-000000000003', now() - interval '25 minutes', '9000000012', 'OPEN',  now() - interval '20 minutes', NULL),
  ('88888888-8888-4888-8888-000000000002', '11111111-1111-4111-8111-000000000005', 'Kamla Devi',      72, 'F', 'White saree, walking stick, hard of hearing', '44444444-4444-4444-8444-000000000001', now() - interval '2 hours',    '9000000014', 'OPEN',  now() - interval '1 hour 50 minutes', NULL),
  ('88888888-8888-4888-8888-000000000003', '11111111-1111-4111-8111-000000000002', 'Sivakumar',       45, 'M', 'Blue shirt, carrying a green cloth bag',       '44444444-4444-4444-8444-000000000008', now() - interval '1 day',      '9000000011', 'FOUND', now() - interval '1 day', now() - interval '20 hours'),
  ('88888888-8888-4888-8888-000000000004', '11111111-1111-4111-8111-000000000006', 'Pinky Das',       9,  'F', 'Pink frock, two braids',                       '44444444-4444-4444-8444-000000000010', now() - interval '3 days',     '9000000015', 'FOUND', now() - interval '3 days', now() - interval '3 days' + interval '2 hours')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, meta, created_at)
SELECT * FROM (VALUES
  ('55555555-5555-4555-8555-000000000001', 'ADMIN', 'ADMIN_LOGIN',         'admin_users', '55555555-5555-4555-8555-000000000001', '{"ip":"10.4.1.22"}'::jsonb, now() - interval '3 hours'),
  ('55555555-5555-4555-8555-000000000001', 'ADMIN', 'EMERGENCY_ACKNOWLEDGED', 'emergencies', '77777777-7777-4777-8777-000000000001', '{"kind":"MEDICAL"}'::jsonb, now() - interval '6 minutes'),
  ('22222222-2222-4222-8222-000000000003', 'VENDOR', 'SYNC_BATCH',         'sync_batches', NULL, '{"items":18,"accepted":17,"review":1}'::jsonb, now() - interval '3 hours 10 minutes'),
  ('22222222-2222-4222-8222-000000000002', 'VENDOR', 'SETTLEMENT_REQUESTED','settlements', NULL, '{"amount":184000}'::jsonb, now() - interval '35 minutes'),
  ('11111111-1111-4111-8111-000000000001', 'PILGRIM', 'CREDENTIAL_ISSUED',  'wallet_certificates', NULL, '{"ttl_days":10}'::jsonb, now() - interval '1 day'),
  ('55555555-5555-4555-8555-000000000001', 'ADMIN', 'TXN_FLAGGED',         'transactions', NULL, '{"reason":"amount pattern"}'::jsonb, now() - interval '1 day 4 hours'),
  ('55555555-5555-4555-8555-000000000001', 'ADMIN', 'NGO_CREDIT_ISSUED',   'ngo_credits', NULL, '{"ngo":"Annadaan Foundation","count":25}'::jsonb, now() - interval '2 days')
) v
WHERE NOT EXISTS (SELECT 1 FROM audit_log);

-- Recompute NGO trust scores from the seeded facts (same formula as services/ngoTrust.ts)
UPDATE ngos SET trust_score = ROUND(LEAST(100, GREATEST(0,
    (CASE WHEN verified THEN 35 ELSE 10 END)
  + LEAST(25, tenure_years * 2.0)
  + LEAST(20, (credits_redeemed::numeric / GREATEST(1, credits_issued)) * 20)
  + LEAST(15, (disbursed_total / 100.0) / 3000000.0 * 15)
  - LEAST(30, complaints * 4)
))::numeric, 2);
