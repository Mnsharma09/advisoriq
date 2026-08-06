// ─── Retirement Projection Utility ───────────────────────────────────────────
// All calculations are deterministic and produce the same output for the same
// inputs — suitable for real-time recalculation on slider changes.

export interface ProjectionInputs {
  currentAge: number;
  retirementAge: number;
  currentSavings: number;
  monthlyContribution: number;
  desiredMonthlyRetirementIncome: number;
  /** Override base-case return (e.g. from scenario slider). Defaults to 0.07. */
  baseReturn?: number;
}

export interface ProjectionDataPoint {
  age: number;
  conservative: number;
  baseCase: number;
  optimistic: number;
}

export interface ScenarioSummary {
  conservative: { value: number; meetsTarget: boolean };
  baseCase: { value: number; meetsTarget: boolean };
  optimistic: { value: number; meetsTarget: boolean };
  target: number;
}

const CONSERVATIVE_RATE = 0.05;
const BASE_RATE = 0.07;
const OPTIMISTIC_RATE = 0.09;

/**
 * Returns one data point per year from currentAge to 90.
 * Pre-retirement: compound growth + monthly contributions.
 * Post-retirement: compound growth + monthly withdrawals (value can go negative).
 */
export function calculateProjections(inputs: ProjectionInputs): ProjectionDataPoint[] {
  const {
    currentAge,
    retirementAge,
    currentSavings,
    monthlyContribution,
    desiredMonthlyRetirementIncome,
    baseReturn = BASE_RATE,
  } = inputs;

  const yearlyContribution = monthlyContribution * 12;
  const yearlyWithdrawal = desiredMonthlyRetirementIncome * 12;

  const rates = {
    conservative: CONSERVATIVE_RATE,
    baseCase: baseReturn,
    optimistic: OPTIMISTIC_RATE,
  };

  let cons = currentSavings;
  let base = currentSavings;
  let opt = currentSavings;

  const data: ProjectionDataPoint[] = [];

  for (let age = currentAge; age <= 90; age++) {
    data.push({
      age,
      conservative: Math.max(0, Math.round(cons)),
      baseCase: Math.max(0, Math.round(base)),
      optimistic: Math.max(0, Math.round(opt)),
    });

    if (age < retirementAge) {
      // Accumulation phase
      cons = cons * (1 + rates.conservative) + yearlyContribution;
      base = base * (1 + rates.baseCase) + yearlyContribution;
      opt = opt * (1 + rates.optimistic) + yearlyContribution;
    } else {
      // Distribution phase — withdraw annually
      cons = cons * (1 + rates.conservative) - yearlyWithdrawal;
      base = base * (1 + rates.baseCase) - yearlyWithdrawal;
      opt = opt * (1 + rates.optimistic) - yearlyWithdrawal;
    }
  }

  return data;
}

/**
 * 4% rule: monthly income needed × 300 = required portfolio at retirement.
 */
export function getRetirementTarget(desiredMonthlyRetirementIncome: number): number {
  return desiredMonthlyRetirementIncome * 300;
}

/**
 * Extract the projected values at a specific age from the data array.
 */
export function getValuesAtAge(
  data: ProjectionDataPoint[],
  age: number
): { conservative: number; baseCase: number; optimistic: number } {
  const point = data.find((d) => d.age === age) ?? data[data.length - 1];
  return {
    conservative: point.conservative,
    baseCase: point.baseCase,
    optimistic: point.optimistic,
  };
}

/**
 * Full scenario summary at the retirement age.
 */
export function getScenarioSummary(inputs: ProjectionInputs): ScenarioSummary {
  const data = calculateProjections(inputs);
  const target = getRetirementTarget(inputs.desiredMonthlyRetirementIncome);
  const atRetirement = getValuesAtAge(data, inputs.retirementAge);
  return {
    conservative: { value: atRetirement.conservative, meetsTarget: atRetirement.conservative >= target },
    baseCase: { value: atRetirement.baseCase, meetsTarget: atRetirement.baseCase >= target },
    optimistic: { value: atRetirement.optimistic, meetsTarget: atRetirement.optimistic >= target },
    target,
  };
}

/** Format a dollar value compactly: $1.2M, $850K, etc.
 *  Negative values render as -$180K (not $-180K). */
export function fmtDollars(value: number): string {
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
