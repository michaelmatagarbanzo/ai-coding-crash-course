// ─── Earnings ───
// The platform keeps a fixed share of every sale. Amounts are integer cents.

export const PLATFORM_FEE_RATE = 0.2;

export type Earnings = { gross: number; platformFee: number; net: number };

/**
 * Splits a gross total into the platform's fee and the instructor's net.
 * Apply to a summed total, not per purchase, so rounding happens once.
 */
export function splitEarnings(grossCents: number): Earnings {
  const platformFee = Math.round(grossCents * PLATFORM_FEE_RATE);
  return { gross: grossCents, platformFee, net: grossCents - platformFee };
}
