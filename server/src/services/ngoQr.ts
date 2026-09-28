import { randomUUID } from 'node:crypto';
import { randomNonce, signObject, verifyObject } from './crypto.js';
import { getPlatformKeys } from './platformKeys.js';
import type { NgoCredit, SignedNgoCredit } from './types.js';

/**
 * NGO-issued signed QR credits. An NGO (through an admin) issues a voucher, e.g. "one
 * meal, INR 60", which a beneficiary shows at any participating stall. The vendor verifies
 * the platform signature offline and the credit is redeemed atomically on sync.
 */
export interface IssueCreditInput {
  ngoId: string;
  ngoName: string;
  amount: number;
  purpose: string;
  beneficiaryHint?: string;
  ttlMs: number;
  now?: Date;
}

export function issueNgoCredit(input: IssueCreditInput): SignedNgoCredit {
  const now = input.now ?? new Date();
  const keys = getPlatformKeys();
  const credit: NgoCredit = {
    v: 1,
    type: 'NGO_CREDIT',
    credit_id: randomUUID(),
    nonce: randomNonce(16),
    ngo_id: input.ngoId,
    ngo_name: input.ngoName,
    amount: input.amount,
    currency: 'INR',
    purpose: input.purpose,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + input.ttlMs).toISOString(),
    ...(input.beneficiaryHint ? { beneficiary_hint: input.beneficiaryHint } : {}),
  };
  return { v: 1, t: 'FREEPAY_NGO_CREDIT', credit, sig: signObject(credit, keys.secretKey), kid: keys.kid };
}

export function verifyNgoCredit(
  signed: SignedNgoCredit,
  opts: { now?: Date; platformPublicKey?: string } = {},
): { ok: boolean; reason?: string } {
  if (!signed || signed.v !== 1 || signed.t !== 'FREEPAY_NGO_CREDIT' || !signed.credit) {
    return { ok: false, reason: 'MALFORMED_CREDIT' };
  }
  const pk = opts.platformPublicKey ?? getPlatformKeys().publicKey;
  if (!verifyObject(signed.credit, signed.sig, pk)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  const now = (opts.now ?? new Date()).getTime();
  if (Date.parse(signed.credit.expires_at) <= now) return { ok: false, reason: 'CREDIT_EXPIRED' };
  if (!Number.isInteger(signed.credit.amount) || signed.credit.amount <= 0) return { ok: false, reason: 'NON_POSITIVE_AMOUNT' };
  return { ok: true };
}
