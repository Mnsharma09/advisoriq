// ─── Rebalancing Utility ──────────────────────────────────────────────────────
// Deterministic, pure calculations — no side effects.

import type { AllocationItem } from '../types';

export type RebalanceStrategy = 'full' | 'threshold' | 'tax-aware';

export interface RebalanceTrade {
  assetClass: string;
  currentPct: number;
  targetPct: number;
  drift: number;           // current - target (positive = overweight)
  dollarAmount: number;    // positive = buy, negative = sell
  action: 'Buy' | 'Sell' | 'Hold';
}

export interface RebalancePlan {
  strategy: RebalanceStrategy;
  trades: RebalanceTrade[];
  totalBuys: number;
  totalSells: number;
  /** True if any trade has |drift| > 0 after strategy filtering */
  hasChanges: boolean;
  /** Estimated round-trip cost at 0.1% of traded value */
  estimatedCost: number;
}

/**
 * Given the client's current allocation and portfolio value, produce a list of
 * trades needed to move back to target under the chosen strategy.
 *
 * - full:       rebalance every asset back to exact target
 * - threshold:  only rebalance assets drifted beyond `thresholdPct` (default 5%)
 * - tax-aware:  like threshold but suppresses sells; only buys (directs new cash)
 */
export function calculateRebalancePlan(
  allocation: AllocationItem[],
  portfolioValue: number,
  strategy: RebalanceStrategy,
  thresholdPct = 5,
): RebalancePlan {
  const trades: RebalanceTrade[] = allocation.map((a) => {
    const drift = a.current - a.target;
    const dollarFull = -drift * portfolioValue / 100; // negative drift → buy

    let action: 'Buy' | 'Sell' | 'Hold' = 'Hold';
    let dollarAmount = 0;

    if (strategy === 'full') {
      if (Math.abs(drift) > 0.01) {
        action = dollarFull > 0 ? 'Buy' : 'Sell';
        dollarAmount = dollarFull;
      }
    } else if (strategy === 'threshold') {
      if (Math.abs(drift) >= thresholdPct) {
        action = dollarFull > 0 ? 'Buy' : 'Sell';
        dollarAmount = dollarFull;
      }
    } else if (strategy === 'tax-aware') {
      // Only buy (redirect contributions); never force taxable sells
      if (drift <= -thresholdPct) {
        // underweight — buy
        action = 'Buy';
        dollarAmount = dollarFull; // positive
      }
      // overweight assets: hold, let growth/contributions correct over time
    }

    return {
      assetClass: a.assetClass,
      currentPct: a.current,
      targetPct: a.target,
      drift,
      dollarAmount: Math.round(dollarAmount),
      action,
    };
  });

  const totalBuys = trades.filter((t) => t.action === 'Buy').reduce((s, t) => s + t.dollarAmount, 0);
  const totalSells = trades.filter((t) => t.action === 'Sell').reduce((s, t) => s + Math.abs(t.dollarAmount), 0);
  const tradedVolume = totalBuys + totalSells;
  const estimatedCost = Math.round(tradedVolume * 0.001);

  return {
    strategy,
    trades,
    totalBuys,
    totalSells,
    hasChanges: trades.some((t) => t.action !== 'Hold'),
    estimatedCost,
  };
}

/** Short human-readable label for each strategy */
export const STRATEGY_LABELS: Record<RebalanceStrategy, string> = {
  full: 'Full Rebalance',
  threshold: 'Threshold (±5%)',
  'tax-aware': 'Tax-Aware (Buys Only)',
};

export const STRATEGY_DESCRIPTIONS: Record<RebalanceStrategy, string> = {
  full: 'Rebalance all assets back to exact target allocations.',
  threshold: 'Only trade assets that have drifted more than 5% from target.',
  'tax-aware': 'Avoid taxable sell events — direct new contributions to underweight assets only.',
};
