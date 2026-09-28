import { generateKeyPair } from '../src/services/crypto.js';
import { getPlatformKeys } from '../src/services/platformKeys.js';
import { issuePlatformReceipt, verifyReceipt } from '../src/services/receipt.js';
import { makePaymentQR, makePilgrimDevice, makeVendorReceipt } from './helpers.js';

const now = new Date('2026-09-20T09:00:00Z');

describe('platform (online) receipts', () => {
  const base = {
    transactionId: 't-1',
    nonce: 'n-1',
    amount: 25000,
    merchantId: 'm-1',
    merchantName: 'Annapurna Thali House',
    payerId: 'p-1',
    mode: 'ONLINE' as const,
    status: 'SYNCED' as const,
    createdAt: now.toISOString(),
    syncedAt: now.toISOString(),
    now,
  };

  it('expires 15 minutes after issue by default', () => {
    const r = issuePlatformReceipt(base);
    expect(Date.parse(r.receipt.expires_at) - now.getTime()).toBe(15 * 60_000);
    expect(r.issuer).toBe('PLATFORM');
    expect(r.signer_pk).toBe(getPlatformKeys().publicKey);
  });

  it('verifies inside the window and fails after it', () => {
    const r = issuePlatformReceipt(base);
    expect(verifyReceipt(r, { now: new Date(now.getTime() + 14 * 60_000) }).ok).toBe(true);
    const late = verifyReceipt(r, { now: new Date(now.getTime() + 16 * 60_000) });
    expect(late).toEqual({ ok: false, reason: 'RECEIPT_EXPIRED', expired: true });
  });

  it('rejects a receipt whose amount was edited', () => {
    const r = issuePlatformReceipt(base);
    const forged = { ...r, receipt: { ...r.receipt, amount: 1 } };
    expect(verifyReceipt(forged, { now }).reason).toBe('INVALID_SIGNATURE');
  });

  it('rejects a "platform" receipt signed by someone else', () => {
    const rogue = generateKeyPair();
    const r = issuePlatformReceipt(base);
    const forged = { ...r, signer_pk: rogue.publicKey };
    expect(verifyReceipt(forged, { now }).reason).toBe('UNTRUSTED_SIGNER');
  });

  it('carries every field the spec requires', () => {
    const r = issuePlatformReceipt(base);
    expect(Object.keys(r.receipt)).toEqual(
      expect.arrayContaining(['amount', 'merchant_id', 'created_at', 'expires_at', 'synced_at', 'transaction_id', 'nonce']),
    );
  });
});

describe('vendor (offline) receipts', () => {
  it('verifies against the vendor device key and does not expire like online receipts', () => {
    const d = makePilgrimDevice();
    const qr = makePaymentQR(d, 8000);
    const vendorKp = generateKeyPair();
    const receipt = makeVendorReceipt(qr, vendorKp);
    expect(verifyReceipt(receipt, { trustedVendorKey: vendorKp.publicKey }).ok).toBe(true);
    // offline receipts: expires_at is the authorisation window, not a 15-minute TTL
    expect(verifyReceipt(receipt, { now: new Date(Date.now() + 60 * 60_000), trustedVendorKey: vendorKp.publicKey }).ok).toBe(true);
  });

  it('fails when verified against a different vendor key', () => {
    const d = makePilgrimDevice();
    const receipt = makeVendorReceipt(makePaymentQR(d, 8000));
    expect(verifyReceipt(receipt, { trustedVendorKey: generateKeyPair().publicKey }).reason).toBe('INVALID_SIGNATURE');
  });
});
