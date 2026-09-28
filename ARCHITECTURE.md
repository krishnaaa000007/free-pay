# Free Pay — Architecture

## 1. System overview

```mermaid
flowchart LR
  subgraph Devices["At the mela (weak / no connectivity)"]
    P["Pilgrim app<br/>Expo · SQLite ledger · Ed25519 device key"]
    V["Vendor app<br/>Expo · SQLite ledger · Ed25519 device key"]
    P -- "signed payment QR" --> V
    V -- "signed receipt QR (optional)" --> P
  end

  subgraph Cloud["Free Pay platform"]
    API["Express API<br/>JWT · zod · rate limit · fraud engine"]
    PG[("PostgreSQL<br/>row-level security<br/>append-only ledger")]
    KMS["Platform signing key<br/>(Ed25519 seed)"]
    API --> PG
    API --> KMS
  end

  ADMIN["Ops dashboard<br/>Next.js 14 · SVG charts"]
  OAI["OpenAI (optional)"]

  V -- "AutoSync: POST /transactions/sync" --> API
  P -- "credential refresh · online pay · status pull" --> API
  ADMIN -- "Bearer JWT (ADMIN)" --> API
  API -- "proxy /api/ai" --> OAI
```

Three apps, one contract: the **protocol types** (`server/src/services/types.ts` and
`src/domain/types.ts`) and the **canonical JSON** signing rule are identical on both
sides; a fixture in each test-suite pins the byte-level encoding.

## 2. The offline payment loop

```mermaid
sequenceDiagram
  autonumber
  participant Pl as Pilgrim phone
  participant Vn as Vendor phone
  participant API as Free Pay API
  participant DB as PostgreSQL (RLS)

  Note over Pl,API: Once, while online
  Pl->>API: POST /auth/device {device_id, ed25519 pubkey}
  API-->>Pl: wallet certificate (platform-signed, ≤10 days, limits)

  Note over Pl,Vn: At the stall, no network
  Pl->>Pl: build PaymentAuthorization {txn_id, nonce, amount, merchant, created_at, expires_at}
  Pl->>Pl: sign with device key → QR = {auth, auth_sig, cert}
  Pl->>Vn: show QR
  Vn->>Vn: verify cert (platform pk) · verify auth (cert.pk) · expiry · staleness · merchant · limits · local nonce
  Vn->>Vn: sign receipt with vendor device key · SQLite PENDING_SYNC · remember nonce
  Vn-->>Pl: receipt QR (optional)

  Note over Vn,DB: Later, signal returns
  Vn->>API: POST /transactions/sync [{payload, receipt, accepted_at}]
  API->>API: re-verify signatures · fraud engine
  API->>DB: withUser(VENDOR) → INSERT transactions (SYNCED) or rejected_transactions
  API-->>Vn: per-item {status, decision, flags}
  Vn->>Vn: PENDING_SYNC → SYNCED / FAILED

  Note over Vn,DB: Settlement
  Vn->>API: POST /settlement/request
  API->>DB: SYNCED → SETTLED (sandbox provider ref)
```

### What each side can and cannot verify

| Check | Vendor device (offline) | Server (on sync) |
| --- | --- | --- |
| Platform signature on credential | ✅ | ✅ |
| Device signature on authorisation | ✅ | ✅ |
| Certificate/authorisation expiry, ≤10-day staleness, tampered window | ✅ | ✅ (server clock is the backstop) |
| Merchant matches the scanning stall | ✅ | ✅ (`MERCHANT_MISMATCH`) |
| Per-payment cap and the credential's own limits | ✅ | ✅ |
| Rolling daily cap across **all** stalls | ❌ (cannot know other stalls) | ✅ (`EXCEEDS_DAILY_LIMIT`) |
| Replay of the same code at **this** stall | ✅ (local nonce table) | ✅ |
| Replay at a **different** stall | ❌ | ✅ (global nonce/txn-id uniqueness) |
| Device registered to the payer | ❌ | ✅ (soft flag `DEVICE_MISMATCH`) |
| Unknown merchant, velocity, review threshold | ❌ | ✅ |

## 3. Transaction lifecycle

```mermaid
stateDiagram-v2
  [*] --> PENDING_SYNC: vendor accepts offline (SQLite)
  PENDING_SYNC --> SYNCED: sync · fraud ACCEPT / REVIEW
  PENDING_SYNC --> FAILED: sync · fraud REJECT (kept in rejected_transactions)
  SYNCED --> SETTLED: settlement batch COMPLETED
  SYNCED --> FAILED: review rejected by ops
  SETTLED --> [*]
  FAILED --> [*]
  note right of SYNCED
    Online payments enter directly as SYNCED
    with a 15-minute platform-signed receipt
  end note
```

The database trigger `transactions_append_only_guard` enforces this: financial columns
are immutable, `SETTLED`/`FAILED` are terminal, `DELETE` always raises `42501`.

## 4. Backend layering

```mermaid
flowchart TB
  IDX["index.ts (bootstrap, graceful shutdown)"] --> APP["app.ts (helmet · cors · json · requestLogger · /health · /health/ready)"]
  APP --> MW["middleware.ts<br/>authMiddleware → req.user · requireRole · validate(zod) · errorHandler"]
  APP --> RL["rateLimit.ts (sliding window)"]
  MW --> R["routes/<br/>auth · merchants · transactions · settlement · crowd · emergency · admin · ngos · ai · demo"]
  R --> S["services/<br/>credentials · fraud · transactions · receipt · reconciliation · crowd · ngoTrust · ngoQr · settlement/"]
  S --> DB["db.ts<br/>withUser({userId, role}) → BEGIN · set_config(app.user_id, app.role) · … · COMMIT"]
  DB --> T["tunnel.ts (optional ssh2)"]
  T --> PG[("PostgreSQL as freepay_app<br/>NOSUPERUSER NOBYPASSRLS · RLS forced")]
```

### Fraud engine

`services/fraud.ts` is pure: the caller collects facts (nonce seen? txn id seen? merchant
known? device registered? payer's rolling-day offline total? recent count?) through
`SECURITY DEFINER` helper functions that return only booleans/aggregates, then
`evaluateTransaction(input, ctx, config)` returns `{decision, flags, suspicious}`.

| Severity | Flags | Effect |
| --- | --- | --- |
| HARD | `NON_POSITIVE_AMOUNT` `DUPLICATE_NONCE` `REPLAYED_TRANSACTION_ID` `EXPIRED_AUTHORIZATION` `STALE_OFFLINE_AUTHORIZATION` `TAMPERED_EXPIRY` `FUTURE_DATED` `EXCEEDS_SINGLE_TXN_LIMIT` `EXCEEDS_DAILY_LIMIT` `MERCHANT_MISMATCH` `INVALID_SIGNATURE` `INVALID_CERTIFICATE` `CERT_EXPIRED` … | **REJECT** — recorded in `rejected_transactions`, never in the ledger |
| SOFT | `UNKNOWN_MERCHANT` `DEVICE_MISMATCH` `VENDOR_DEVICE_UNREGISTERED` | accepted, `suspicious = true`, decision REVIEW |
| REVIEW | `ABOVE_REVIEW_THRESHOLD` (₹1,500) `HIGH_VELOCITY` | accepted, queued for ops |

All thresholds come from `FRAUD_*` env; the 10-day maximum age is a hard ceiling that
the env can lower but never raise.

## 5. Data isolation with row-level security

```mermaid
flowchart LR
  REQ["HTTP request<br/>Authorization: Bearer JWT"] --> A["authMiddleware<br/>verify → req.user {userId, role}"]
  A --> RR["requireRole('VENDOR')"]
  RR --> W["withUser({userId, role})"]
  W --> C["pooled connection<br/>BEGIN<br/>set_config('app.user_id', uid, true)<br/>set_config('app.role', role, true)"]
  C --> Q["service SQL<br/>SELECT * FROM transactions …"]
  Q --> POL["RLS policy<br/>payer_id = app_user_id()<br/>OR app_owns_merchant(merchant_id)<br/>OR app_is_admin()"]
  POL --> ROWS["only the caller's rows"]
```

Key policies (`migrations/003_rls.sql`):

| Table | Pilgrim | Vendor | Admin | System (auth service only) |
| --- | --- | --- | --- | --- |
| `users` | own row | own row | all | lookup by phone, insert on register |
| `transactions` | own payments | own stall's | all (no financial edits) | — |
| `rejected_transactions` | — | own stall's | all | — |
| `settlements` | — | own stall's | all | — |
| `emergencies` | own | own | **only while `expires_at > now()`** | — |
| `crowd_zones`, `lost_persons`, `merchants` (directory), `ngos` | read | read | read/write | — |
| `audit_log` | append | append | read | append |

Cross-tenant facts the fraud engine needs are exposed through `SECURITY DEFINER`
functions (`app_nonce_exists`, `app_txn_exists`, `app_device_belongs_to`,
`app_payer_offline_total`, …) so a vendor can ask *"has this nonce been seen anywhere?"*
without being able to read anyone else's rows. `rls.test.ts` proves each of these rules
against a live database, including that the app role is not a superuser and every table
has RLS forced.

## 6. Mobile app structure

```mermaid
flowchart TB
  subgraph Providers["app/_layout.tsx"]
    SA["SafeAreaProvider"] --> QC["QueryClientProvider"] --> I18["I18nProvider (en/hi/mr/gu/ta)"] --> AU["AuthProvider<br/>JWT · profile · ledger · wallet credential"] --> NET["NetworkProvider<br/>NetInfo + API reachability + demo forceOffline"]
  end
  NET --> NAV["expo-router Stack<br/>(auth) · (pilgrim) tabs · (vendor) tabs · shared screens"]
  NET --> OB["OfflineBanner"]
  NET --> TO["NotificationToaster"]
  NET --> AS["AutoSyncManager<br/>reconnect · foreground · heartbeat · backoff"]

  subgraph Services["src/services"]
    PAY["payment.ts<br/>createOfflinePayment · verifyForVendor · acceptOfflinePayment · payOnline"]
    LED["ledger.ts<br/>expo-sqlite (memory on web/Jest)"]
    SY["sync.ts<br/>push queue · pull statuses · reconcile"]
    CR["crypto.ts<br/>device key in SecureStore · PRNG"]
    QR["qr.ts"]
  end
  subgraph Domain["src/domain (pure, unit-tested)"]
    CRED["credential.ts<br/>build/verify QR · receipts · NGO credits"]
    LIM["limits.ts"]
    CRY["crypto.ts (canonical JSON · ed25519)"]
    RT["routing.ts (offline Dijkstra)"]
  end
  PAY --> CRED
  PAY --> LIM
  CRED --> CRY
  PAY --> LED
  SY --> LED
```

Design language: parchment surfaces, saffron as the single brand accent, kumkum red for
danger, tulsi green for success; serif display type for headings, system sans for body;
a floating tab bar with a raised saffron hero action (Scan / Accept).

## 7. Ops dashboard

`/admin` is a client-rendered Next.js app. `lib/useApi` polls the admin endpoints
(`/api/admin/overview`, `/analytics`, `/analytics/trends`, and per-tab lists) with a Bearer
JWT from `POST /api/auth/admin/login`. Charts are hand-built SVG (`components/charts`)
following a validated categorical palette (colour-vision-safe adjacent pairs, ≥3:1
contrast with direct labels where a hue is lighter), thin marks, hover tooltips and
legends for every multi-series chart. The chart geometry lives in `chartMath.ts` and is
unit-tested.

## 8. Extra capabilities

- **Crowd** — zones with capacity, density readings, a zone graph; `suggestRoute` runs
  Dijkstra with a congestion penalty and hard-avoids `CRITICAL` zones when any alternative
  exists. The same algorithm ships in the app for offline use on the cached graph.
- **Emergency** — `POST /emergency/sos` stores the SOS with `expires_at = now + 60 min`;
  the location trail (`emergency_locations`) is readable by responders only inside that
  window (RLS). The app queues an SOS offline, speaks reassurance in the user's language,
  and always shows the configurable contact numbers.
- **Lost person** — reports are visible to every authenticated user so volunteers can act;
  ops can mark found.
- **NGO trust + signed credits** — a transparent additive score (verification, tenure,
  redemption rate, volume, complaints); verified NGOs issue platform-signed meal/relief
  credits that vendors verify offline and the server redeems atomically.
- **AI assistant** — `POST /api/ai` proxies OpenAI with a Free Pay system prompt; the app
  falls back to a multilingual built-in FAQ offline or when no key is configured.

## 9. Configuration surface

All product rules are environment variables with identical defaults on both ends
(see README). Ports: API 4000, admin 3001, Metro 8081. PostgreSQL is reached directly or
through the optional SSH tunnel (`SSH_TUNNEL_ENABLED=true`).
