# Free Pay — how to present the demo

Two documents in one: a **setup checklist** you run before the room fills, and a **run
sheet** you follow in front of the client. Everything below is what actually ships in the
repo; nothing is staged or faked.

---

# Part 1 — Before the room (15 minutes ahead)

## 1.1 Start the stack

Four things run. Give each its own terminal tab so you can see if one dies.

```bash
npm run db:up
```

```bash
npm run dev
```

`npm run dev` starts the **API on :4000** and the **ops dashboard on :3001** together.

```bash
npm run demo:web
```

That builds the mobile app for the browser and serves it on **:8081**. Use this rather than
`npm run web` when presenting: `demo:web` serves a prebuilt bundle, so nothing recompiles
under you mid-sentence and a page load is a few milliseconds instead of a few seconds.
Rebuild only if you change code (`npm run web:build`).

## 1.2 Confirm it is all up

```bash
curl -s localhost:4000/health/ready && curl -s -o /dev/null -w " admin:%{http_code}" localhost:3001 && curl -s -o /dev/null -w " app:%{http_code}\n" localhost:8081
```

Expect `{"ok":true,"db":"up",...} admin:200 app:200`.

## 1.3 Fresh demo data (optional)

If you have been clicking around and want the dashboard to look like a real mela day again:

```bash
npm --prefix server run migrate:reset && npm run db:migrate
```

This reseeds 14 days of bimodal (snan / aarti) activity. It also wipes registered devices,
so **sign both phones out and in again afterwards** — the app re-registers the device key
on the next online launch.

## 1.4 The accounts

| Role | Login | Password |
| --- | --- | --- |
| Pilgrim | `9000000001` — Arjun Sharma | `free1234` |
| Vendor | `9000000002` — Shankar Chai & Snacks | `free1234` |
| Admin | `admin@freepay.demo` | `admin1234` |

The sign-in screen has one-tap **Pilgrim demo** / **Vendor demo** tiles — use those, never
type a password in front of the room.

---

# Part 2 — Choose your staging

## Option A · One screen, both phones side by side (safest)

Open **`http://localhost:3001/stage.html`**.

Two phone bezels in one window — pilgrim left, vendor right — plus presenter controls:
**Cut the network** (takes both offline at once), jump buttons for the screens you need,
**Reload both**, and a link to the ops dashboard. This is the most reliable option because
everything you touch is in one window.

## Option B · Two screens, a phone on each (most convincing)

Each window is a single iPhone-style handset, so the two roles look like two devices.

| Window | URL | Drag to |
| --- | --- | --- |
| **Pilgrim phone** | `http://localhost:3001/phone.html?role=pilgrim` | your laptop screen |
| **Vendor phone** | `http://localhost:3001/phone.html?role=vendor` | the second screen / projector |

Maximise each window; the handset sizes itself to the screen and never scales past 1:1, so
it stays pixel-crisp. Sign in **inside each phone** with the demo tiles — each frame has its
own isolated storage, so signing in on one does not sign in the other. `F11` for real full
screen, and the **Full screen** button (or `H`) hides the presenter bar for a clean shot.

The header of each window carries: the role, a **Cut the network** switch that drives *both*
phones at once, jump buttons for that role's screens, and a dot that turns green when the two
windows have found each other. `N` is the keyboard shortcut for the network switch.

**How they "scan" each other.** No camera can see the other monitor, so whichever phone is
displaying a QR hands that exact string to the other window, which treats it as a scan. The
payload is byte-for-byte what a camera would read, and every signature, expiry, limit and
fraud check runs unchanged — this replaces the lens, not the verification.

The handoff happens **browser-to-browser**, with no server in the middle. That matters: the
app also has a server-backed relay, but a forced-offline app refuses every network call, so
that one goes quiet at exactly the moment the demo needs the handoff most. The two windows
talk directly, so the pilgrim can pay the vendor with the network cut — which is the point
of the whole pitch.

Under each phone the app is served from a different origin (`localhost:8081` and
`127.0.0.1:8081`); combined with the browser's partitioning of embedded storage, the two
handsets hold genuinely separate sessions, device keys and offline ledgers.

## Option C · Two real phones

Expo Go on both, `EXPO_PUBLIC_API_URL` set to your LAN IP in `.env`, `npm run dev:mobile`,
aeroplane mode for the offline part, real cameras doing the scanning. The most honest
demo, and the most things that can go wrong in a strange venue's Wi-Fi. Use it as the
encore, not the opener.

---

# Part 3 — The run sheet

Have the **ops dashboard** (`http://localhost:3001`) open in a third window or tab —
you will jump to it twice.

## 0:00 — The problem

Start on the dashboard's **Overview** tab.

> "Kumbh 2025: 660 million visits. One stall, one chai, twenty rupees — and a UPI spinner
> that never resolves. The tower exists. The capacity does not."

Point at two cards: **Offline share** (~65%) and **Awaiting sync** — payments that have
already happened on the ground and are only waiting for a signal.

## 0:45 — A payment with no network

Now to the phones.

1. **Cut the network.**
   - *Stage:* press **Cut the network** — both phones go offline together.
   - *Two screens:* on each phone, **Profile / More → Demo mode → force offline**.

   Both phones show the offline banner. Say: *"From here on, nothing either phone does
   touches a server. Watch the top of the screen."*

2. **Vendor shows the stall code.** Vendor phone → **Dashboard → Show stall QR**.
   It is platform-signed, so the pilgrim's phone can tell a real stall from a sticker.

3. **Pilgrim scans it.** Pilgrim phone → **Scan**.
   The pay screen opens with **Shankar Chai & Snacks · Verified stall**. On two screens
   this happens by itself; with real phones, point the camera.

4. **Pilgrim pays.** Tap **₹100 → Show offline code.**
   A QR appears. Read out what is inside it: *a transaction id, a one-time nonce, the
   amount, the merchant, an expiry — signed by a key that was generated inside this phone
   and never leaves it.*

5. **Vendor verifies.** Vendor phone → **Accept**.
   The verification card appears in a moment: **Verified offline**, the amount, the payer's
   name, transaction id, nonce, expiry, the credential's expiry, the device key.

   > "Four checks just ran on this handset: the platform's signature on the pilgrim's wallet
   > credential, the pilgrim device's signature on the payment, the expiry window, and that
   > the payment names *this* stall. No server. No signal. About five milliseconds."

6. **Accept.** The vendor's device signs a receipt. Both phones now hold the same receipt
   id, marked **Pending sync**. Note the receipt travels vendor → pilgrim, so the pilgrim
   leaves with proof too.

## 2:00 — The signal comes back

Turn the network back on (**Cut the network** again, or the same Demo mode switch).

The vendor's **Sync** screen posts the queue. The server re-verifies every signature,
runs the fraud engine and answers `ACCEPT`. Status moves `PENDING_SYNC → SYNCED`.

Switch to the dashboard → **Transactions**: the payment is there, with its offline flag and
the time it actually happened — not the time it arrived.

## 2:30 — Now try to cheat

Use the built-in **Pitch demo** screen (Profile → **Pitch demo**) — it runs the whole loop
on one phone with a tamper switch and a replay button.

| Do this | It answers |
| --- | --- |
| **Replay same code** | `REJECT · DUPLICATE_NONCE, REPLAYED_TRANSACTION_ID` |
| Flip **Tamper**, then pay + verify | The vendor's phone refuses it *before* any network — `Signature invalid` |
| Pay **₹2,500** | Refused on the device: over the ₹2,000 per-payment offline limit |
| Pay **₹1,800** | Accepted, but flagged `REVIEW` — and it appears on the dashboard under **Needs review** |

> "The limits are not a UI suggestion. They are enforced on the device, and enforced again
> on the server, from the same configuration."

## 3:30 — What the control room sees

Dashboard, in this order:

- **Transactions → Needs review** — approve one. Then say: *amounts are not editable by
  anyone, including me. The ledger is append-only in the database itself, by trigger.*
- **Pending sync** — which stalls are holding value offline right now. That is where you
  send a runner with a hotspot.
- **Crowd** — click Sangam Ghat, push a 95% density reading. On the pilgrim's phone,
  **Crowd map** turns red and **Find a calmer route** walks around it.
- **Emergencies** — on the phone, hold **SOS** for two seconds. It appears here with a
  60-minute countdown. After 60 minutes the location stops being visible to responders —
  enforced by the database's row-level security policy, not by the screen.

## 4:30 — Why it holds up

- Every offline payment is a **signed, replay-proof, expiring** authorisation bound to a
  device key held in the phone's secure hardware.
- Every row is behind **PostgreSQL row-level security**. The API connects as a
  non-superuser that cannot bypass it, so a forgotten `WHERE` clause leaks nothing.
- The **fraud engine** is deterministic and unit-tested; every threshold is configuration.
- Five languages, offline crowd routing, SOS and lost-person in the same app — the reason a
  pilgrim keeps it open all day, which is the distribution advantage.

## The ask

A pilot in one mela sector: 200 stalls, 60 days, with a settlement-rail partner.

---

# Part 4 — If something goes wrong

| Symptom | Fix |
| --- | --- |
| A phone says **offline** when it should not | Tap the banner, or Profile → Demo mode and turn *force offline* off. The app treats its own API health probe as the truth, so a laptop with no internet is fine. |
| **Show stall QR** stays blank | The vendor phone is offline — the stall code is fetched online, then cached. Reconnect, open it once, and it is there for the rest of the demo. |
| The other window does not pick up a code | Both windows must be signed in, and the API must be up with `DEMO_MODE` on. Check `curl -s localhost:4000/health`. The code is republished every two seconds, so it recovers by itself once both sides are healthy. |
| Verification says **DEVICE_MISMATCH** | The device registration was wiped (usually by `migrate:reset`). Sign out and in once while online; the app re-registers the key. |
| A phone looks stuck | *Stage:* **Reload both**. Otherwise just refresh the window — the wallet, the ledger and the queue are all on the device and survive a reload. |
| Sync fails | Check the API terminal. `npm run dev` restarts both API and dashboard. Nothing is lost: unsynced payments stay queued on the vendor's phone. |

**The thing worth remembering:** if the network misbehaves during the demo, that is the
demo. Everything except sync and the initial stall code works with no server at all.

---

# Appendix — URLs and accounts

| What | Where |
| --- | --- |
| Pilgrim phone (framed) | `http://localhost:3001/phone.html?role=pilgrim` |
| Vendor phone (framed) | `http://localhost:3001/phone.html?role=vendor` |
| Both phones, one window | `http://localhost:3001/stage.html` |
| The app unframed | `http://localhost:8081` · `http://127.0.0.1:8081` |
| Ops dashboard | `http://localhost:3001` |
| API health | `http://localhost:4000/health/ready` |

Pilgrim `9000000001` · Vendor `9000000002` · both `free1234` · Admin
`admin@freepay.demo` / `admin1234` · password-reset OTP `123456`.
