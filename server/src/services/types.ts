/**
 * Protocol + domain types shared (by contract) with the mobile app.
 * All amounts are integer PAISE. All timestamps are ISO-8601 strings in UTC.
 *
 * The mobile app keeps an identical copy in `src/domain/types.ts`; the canonical
 * JSON serialisation used for signing is tested against fixtures in both packages.
 */

export type Role = 'PILGRIM' | 'VENDOR' | 'ADMIN';
export type TxnStatus = 'PENDING_SYNC' | 'SYNCED' | 'SETTLED' | 'FAILED';
export type TxnMode = 'OFFLINE' | 'ONLINE' | 'NGO_CREDIT';

export interface AuthUser {
  userId: string;
  role: Role;
  name?: string;
}

/* ------------------------------------------------------------------ */
/* Wallet certificate: issued by the PLATFORM to a pilgrim device.     */
/* Binds user -> device -> device public key with limits and expiry.   */
/* ------------------------------------------------------------------ */
export interface WalletCertificate {
  v: 1;
  kid: string;
  sub: string;
  role: 'PILGRIM';
  name: string;
  device_id: string;
  pk: string;
  issued_at: string;
  expires_at: string;
  limits: { per_txn: number; daily: number };
}

export interface SignedWalletCertificate {
  cert: WalletCertificate;
  sig: string;
}

/* ------------------------------------------------------------------ */
/* Payment authorisation: signed by the PILGRIM DEVICE for one payment */
/* ------------------------------------------------------------------ */
export interface PaymentAuthorization {
  v: 1;
  type: 'OFFLINE_PAYMENT';
  transaction_id: string;
  nonce: string;
  amount: number;
  currency: 'INR';
  merchant_id: string;
  payer_id: string;
  device_id: string;
  created_at: string;
  expires_at: string;
  memo?: string;
}

/** The full QR payload a pilgrim shows to a vendor. */
export interface SignedPaymentQR {
  v: 1;
  t: 'FREEPAY_PAY';
  auth: PaymentAuthorization;
  auth_sig: string;
  cert: SignedWalletCertificate;
}

/* ------------------------------------------------------------------ */
/* Merchant QR: platform-signed static code printed at the stall.      */
/* ------------------------------------------------------------------ */
export interface MerchantQR {
  v: 1;
  t: 'FREEPAY_MERCHANT';
  merchant_id: string;
  name: string;
  category: string;
  zone?: string;
  pk?: string;
  sig: string;
}

/* ------------------------------------------------------------------ */
/* Receipt: signed by the accepting vendor device (offline) or by the  */
/* platform (online). Online receipts expire after 15 minutes.         */
/* ------------------------------------------------------------------ */
export interface Receipt {
  v: 1;
  type: 'RECEIPT';
  transaction_id: string;
  nonce: string;
  amount: number;
  currency: 'INR';
  merchant_id: string;
  merchant_name: string;
  payer_id: string;
  mode: TxnMode;
  status: TxnStatus;
  created_at: string;
  expires_at: string;
  synced_at: string | null;
  issued_at: string;
}

export interface SignedReceipt {
  v: 1;
  t: 'FREEPAY_RECEIPT';
  receipt: Receipt;
  sig: string;
  signer_pk: string;
  issuer: 'VENDOR_DEVICE' | 'PLATFORM';
}

/* ------------------------------------------------------------------ */
/* NGO credit: platform/NGO-signed voucher redeemable at vendors.      */
/* ------------------------------------------------------------------ */
export interface NgoCredit {
  v: 1;
  type: 'NGO_CREDIT';
  credit_id: string;
  nonce: string;
  ngo_id: string;
  ngo_name: string;
  amount: number;
  currency: 'INR';
  beneficiary_hint?: string;
  purpose: string;
  issued_at: string;
  expires_at: string;
}

export interface SignedNgoCredit {
  v: 1;
  t: 'FREEPAY_NGO_CREDIT';
  credit: NgoCredit;
  sig: string;
  kid: string;
}

/* ------------------------------------------------------------------ */
/* Sync protocol                                                        */
/* ------------------------------------------------------------------ */
export interface SyncItem {
  payload: SignedPaymentQR;
  receipt: SignedReceipt;
  accepted_at: string;
  vendor_device_id: string;
}

export interface SyncResult {
  transaction_id: string;
  status: TxnStatus;
  decision: 'ACCEPT' | 'REJECT' | 'REVIEW' | 'DUPLICATE';
  flags: string[];
  message?: string;
  synced_at?: string;
}

/* ------------------------------------------------------------------ */
/* Fraud engine                                                         */
/* ------------------------------------------------------------------ */
export type FraudSeverity = 'HARD' | 'SOFT' | 'REVIEW';

export interface FraudFlag {
  code: string;
  severity: FraudSeverity;
  message: string;
}

export interface FraudVerdict {
  decision: 'ACCEPT' | 'REJECT' | 'REVIEW';
  flags: FraudFlag[];
  suspicious: boolean;
}

/* ------------------------------------------------------------------ */
/* DB row shapes (subset)                                              */
/* ------------------------------------------------------------------ */
export interface TransactionRow {
  id: string;
  nonce: string;
  payer_id: string | null;
  merchant_id: string;
  vendor_device_id: string | null;
  payer_device_id: string | null;
  amount: number;
  currency: string;
  mode: TxnMode;
  status: TxnStatus;
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  synced_at: string | null;
  settled_at: string | null;
  fraud_decision: string | null;
  fraud_flags: string[];
  suspicious: boolean;
  memo: string | null;
  settlement_id: string | null;
}
