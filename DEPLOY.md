# Deploying Free Pay to Vercel

Four Vercel projects and one Neon database. The two app projects are identical builds — the
demo needs the pilgrim and the vendor on **different origins**, because browser storage is
per-origin and that is what keeps their wallets, device keys and offline ledgers separate.

| Project | Source | What it serves |
| --- | --- | --- |
| `freepay-api` | `/server` | the Express API as a serverless function |
| `freepay-admin` | `/admin` | the ops dashboard **and the phone frames** |
| `freepay-pilgrim` | repo root | the mobile app (pilgrim's origin) |
| `freepay-vendor` | repo root | the same build, vendor's origin |

Prerequisites: a Vercel account, a [Neon](https://neon.tech) project, and
`npx vercel login` done once.

---

## 1. The database

Create a Neon project and copy its **pooled** connection string (the one with `-pooler` in
the host). Pooled is right here: the API's row-level security uses `set_config(..., true)`,
which is transaction-scoped, so it survives transaction-mode pooling intact.

Run the migrations from your machine — they create the schema, the non-superuser
`freepay_app` role, the RLS policies and the demo seed. Four variables are needed, because
the runner connects as the Neon **owner** while creating a role whose password *you* choose:

| Variable | Value |
| --- | --- |
| `DATABASE_ADMIN_URL` | the Neon **owner** connection string |
| `DB_PASSWORD` | the password to give the `freepay_app` role — pick one now |
| `DB_NAME` | the Neon database name, usually `neondb` (used in `GRANT CONNECT`) |
| `DB_SSL` | `true` |

They are already in `.env.production.local`; fill the blanks, then:

```bash
npm --prefix server run migrate
```

Afterwards the API's `DATABASE_URL` connects as `freepay_app` with that password — **never**
as the Neon owner. The owner bypasses row-level security, which is the one thing this
architecture must not do. The connection string looks like:

```
postgres://freepay_app:<DB_PASSWORD>@<neon-pooler-host>/neondb?sslmode=require
```

## 2. The platform signing key

The platform's Ed25519 key signs every wallet credential. The API holds the seed; the mobile
app is built with the matching public key. **If they disagree, every payment fails
verification** — so generate once and use the same pair everywhere.

```bash
npm --prefix server run keys
```

Keep `PLATFORM_SIGNING_SEED` (secret, API only) and `EXPO_PUBLIC_PLATFORM_PUBKEY` (public,
baked into the app build).

## 3. The API

```bash
cd server && npx vercel --prod
```

Environment variables (Vercel dashboard → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the Neon **pooled** URL for the `freepay_app` role |
| `DB_SSL` | `true` |
| `DB_POOL_MAX` | `3` — small, because each function instance holds its own pool |
| `JWT_SECRET` | a long random string |
| `PLATFORM_SIGNING_SEED` | from step 2 |
| `PLATFORM_KEY_ID` | e.g. `freepay-platform-2026` |
| `CORS_ORIGINS` | the admin, pilgrim and vendor URLs, comma separated |
| `DEMO_MODE` | `true` if you want `/api/demo` in production (see the note below) |

Check it: `curl https://<api>.vercel.app/health/ready` → `{"ok":true,"db":"up"}`.

## 4. The mobile app, twice

Both projects build from the repo root; the only thing that differs is the URL they end up
on. Set these for each before building — they are **baked into the bundle at build time**:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | `https://<api>.vercel.app` |
| `EXPO_PUBLIC_PLATFORM_PUBKEY` | the public key from step 2 |
| `EXPO_PUBLIC_DEMO_RELAY` | leave empty — the phone frames hand codes over directly |

```bash
npx vercel --prod                        # -> freepay-pilgrim
npx vercel --prod --name freepay-vendor  # -> freepay-vendor (same build, second origin)
```

## 5. The dashboard and the phone frames

```bash
cd admin && npx vercel --prod
```

Set `NEXT_PUBLIC_API_URL` to the API URL.

Then point the phone frames at the two app deployments by editing
`admin/public/phone-config.json` and redeploying:

```json
{
  "pilgrim": "https://freepay-pilgrim.vercel.app",
  "vendor": "https://freepay-vendor.vercel.app"
}
```

Finally add all three front-end URLs to the API's `CORS_ORIGINS` and redeploy the API.

---

## The demo, deployed

| What | URL |
| --- | --- |
| Pilgrim phone | `https://<admin>.vercel.app/phone.html?role=pilgrim` |
| Vendor phone | `https://<admin>.vercel.app/phone.html?role=vendor` |
| Both in one window | `https://<admin>.vercel.app/stage.html` |
| Ops dashboard | `https://<admin>.vercel.app` |

The two phone windows hand QR codes to each other through a `BroadcastChannel`, which is
browser-local and needs no server — so the offline part of the demo works in production
exactly as it does locally, including with the network switch cut.

`stage.html` still points at `localhost:8081` / `127.0.0.1:8081`; edit those two `iframe`
sources if you want the one-window stage in production too.

---

## Things worth knowing before you rely on this

- **`DEMO_MODE` opens `/api/demo`**, which provisions throw-away device keys and relays QR
  payloads. It is a presentation aid, unauthenticated demo state, and has no place in a real
  deployment. Leave it off unless the deployed URL *is* the demo.
- **Serverless cold starts** add a second or so to the first request after a quiet period.
  For a live pitch, load the dashboard a minute before you start.
- **Settlement is still the mock sandbox.** Deploying does not make it move money.
- **The seeded demo data is dated.** It generates 14 days ending on the day you run the
  migration, so "today" looks empty if you seed and demo on different days — re-run the
  migration the morning of a demo.
- **No custom domain is configured.** Everything above uses `*.vercel.app`.
- **The SSH tunnel is loaded on demand.** `ssh2` ships a `pagent.exe` and CommonJS
  `__dirname` lookups that crash a bundled ESM function at startup, so `db.ts` and
  `migrate.ts` only `import('./tunnel.js')` when `SSH_TUNNEL_ENABLED=true`. The tunnel is a
  local-development aid and is never used on Vercel.

## What has actually been verified

The serverless entry was bundled with esbuild (the same `.js`-specifier-to-`.ts` resolution
Vercel uses) and run against the local database: `/health` 200, `/health/ready` reporting the
database up, an unauthenticated request correctly refused with 401, and a real login issuing
a JWT. So the function itself is sound. What remains untested until a first deploy is
Vercel's own build pipeline and the Neon connection.
