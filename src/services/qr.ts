import { parseScannedPayload } from '../domain/credential';
import type { MerchantQR, ScannedPayload, SignedNgoCredit, SignedPaymentQR, SignedReceipt } from '../domain/types';

/**
 * QR encoding. Payloads travel as compact JSON. A full payment code (authorisation +
 * certificate + two signatures) is ~1.1 KB, which fits a version-25 QR at error level M
 * and scans reliably at ~260 px on a phone screen.
 */
export type QrEncodable = SignedPaymentQR | MerchantQR | SignedReceipt | SignedNgoCredit;

export function encodeQr(payload: QrEncodable): string {
  return JSON.stringify(payload);
}

export function decodeQr(raw: string): ScannedPayload {
  return parseScannedPayload(raw.trim());
}

/** Pick a QR error-correction level that keeps the symbol scannable for the payload size. */
export function qrErrorLevel(payload: string): 'L' | 'M' | 'Q' | 'H' {
  const n = payload.length;
  if (n > 1600) return 'L';
  if (n > 900) return 'M';
  if (n > 400) return 'Q';
  return 'H';
}

export function payloadSizeLabel(payload: string): string {
  const bytes = new TextEncoder().encode(payload).length;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/** Short id shown on receipts: first 8 chars of the transaction id, upper-cased. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
