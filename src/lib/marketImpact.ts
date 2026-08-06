// ─── Market Impact on Goals Utility ──────────────────────────────────────────
// Models how three market scenarios affect each client goal's projected outcome.

import type { Goal } from '../types';
import { differenceInMonths, parseISO } from 'date-fns';

export type MarketScenario = 'bear' | 'base' | 'bull';

export interface ScenarioConfig {
  label: string;
  description: string;
  /** One-time immediate shock applied to currentAmount (e.g. -0.20) */
  portfolioShock: number;
  /** Annual return applied to shocked balance over remaining months */
  annualReturn: number;
  color: string;
  badgeClass: string;
}

export const SCENARIO_CONFIGS: Record<MarketScenario, ScenarioConfig> = {
  bear: {
    label: 'Bear Market',
    description: '−20% portfolio shock + 4% annual return going forward',
    portfolioShock: -0.20,
    annualReturn: 0.04,
    color: '#ef4444',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  base: {
    label: 'Base Case',
    description: 'No shock · 7% annual return',
    portfolioShock: 0,
    annualReturn: 0.07,
    color: '#3b82f6',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  bull: {
    label: 'Bull Market',
    description: '+15% portfolio lift + 10% annual return going forward',
    portfolioShock: 0.15,
    annualReturn: 0.10,
    color: '#10b981',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};

export interface GoalImpact {
  goalId: string;
  goalName: string;
  targetAmount: number;
  targetDate: string;
  monthlyContribution: number;
  /** Projected value in the base case */
  baseProjected: number;
  /** Projected value under this scenario */
  scenarioProjected: number;
  /** scenarioProjected - baseProjected */
  delta: number;
  wasOnTrack: boolean;
  isOnTrack: boolean;
  /** True if the scenario flips the on-track status */
  statusChanged: boolean;
}

/**
 * Project a goal's value at its target date given:
 *   startAmount — balance after any immediate shock
 *   monthlyContrib — regular contribution (unchanged by scenario)
 *   annualReturn — ongoing growth rate
 *   months — months remaining to target date
 */
function projectGoal(
  startAmount: number,
  monthlyContrib: number,
  annualReturn: number,
  months: number,
): number {
  if (months <= 0) return startAmount;
  const monthlyRate = annualReturn / 12;
  // FV of lump sum + FV of annuity
  const fvLump = startAmount * Math.pow(1 + monthlyRate, months);
  const fvAnnuity =
    monthlyRate > 0
      ? monthlyContrib * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
      : monthlyContrib * months;
  return Math.round(fvLump + fvAnnuity);
}

/**
 * Returns one GoalImpact per goal for the requested scenario.
 * Base-case values are always recalculated here so the delta is correct
 * regardless of the goal's stored onTrack flag.
 */
export function calculateMarketImpact(
  goals: Goal[],
  scenario: MarketScenario,
): GoalImpact[] {
  const today = new Date();
  const scenarioCfg = SCENARIO_CONFIGS[scenario];
  const baseCfg = SCENARIO_CONFIGS['base'];

  return goals.map((goal) => {
    const months = Math.max(0, differenceInMonths(parseISO(goal.targetDate), today));

    const baseProjected = projectGoal(
      goal.currentAmount,
      goal.monthlyContribution,
      baseCfg.annualReturn,
      months,
    );

    const shockedAmount = Math.round(goal.currentAmount * (1 + scenarioCfg.portfolioShock));
    const scenarioProjected = projectGoal(
      shockedAmount,
      goal.monthlyContribution,
      scenarioCfg.annualReturn,
      months,
    );

    const wasOnTrack = baseProjected >= goal.targetAmount;
    const isOnTrack = scenarioProjected >= goal.targetAmount;

    return {
      goalId: goal.id,
      goalName: goal.name,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate,
      monthlyContribution: goal.monthlyContribution,
      baseProjected,
      scenarioProjected,
      delta: scenarioProjected - baseProjected,
      wasOnTrack,
      isOnTrack,
      statusChanged: wasOnTrack !== isOnTrack,
    };
  });
}

/** Compact dollar formatter for impact values */
export function fmtImpact(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '−';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
