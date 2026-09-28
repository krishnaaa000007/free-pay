import { createHash } from 'node:crypto';
import type { PayoutRequest, PayoutResult, SettlementProvider } from './types.js';

/**
 * MockSandboxSettlementProvider
 * -----------------------------
 * NEVER MOVES REAL MONEY. It produces deterministic provider references (so retries are
 * idempotent) and simulates the two failure modes a real rail exhibits so the rest of
 * the pipeline is exercised: a hard failure for an invalid destination, and a
 * "PROCESSING" state for very large payouts that a bank would hold for review.
 */
export class MockSandboxSettlementProvider implements SettlementProvider {
  readonly name = 'MOCK_SANDBOX';

  constructor(private readonly opts: { holdAbovePaise?: number; now?: () => Date } = {}) {}

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const now = (this.opts.now ?? (() => new Date()))();
    const ref = 'SBX-' + createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 12).toUpperCase();

    if (req.amount <= 0) {
      return { provider: this.name, providerRef: ref, status: 'FAILED', processedAt: now.toISOString(), failureReason: 'NOTHING_TO_SETTLE', sandbox: true };
    }
    if (!req.destinationMasked) {
      return { provider: this.name, providerRef: ref, status: 'FAILED', processedAt: now.toISOString(), failureReason: 'NO_SETTLEMENT_ACCOUNT', sandbox: true };
    }
    const hold = this.opts.holdAbovePaise ?? 50_000_00; // INR 50,000
    if (req.amount > hold) {
      return { provider: this.name, providerRef: ref, status: 'PROCESSING', processedAt: now.toISOString(), sandbox: true };
    }
    return { provider: this.name, providerRef: ref, status: 'COMPLETED', processedAt: now.toISOString(), sandbox: true };
  }
}
