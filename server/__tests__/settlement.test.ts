import { MockSandboxSettlementProvider } from '../src/services/settlement/provider.js';
import type { PayoutRequest } from '../src/services/settlement/types.js';

const req = (over: Partial<PayoutRequest> = {}): PayoutRequest => ({
  settlementId: 'set-1',
  merchantId: 'm-1',
  merchantName: 'Shankar Chai & Snacks',
  destinationMasked: 'SBIN••••4821',
  amount: 184000,
  txnCount: 12,
  currency: 'INR',
  idempotencyKey: 'set-1',
  ...over,
});

describe('MockSandboxSettlementProvider', () => {
  const provider = new MockSandboxSettlementProvider({ now: () => new Date('2026-09-20T12:00:00Z') });

  it('completes a normal payout and is explicitly marked sandbox', async () => {
    const r = await provider.initiatePayout(req());
    expect(r).toMatchObject({ provider: 'MOCK_SANDBOX', status: 'COMPLETED', sandbox: true, processedAt: '2026-09-20T12:00:00.000Z' });
    expect(r.providerRef).toMatch(/^SBX-[0-9A-F]{12}$/);
  });

  it('is idempotent: the same key yields the same reference', async () => {
    const a = await provider.initiatePayout(req());
    const b = await provider.initiatePayout(req());
    expect(a.providerRef).toBe(b.providerRef);
    const c = await provider.initiatePayout(req({ idempotencyKey: 'other' }));
    expect(c.providerRef).not.toBe(a.providerRef);
  });

  it('fails when the merchant has no settlement account', async () => {
    const r = await provider.initiatePayout(req({ destinationMasked: null }));
    expect(r).toMatchObject({ status: 'FAILED', failureReason: 'NO_SETTLEMENT_ACCOUNT' });
  });

  it('fails for a zero amount', async () => {
    const r = await provider.initiatePayout(req({ amount: 0 }));
    expect(r).toMatchObject({ status: 'FAILED', failureReason: 'NOTHING_TO_SETTLE' });
  });

  it('holds very large payouts in PROCESSING', async () => {
    const r = await provider.initiatePayout(req({ amount: 75_000_00 }));
    expect(r.status).toBe('PROCESSING');
  });

  it('never references a real payment rail', async () => {
    const r = await provider.initiatePayout(req());
    expect(JSON.stringify(r)).not.toMatch(/npci|upi|imps|neft|rtgs/i);
  });
});
