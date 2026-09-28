/**
 * NGO trust scoring. Transparent, additive formula so an NGO can see exactly why it
 * scores what it scores. Mirrored in SQL inside 004_seed.sql for the seeded rows.
 *
 *   verified registration      35 (else 10)
 *   tenure                     up to 25  (2 / year)
 *   redemption rate            up to 20  (credits actually reaching beneficiaries)
 *   disbursement volume        up to 15  (INR 30 lakh saturates)
 *   complaints                 -4 each, capped at -30
 */
export interface NgoFacts {
  verified: boolean;
  tenure_years: number;
  credits_issued: number;
  credits_redeemed: number;
  disbursed_total: number; // paise
  complaints: number;
}

export interface TrustBreakdown {
  score: number;
  tier: 'PLATINUM' | 'GOLD' | 'SILVER' | 'WATCH';
  components: Array<{ key: string; label: string; points: number; max: number }>;
}

export function trustScore(f: NgoFacts): TrustBreakdown {
  const verification = f.verified ? 35 : 10;
  const tenure = Math.min(25, f.tenure_years * 2);
  const redemption = Math.min(20, (f.credits_redeemed / Math.max(1, f.credits_issued)) * 20);
  const volume = Math.min(15, (f.disbursed_total / 100 / 3_000_000) * 15);
  const complaints = -Math.min(30, f.complaints * 4);

  const raw = verification + tenure + redemption + volume + complaints;
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 100) / 100;

  return {
    score,
    tier: score >= 85 ? 'PLATINUM' : score >= 70 ? 'GOLD' : score >= 50 ? 'SILVER' : 'WATCH',
    components: [
      { key: 'verification', label: 'Verified registration', points: verification, max: 35 },
      { key: 'tenure', label: 'Years active', points: round(tenure), max: 25 },
      { key: 'redemption', label: 'Credit redemption rate', points: round(redemption), max: 20 },
      { key: 'volume', label: 'Disbursement volume', points: round(volume), max: 15 },
      { key: 'complaints', label: 'Complaints', points: complaints, max: 0 },
    ],
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
