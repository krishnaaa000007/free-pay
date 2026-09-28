import { config } from '../config.js';
import { signObject, verifyObject } from './crypto.js';
import { getPlatformKeys } from './platformKeys.js';
import type { Receipt, SignedReceipt, TxnMode, TxnStatus } from './types.js';

/**
 * Receipts. Two flavours:
 *  - OFFLINE receipts are signed by the VENDOR DEVICE the moment it accepts a payment and
 *    are shown/printed without any connectivity. They are re-verified on sync.
 *  - ONLINE receipts are signed by the PLATFORM and act as merchant-verification tokens;
 *    they expire after ONLINE_RECEIPT_TTL_MIN (15 min by default).
 */
export interface IssueReceiptInput {
  transactionId: string;
  nonce: string;
  amount: number;
  merchantId: string;
  merchantName: string;
  payerId: string;
  mode: TxnMode;
  status: TxnStatus;
  createdAt: string;
  expiresAt?: string;
  syncedAt: string | null;
  now?: Date;
}

export function issuePlatformReceipt(input: IssueReceiptInput): SignedReceipt {
  const now = input.now ?? new Date();
  const keys = getPlatformKeys();
  const receipt: Receipt = {
    v: 1,
    type: 'RECEIPT',
    transaction_id: input.transactionId,
    nonce: input.nonce,
    amount: input.amount,
    currency: 'INR',
    merchant_id: input.merchantId,
    merchant_name: input.merchantName,
    payer_id: input.payerId,
    mode: input.mode,
    status: input.status,
    created_at: input.createdAt,
    expires_at: input.expiresAt ?? new Date(now.getTime() + config.onlineReceiptTtlMs).toISOString(),
    synced_at: input.syncedAt,
    issued_at: now.toISOString(),
  };
  return {
    v: 1,
    t: 'FREEPAY_RECEIPT',
    receipt,
    sig: signObject(receipt, keys.secretKey),
    signer_pk: keys.publicKey,
    issuer: 'PLATFORM',
  };
}

export interface ReceiptVerification {
  ok: boolean;
  reason?: string;
  expired?: boolean;
}

/**
 * Verify a receipt. For platform receipts the signer must be the platform key. For vendor
 * receipts the caller passes the vendor device public key it trusts (looked up on sync).
 */
export function verifyReceipt(
  signed: SignedReceipt,
  opts: { now?: Date; trustedVendorKey?: string; platformPublicKey?: string } = {},
): ReceiptVerification {
  if (!signed || signed.v !== 1 || signed.t !== 'FREEPAY_RECEIPT' || !signed.receipt) {
    return { ok: false, reason: 'MALFORMED_RECEIPT' };
  }
  const now = opts.now ?? new Date();
  const expectedKey =
    signed.issuer === 'PLATFORM' ? opts.platformPublicKey ?? getPlatformKeys().publicKey : opts.trustedVendorKey ?? signed.signer_pk;

  if (signed.issuer === 'PLATFORM' && signed.signer_pk !== expectedKey) {
    return { ok: false, reason: 'UNTRUSTED_SIGNER' };
  }
  if (!verifyObject(signed.receipt, signed.sig, expectedKey)) {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
  const expires = Date.parse(signed.receipt.expires_at);
  if (signed.receipt.mode === 'ONLINE' && !Number.isNaN(expires) && expires <= now.getTime()) {
    return { ok: false, reason: 'RECEIPT_EXPIRED', expired: true };
  }
  return { ok: true };
}
