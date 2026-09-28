/**
 * End-to-end smoke test against a running API + database:
 *   login -> demo session -> sign offline payment on "pilgrim" key -> vendor receipt ->
 *   sync as vendor -> expect SYNCED -> replay -> expect REJECT -> settlement -> admin overview.
 *
 *   npx tsx scripts/smoke-e2e.ts [http://localhost:4000]
 */
import { buildSignedPaymentQR } from '../src/services/credentials.js';
import { generateKeyPair, signObject } from '../src/services/crypto.js';
import type { Receipt, SignedPaymentQR, SignedReceipt, SignedWalletCertificate } from '../src/services/types.js';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const log = (step: string, detail: unknown) => console.log(`\n▸ ${step}\n  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return json;
}

function vendorReceipt(qr: SignedPaymentQR, vendorSk: string, vendorPk: string, merchantName: string): SignedReceipt {
  const receipt: Receipt = {
    v: 1,
    type: 'RECEIPT',
    transaction_id: qr.auth.transaction_id,
    nonce: qr.auth.nonce,
    amount: qr.auth.amount,
    currency: 'INR',
    merchant_id: qr.auth.merchant_id,
    merchant_name: merchantName,
    payer_id: qr.auth.payer_id,
    mode: 'OFFLINE',
    status: 'PENDING_SYNC',
    created_at: qr.auth.created_at,
    expires_at: qr.auth.expires_at,
    synced_at: null,
    issued_at: new Date().toISOString(),
  };
  return { v: 1, t: 'FREEPAY_RECEIPT', receipt, sig: signObject(receipt, vendorSk), signer_pk: vendorPk, issuer: 'VENDOR_DEVICE' };
}

async function main() {
  const health = await call<{ ok: boolean; db: string }>('/health/ready');
  log('health/ready', health);

  const pilgrimLogin = await call<{ token: string; user: { name: string } }>('/api/auth/login', { method: 'POST', body: { phone: '9000000001', password: 'free1234' } });
  log('pilgrim login', pilgrimLogin.user.name);

  const pilgrimKp = generateKeyPair();
  const vendorKp = generateKeyPair();
  const session = await call<{
    pilgrim: { name: string; device_id: string; credential: SignedWalletCertificate };
    vendor: { token: string; device_id: string; merchant: { id: string; name: string } };
  }>('/api/demo/session', { method: 'POST', token: pilgrimLogin.token, body: { device_id: 'smoke-' + Date.now(), pilgrim_public_key: pilgrimKp.publicKey, vendor_public_key: vendorKp.publicKey } });
  log('demo session', { pilgrim: session.pilgrim.name, merchant: session.vendor.merchant.name, credExpires: session.pilgrim.credential.cert.expires_at });

  const qr = buildSignedPaymentQR({ cert: session.pilgrim.credential, deviceSecretKey: pilgrimKp.secretKey, merchantId: session.vendor.merchant.id, amountPaise: 12000, memo: 'smoke chai' });
  const receipt = vendorReceipt(qr, vendorKp.secretKey, vendorKp.publicKey, session.vendor.merchant.name);
  const item = { payload: qr, receipt, accepted_at: new Date().toISOString(), vendor_device_id: session.vendor.device_id };
  log('signed offline payment', { txn: qr.auth.transaction_id, nonce: qr.auth.nonce, amount: qr.auth.amount, bytes: JSON.stringify(qr).length });

  const sync1 = await call<{ summary: unknown; results: Array<{ status: string; decision: string; flags: string[] }> }>('/api/transactions/sync', { method: 'POST', token: session.vendor.token, body: { device_id: session.vendor.device_id, items: [item], pending_after_sync: { count: 0, amount: 0 } } });
  log('sync #1 (expect SYNCED/ACCEPT)', sync1.results[0]);
  if (sync1.results[0].status !== 'SYNCED') throw new Error('first sync did not produce SYNCED');

  const sync2 = await call<{ results: Array<{ status: string; decision: string; flags: string[] }> }>('/api/transactions/sync', { method: 'POST', token: session.vendor.token, body: { device_id: session.vendor.device_id, items: [item], pending_after_sync: { count: 0, amount: 0 } } });
  log('sync #2 same item (expect DUPLICATE, idempotent)', sync2.results[0]);

  const forged = { ...qr, auth: { ...qr.auth, amount: 1 } };
  const sync3 = await call<{ results: Array<{ status: string; decision: string; flags: string[] }> }>('/api/transactions/sync', { method: 'POST', token: session.vendor.token, body: { device_id: session.vendor.device_id, items: [{ ...item, payload: forged, receipt: vendorReceipt(forged, vendorKp.secretKey, vendorKp.publicKey, 'x') }], pending_after_sync: { count: 0, amount: 0 } } });
  log('sync #3 tampered amount (expect REJECT)', sync3.results[0]);
  if (sync3.results[0].decision !== 'REJECT') throw new Error('tampered payment was not rejected');

  const big = buildSignedPaymentQR({ cert: session.pilgrim.credential, deviceSecretKey: pilgrimKp.secretKey, merchantId: session.vendor.merchant.id, amountPaise: 180000 });
  const sync4 = await call<{ results: Array<{ status: string; decision: string; flags: string[] }> }>('/api/transactions/sync', { method: 'POST', token: session.vendor.token, body: { device_id: session.vendor.device_id, items: [{ payload: big, receipt: vendorReceipt(big, vendorKp.secretKey, vendorKp.publicKey, session.vendor.merchant.name), accepted_at: new Date().toISOString(), vendor_device_id: session.vendor.device_id }], pending_after_sync: { count: 0, amount: 0 } } });
  log('sync #4 INR 1800 (expect REVIEW)', sync4.results[0]);

  const over = buildSignedPaymentQR({ cert: session.pilgrim.credential, deviceSecretKey: pilgrimKp.secretKey, merchantId: session.vendor.merchant.id, amountPaise: 250000 });
  const sync5 = await call<{ results: Array<{ status: string; decision: string; flags: string[] }> }>('/api/transactions/sync', { method: 'POST', token: session.vendor.token, body: { device_id: session.vendor.device_id, items: [{ payload: over, receipt: vendorReceipt(over, vendorKp.secretKey, vendorKp.publicKey, session.vendor.merchant.name), accepted_at: new Date().toISOString(), vendor_device_id: session.vendor.device_id }], pending_after_sync: { count: 0, amount: 0 } } });
  log('sync #5 INR 2500 (expect REJECT EXCEEDS_SINGLE_TXN_LIMIT)', sync5.results[0]);

  const summary = await call<{ available: { amount: number; count: number } }>('/api/settlement/summary', { token: session.vendor.token });
  log('vendor settlement summary', summary.available);
  const settled = await call<{ settlement: { status: string; amount: number; provider_ref: string }; provider: { sandbox: boolean } }>('/api/settlement/request', { method: 'POST', token: session.vendor.token, body: {} });
  log('settlement request (sandbox)', settled.settlement);

  const pilgrimTxns = await call<{ transactions: Array<{ id: string; status: string; amount: number }> }>('/api/transactions?limit=3', { token: pilgrimLogin.token });
  log('pilgrim sees only own rows (RLS)', pilgrimTxns.transactions.map((t) => `${t.id.slice(0, 8)} ${t.status} ${t.amount}`));

  const admin = await call<{ token: string }>('/api/auth/admin/login', { method: 'POST', body: { email: 'admin@freepay.demo', password: 'admin1234' } });
  const overview = await call<{ metrics: Array<{ key: string; value: number }> }>('/api/admin/overview', { token: admin.token });
  log('admin overview', Object.fromEntries(overview.metrics.map((m) => [m.key, m.value])));
  const crowd = await call<{ summary: unknown }>('/api/crowd/zones', { token: admin.token });
  log('crowd summary', crowd.summary);
  const route = await call<{ eta_min: number; distance_m: number; path: Array<{ name: string }>; avoided: unknown[] }>('/api/crowd/route?from=44444444-4444-4444-8444-000000000005&to=44444444-4444-4444-8444-000000000001', { token: admin.token });
  log('route Main Gate -> Sangam Ghat', { eta: route.eta_min, distance: route.distance_m, via: route.path.map((z) => z.name).join(' → '), avoided: route.avoided });
  const ai = await fetch(BASE + '/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pilgrimLogin.token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  log('AI proxy without key', `${ai.status} (expect 503)`);

  console.log('\n✔ smoke test passed');
}

main().catch((err) => {
  console.error('\n✘ smoke test failed:', (err as Error).message);
  process.exit(1);
});
