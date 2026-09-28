# Free Pay

**Offline-first digital payments and crowd safety for large pilgrimage events.**

At a mela, three crore people share a few cell towers. Free Pay lets a pilgrim pay a chai
stall with a cryptographically signed QR that the vendor verifies **without any network**,
stores a signed receipt on the device, and syncs to an append-only ledger the moment a
signal returns. The same app carries live crowd density, calmer-route suggestions, a
hold-to-trigger SOS with time-boxed location sharing, and lost-person reporting.

This repository is a working proof of concept: three apps and one shared design language.

| Package | Stack | Port |
| --- | --- | --- |
| `/app`, `/src` — **Mobile** (pilgrim + vendor) | Expo SDK 57 · React Native 0.86 · expo-router · React 19 · TypeScript | 8081 |
| `/server` — **API** | Node 22 (ESM) · Express 4 · PostgreSQL (row-level security) · zod · JWT · tweetnacl | 4000 |
| `/admin` — **Ops dashboard** | Next.js 14 (App Router) · React 18 · dependency-free SVG charts | 3001 |

---

## 60-second tour

1. **Pilgrim** signs in once online. The phone generates an Ed25519 key in the secure
   enclave and the platform issues a **wallet credential** (max 10 days) binding
   user → device → key, with offline limits (₹2,000 / payment, ₹5,000 / rolling day).
2. **Pilgrim pays** — scans the stall's platform-signed QR, types an amount, and the phone
   signs a **payment authorisation** (transaction id, nonce, amount, merchant, expiry).
   It is shown as a QR. No network involved.
3. **Vendor verifies offline** — checks the platform signature on the credential, the
   device signature on the authorisation, expiry, staleness, merchant match, limits and
   local replay, then signs a **receipt** and stores everything in SQLite as
   `PENDING_SYNC`.
4. **AutoSync** — when either phone sees a signal, the vendor's queue is posted. The server
   re-verifies every signature, runs the **fraud engine** (replay, tampered expiry, stale
   credential, limits, device binding, review threshold, velocity) and persists
   `SYNCED`, or rejects. `SYNCED → SETTLED` happens when the vendor requests settlement
   through a **sandbox provider that never moves real money**.
5. **Ops** watch it all in the dashboard: 18 live metrics, analytics, pending-sync heat,
   fraud flags, settlements, crowd map, live SOS, audit trail.

Three presentation aids ship with the POC:

- **Two phones, two screens** — `http://localhost:3001/phone.html?role=pilgrim` and
  `?role=vendor` each render one iPhone-style handset sized to its own screen. The two
  windows find each other and hand over the QR string directly, browser to browser, so the
  offline payment works with the network cut; one switch takes both phones offline.
- **Demo stage** — `http://localhost:3001/stage.html` puts the **pilgrim and vendor phones
  side by side in one window**, with a network kill-switch that takes both offline at once.
  The phones run on two origins (`localhost:8081` / `127.0.0.1:8081`) so their sessions,
  device keys and ledgers are genuinely separate; the stage relays the QR string between
  them in place of a camera, and every signature and fraud check runs unchanged.
- **Pitch demo** screen (`/demo` in the app) runs the entire loop on one phone with every
  cryptographic step visible — including a tamper switch and a replay-attack button so
  investors can watch the fraud engine say no.

---

## Quick start

Prerequisites: Node 22+, npm 10+, PostgreSQL 16 (Docker or native), Expo Go on a phone
(or an emulator).

```bash
# 1. install everything (root = mobile, then server, then admin)
npm run setup

# 2. database: either Docker...
npm run db:up
# ...or point server/.env at an existing PostgreSQL (DB_ADMIN_USER / DB_ADMIN_PASSWORD).

# 3. platform signing key (prints the seed + public key)
npm --prefix server run keys
#    -> PLATFORM_SIGNING_SEED into server/.env, EXPO_PUBLIC_PLATFORM_PUBKEY into .env

# 4. schema, non-superuser app role, RLS policies, demo seed
npm run db:migrate

# 5. run the API (4000) + admin (3001)
npm run dev

# 6. run the mobile app (8081) — scan the QR with Expo Go
npm run dev:mobile
```

For a physical phone set `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000` in `.env`.

### Demo accounts (seeded)

| Role | Login | Password |
| --- | --- | --- |
| Pilgrim | `9000000001` (Arjun Sharma) | `free1234` |
| Vendor | `9000000002` (Shankar Chai & Snacks) | `free1234` |
| Admin | `admin@freepay.demo` | `admin1234` |

The login screen has one-tap buttons for the pilgrim and vendor demo accounts. Forgot
password uses demo OTP `123456`.

---

## Repository layout

```
/app                 expo-router routes
  (auth)/            login · register · forgot-password · onboarding
  (pilgrim)/         home · scan · history · crowd-tab · profile
  (vendor)/          dashboard · transactions · accept · sync · settlement · more
  pay · receipt · vendor-verify · crowd · crowd-route · emergency · lost-person
  transaction/[id] · demo
/src
  providers/         SafeArea → QueryClient → I18n → Auth → Network
  services/          payment · qr · crypto · ledger (SQLite, localStorage on web) · sync
                     storage · settlement · notifications · api · ai · location · sound
                     stageBridge (demo stage only)
  domain/            pure rules: credential · limits · crypto · money · routing · time
  components/        OfflineBanner · AutoSyncManager · QrScanner · NumericKeypad
                     AiAssistantSheet · NotificationToaster · PilgrimTabBar
                     MapSimulationLoader · MelaMap · SosButton · ReceiptView · ui/*
  i18n/              en · hi · mr · gu · ta
  theme/             the parchment design tokens
/__tests__           Jest (crypto, QR, limits, i18n, notifications, ledger)
/server
  src/index.ts       bootstrap → app.ts → middleware.ts · rateLimit.ts · logger.ts
  src/routes/        auth · merchants · transactions · settlement · crowd · emergency
                     admin · ngos · ai · demo
  src/services/      credentials · fraud · reconciliation · receipt · crowd · ngoTrust
                     ngoQr · transactions · settlement/ (mock sandbox) · types · crypto
  src/db.ts          withUser() → set_config(app.user_id, app.role) → RLS
  src/tunnel.ts      optional SSH tunnel (ssh2)
  src/migrate.ts     numbered idempotent SQL migrations
  migrations/        001 schema · 002 app role · 003 RLS · 004 seed
  __tests__/         crypto · credentials · fraud · reconciliation · settlement · receipt
                     security-attacks · api · crowd-ngo · rls (needs a database)
/admin
  app/               login · dashboard (tabs via ?tab=)
  components/        Shell · charts/ (SVG) · tabs/ · ui
  __tests__/         chart math + formatters
ARCHITECTURE.md      diagrams and the security model in depth
DEMO.md              the five-minute pitch script
```

---

## Scripts

Root:

| Script | What it does |
| --- | --- |
| `npm run setup` | install root, server and admin |
| `npm run dev` | API + admin together (concurrently) |
| `npm run dev:mobile` / `dev:server` / `dev:admin` | one at a time |
| `npm run db:up` / `db:down` | Docker Postgres |
| `npm run db:migrate` | apply migrations (as the DB owner) |
| `npm test` / `npm run test:all` | mobile tests / all three packages |
| `npm run typecheck:all` | `tsc --noEmit` in all three packages |

Server: `dev`, `start`, `migrate`, `migrate:reset` (dev only), `keys`, `test`, `test:db`.

---

## Configuration

Every limit and threshold is an environment variable. Defaults are identical on the
client and the server so both enforce the same rules.

**Mobile (`.env`, only `EXPO_PUBLIC_*` is bundled)**

| Variable | Default | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | API base URL |
| `EXPO_PUBLIC_PLATFORM_PUBKEY` | — | platform Ed25519 public key (base64) |
| `EXPO_PUBLIC_MAX_OFFLINE_TXN_INR` | 2000 | max single offline payment |
| `EXPO_PUBLIC_MAX_OFFLINE_DAILY_INR` | 5000 | rolling 24 h offline cap |
| `EXPO_PUBLIC_MAX_OFFLINE_AGE_DAYS` | 10 | credential / authorisation max age (hard cap 10) |
| `EXPO_PUBLIC_ONLINE_RECEIPT_TTL_MIN` | 15 | online receipt validity for merchant verification |
| `EXPO_PUBLIC_EMERGENCY_CONTACTS` | control room, police, ambulance, lost & found | offline fallback numbers |
| `EXPO_PUBLIC_DEFAULT_LANGUAGE` | `en` | `en` `hi` `mr` `gu` `ta` |

**Server (`server/.env`)**

| Variable | Meaning |
| --- | --- |
| `PORT`, `CORS_ORIGINS`, `LOG_LEVEL` | runtime |
| `JWT_SECRET`, `JWT_EXPIRES_IN` (7d) | auth |
| `PLATFORM_SIGNING_SEED`, `PLATFORM_KEY_ID` | platform Ed25519 key (`npm run keys`) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSL` | API connection as the **non-superuser** `freepay_app` role |
| `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD` (or `DATABASE_ADMIN_URL`) | used only by the migration runner |
| `SSH_TUNNEL_ENABLED` + `SSH_*` | optional SSH tunnel to a remote Postgres |
| `FRAUD_MAX_SINGLE_OFFLINE_INR` (2000) `FRAUD_MAX_DAILY_OFFLINE_INR` (5000) `FRAUD_REVIEW_THRESHOLD_INR` (1500) `FRAUD_MAX_OFFLINE_AGE_DAYS` (10) `FRAUD_VELOCITY_*` | fraud engine |
| `ONLINE_RECEIPT_TTL_MIN` (15), `EMERGENCY_SHARE_TTL_MIN` (60), `EMERGENCY_CONTACTS` | product rules |
| `OPENAI_API_KEY`, `OPENAI_MODEL` (gpt-4o-mini) | AI assistant proxy; `/api/ai` returns 503 when unset |
| `DEMO_MODE` (true outside production) | enables `/api/demo` for the single-device pitch |

**Admin (`admin/.env.local`)**: `NEXT_PUBLIC_API_URL`.

---

## Security model (short version — see ARCHITECTURE.md)

- **Clients never touch the database.** Every request: verify JWT → `req.user` →
  `requireRole` → service → `withUser({userId, role})`, which opens a pooled connection,
  `BEGIN`s and `set_config('app.user_id' / 'app.role')` so **PostgreSQL row-level
  security filters every query**. The API connects as `freepay_app`
  (`NOSUPERUSER NOBYPASSRLS`), and every table has RLS **enabled and forced**.
- **Append-only ledger.** A trigger rejects any change to financial columns and any
  `DELETE`; status can only move forward. Admins annotate or flag; they cannot edit amounts.
- **Replay, tampering, device binding.** Nonce and transaction id are unique at the
  database, checked by the fraud engine and by the vendor device. Expiry is re-derived
  server-side (max 10 days from `created_at`, never past the credential); a longer window
  is `TAMPERED_EXPIRY`. Authorisations must be signed by the device named in the
  platform-signed credential, and that device must be registered to the payer.
- **Time-boxed emergency sharing.** Responders see an SOS (and its location trail) only
  while `expires_at > now()` — enforced by the RLS policy, not by the UI.

Tests: `server/__tests__/security-attacks.test.ts` plays replay, tampering, forged
certificates, device mismatch, limit evasion and token forgery; `rls.test.ts` proves the
isolation against a real database.

---

## Tests

```bash
npm test                      # mobile: crypto, QR, offline limits, i18n, notifications, ledger
npm --prefix server test      # server: 98 unit/API tests (RLS suite skips without a DB)
npm --prefix server run test:db   # RLS integration suite (needs migrated Postgres)
npm --prefix admin test       # chart math + formatters
```

---

## Status / honest limits of the POC

- Settlement is a **mock sandbox**; no payout rail is integrated.
- OTP for password reset is a fixed demo code; SMS is not wired.
- The vendor can enforce the per-payment cap and the credential's own limits offline; the
  **rolling daily cap across many stalls** is enforced on sync by the server (documented
  trade-off of any offline scheme).
- The AI assistant needs an OpenAI key; without one the app answers from a built-in FAQ.
- Crowd density is seeded/simulated; a production deployment would ingest sensor feeds.
