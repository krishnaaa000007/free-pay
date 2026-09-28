/**
 * Protocol + domain types. Mirrors server/src/services/types.ts field-for-field:
 * amounts are integer PAISE, timestamps are ISO-8601 UTC strings.
 */
export type Role = 'PILGRIM' | 'VENDOR' | 'ADMIN';
export type TxnStatus = 'PENDING_SYNC' | 'SYNCED' | 'SETTLED' | 'FAILED';
export type TxnMode = 'OFFLINE' | 'ONLINE' | 'NGO_CREDIT';
export type Language = 'en' | 'hi' | 'mr' | 'gu' | 'ta';

export interface User {
  id: string;
  phone: string;
  email?: string | null;
  name: string;
  role: Role;
  language: string;
  avatar_seed: number;
  created_at: string;
}

export interface Merchant {
  id: string;
  code: string;
  name: string;
  category: string;
  zone_id?: string | null;
  zone_name?: string | null;
  zone_code?: string | null;
  is_verified: boolean;
  settlement_account?: string | null;
}

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

export interface SignedPaymentQR {
  v: 1;
  t: 'FREEPAY_PAY';
  auth: PaymentAuthorization;
  auth_sig: string;
  cert: SignedWalletCertificate;
}

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

export type ScannedPayload =
  | { kind: 'PAYMENT'; data: SignedPaymentQR }
  | { kind: 'MERCHANT'; data: MerchantQR }
  | { kind: 'RECEIPT'; data: SignedReceipt }
  | { kind: 'NGO_CREDIT'; data: SignedNgoCredit }
  | { kind: 'UNKNOWN'; raw: string };

/** A row in the local SQLite ledger (both pilgrim and vendor sides). */
export interface LedgerTransaction {
  id: string;
  nonce: string;
  direction: 'IN' | 'OUT';
  amount: number;
  currency: 'INR';
  mode: TxnMode;
  status: TxnStatus;
  merchant_id: string;
  merchant_name: string;
  payer_id: string | null;
  payer_name: string | null;
  device_id: string;
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  synced_at: string | null;
  settled_at: string | null;
  memo: string | null;
  payload_json: string | null;
  receipt_json: string | null;
  sync_attempts: number;
  last_error: string | null;
  fraud_flags: string[];
}

export interface SyncResult {
  transaction_id: string;
  status: TxnStatus;
  decision: 'ACCEPT' | 'REJECT' | 'REVIEW' | 'DUPLICATE';
  flags: string[];
  message?: string;
  synced_at?: string;
}

export interface ServerTransaction {
  id: string;
  nonce: string;
  payer_id: string | null;
  payer_name?: string | null;
  merchant_id: string;
  merchant_name: string;
  merchant_category?: string;
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

export interface CrowdZone {
  id: string;
  code: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  radius_m: number;
  capacity: number;
  map_x: number;
  map_y: number;
  density: number;
  head_count: number;
  recorded_at: string | null;
  trend?: 'RISING' | 'FALLING' | 'STEADY';
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface CrowdEdge {
  from_zone: string;
  to_zone: string;
  distance_m: number;
}

export interface EmergencyContact {
  label: string;
  number: string;
}
