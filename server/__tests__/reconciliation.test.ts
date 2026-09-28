import { reconcile, type LedgerEntry } from '../src/services/reconciliation.js';

const e = (id: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  transaction_id: id,
  nonce: 'n-' + id,
  amount: 10000,
  status: 'SYNCED',
  created_at: '2026-09-20T05:00:00.000Z',
  ...over,
});

describe('reconciliation', () => {
  it('reports a healthy ledger when both sides match', () => {
    const r = reconcile([e('a'), e('b')], [e('a'), e('b')]);
    expect(r.matched).toBe(2);
    expect(r.discrepancies).toEqual([]);
    expect(r.healthy).toBe(true);
    expect(r.deviceAmount).toBe(r.serverAmount);
  });

  it('asks the device to resend transactions the server never received', () => {
    const r = reconcile([e('a'), e('b', { status: 'PENDING_SYNC' })], [e('a')]);
    expect(r.resend).toEqual(['b']);
    expect(r.discrepancies[0]).toMatchObject({ kind: 'MISSING_ON_SERVER', severity: 'INFO' });
  });

  it('treats an amount mismatch as critical (tampering)', () => {
    const r = reconcile([e('a', { amount: 99999 })], [e('a')]);
    expect(r.healthy).toBe(false);
    expect(r.discrepancies[0]).toMatchObject({ kind: 'AMOUNT_MISMATCH', severity: 'CRITICAL' });
  });

  it('pushes newer server statuses down to the device', () => {
    const r = reconcile([e('a', { status: 'SYNCED' })], [e('a', { status: 'SETTLED' })]);
    expect(r.apply).toEqual([{ transaction_id: 'a', status: 'SETTLED' }]);
    expect(r.discrepancies[0].kind).toBe('STATUS_BEHIND');
  });

  it('warns when the device claims a status the server has not reached', () => {
    const r = reconcile([e('a', { status: 'SETTLED' })], [e('a', { status: 'SYNCED' })]);
    expect(r.discrepancies[0]).toMatchObject({ kind: 'STATUS_AHEAD', severity: 'WARN' });
  });

  it('detects rows missing on the device', () => {
    const r = reconcile([], [e('z')]);
    expect(r.discrepancies[0].kind).toBe('MISSING_ON_DEVICE');
  });

  it('excludes FAILED rows from totals', () => {
    const r = reconcile([e('a'), e('b', { status: 'FAILED' })], [e('a'), e('b', { status: 'FAILED' })]);
    expect(r.deviceAmount).toBe(10000);
  });
});
