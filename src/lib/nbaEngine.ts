import { differenceInDays, parseISO } from 'date-fns';
import type { Client } from '@/types';
import { calculateHouseholdEngagementScore } from './householdIntelligence';

// ─── Public Types ─────────────────────────────────────────────────────────────

export type NBAActionCategory =
  | 'Contact'
  | 'Portfolio'
  | 'Goals'
  | 'Household'
  | 'Estate'
  | 'Compliance';

export type NBAUrgencyLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface NBAScoreBreakdownFactor {
  /** Display label for the signal category */
  name: string;
  /** Actual points earned (0 … maxScore) */
  score: number;
  /** Maximum possible points for this signal */
  maxScore: number;
  /** Human-readable explanation of this factor's score */
  description: string;
  /** Tailwind bg-* color class for the filled portion of the bar */
  color: string;
}

export interface NBAScore {
  /** 0–100: lower means the client needs more attention */
  totalScore: number;
  /** One-sentence recommended advisor action */
  primaryAction: string;
  actionCategory: NBAActionCategory;
  urgencyLevel: NBAUrgencyLevel;
  /** 2-3 word reason shown on the card, e.g. "83 days silent" */
  reasonSummary: string;
  /** All five signal contributions for the breakdown bar */
  scoreBreakdown: NBAScoreBreakdownFactor[];
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Multi-breakpoint linear interpolation.
 * `points` is an array of [x, y] pairs sorted ascending by x.
 * Returns y clamped to the endpoints when x is out of range.
 */
function lerp(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

function firstName(name: string): string {
  return name.split(' ')[0];
}

// ─── Signal Max Weights (must sum to 100) ────────────────────────────────────

const MAX_CONTACT = 25;
const MAX_PORTFOLIO = 20;
const MAX_GOALS = 20;
const MAX_HOUSEHOLD = 20;
const MAX_LIFE_EVENT = 15;
// Total: 100 ✓

// ─── Main Engine ─────────────────────────────────────────────────────────────

export function calculateNBAScore(client: Client): NBAScore {
  const now = new Date();
  const fn = firstName(client.name);

  // ── Signal 1: Contact (25 pts max) ────────────────────────────────────────
  // 0d → 25pts, 30d → 20pts, 60d → 12pts, 90d+ → 0pts (linear interpolation)
  const daysSinceContact = differenceInDays(now, parseISO(client.lastContact));
  const contactScore = Math.round(
    lerp(daysSinceContact, [
      [0, 25],
      [30, 20],
      [60, 12],
      [90, 0],
    ])
  );

  const contactDescription =
    daysSinceContact === 0
      ? 'Contacted today'
      : daysSinceContact <= 7
      ? `Last contact ${daysSinceContact}d ago`
      : `${daysSinceContact} days since last contact`;

  // ── Signal 2: Portfolio (20 pts max) ──────────────────────────────────────
  // Max drift 0% → 20pts, 5% → 15pts, 10% → 8pts, 15%+ → 0pts
  const maxDrift =
    client.allocation.length > 0
      ? Math.max(...client.allocation.map((a) => Math.abs(a.current - a.target)))
      : 0;
  const portfolioScore = Math.round(
    lerp(maxDrift, [
      [0, 20],
      [5, 15],
      [10, 8],
      [15, 0],
    ])
  );

  const portfolioDescription =
    maxDrift === 0
      ? 'Portfolio balanced'
      : `Max drift ${maxDrift.toFixed(1)}% from target`;

  // ── Signal 3: Goals (20 pts max) ──────────────────────────────────────────
  // All on track → 20pts, none on track → 0pts, proportional
  const totalGoals = client.goals.length;
  const onTrackGoals = client.goals.filter((g) => g.onTrack).length;
  const goalsScore =
    totalGoals === 0 ? MAX_GOALS : Math.round((onTrackGoals / totalGoals) * MAX_GOALS);

  const goalsDescription =
    totalGoals === 0
      ? 'No goals recorded'
      : onTrackGoals === totalGoals
      ? 'All goals on track'
      : `${onTrackGoals}/${totalGoals} goals on track`;

  // ── Signal 4: Household Intelligence (20 pts max) ─────────────────────────
  // Household engagement score 0-100 mapped proportionally to 0-20 pts
  const householdEngagement = calculateHouseholdEngagementScore(client);
  const householdScore = Math.round((householdEngagement / 100) * MAX_HOUSEHOLD);

  const householdDescription =
    householdEngagement >= 75
      ? 'Household well engaged'
      : householdEngagement >= 50
      ? `Household score ${householdEngagement}/100`
      : `Low household engagement (${householdEngagement}/100)`;

  // ── Signal 5: Life Events (15 pts max) ────────────────────────────────────
  // Within 90d → 0pts, 90-180d → 8pts, none or >180d → 15pts
  const pastLifeEvents = client.lifeEvents
    .map((le) => ({ ...le, daysAgo: differenceInDays(now, parseISO(le.date)) }))
    .filter((le) => le.daysAgo >= 0)
    .sort((a, b) => a.daysAgo - b.daysAgo);

  const mostRecentEvent = pastLifeEvents[0];
  let lifeEventScore: number;
  let lifeEventDescription: string;

  if (!mostRecentEvent || mostRecentEvent.daysAgo > 180) {
    lifeEventScore = MAX_LIFE_EVENT;
    lifeEventDescription = 'No recent life events';
  } else if (mostRecentEvent.daysAgo <= 90) {
    lifeEventScore = 0;
    const shortDesc = mostRecentEvent.description.length > 35
      ? mostRecentEvent.description.slice(0, 35) + '…'
      : mostRecentEvent.description;
    lifeEventDescription = `${mostRecentEvent.daysAgo}d ago: ${shortDesc}`;
  } else {
    // 90–180 days
    lifeEventScore = 8;
    lifeEventDescription = `Life event ${mostRecentEvent.daysAgo}d ago`;
  }

  // ── Total Score ───────────────────────────────────────────────────────────
  const totalScore =
    contactScore + portfolioScore + goalsScore + householdScore + lifeEventScore;

  // ── Urgency Level ─────────────────────────────────────────────────────────
  let urgencyLevel: NBAUrgencyLevel;
  if (totalScore < 30) urgencyLevel = 'Critical';
  else if (totalScore < 55) urgencyLevel = 'High';
  else if (totalScore < 75) urgencyLevel = 'Medium';
  else urgencyLevel = 'Low';

  // ── Weakest Signal → Primary Action ──────────────────────────────────────
  // "Lowest score contribution relative to its maximum" = lowest score/max ratio.
  const signals = [
    { key: 'contact',    ratio: contactScore / MAX_CONTACT,        score: contactScore },
    { key: 'portfolio',  ratio: portfolioScore / MAX_PORTFOLIO,    score: portfolioScore },
    { key: 'goals',      ratio: goalsScore / MAX_GOALS,            score: goalsScore },
    { key: 'household',  ratio: householdScore / MAX_HOUSEHOLD,    score: householdScore },
    { key: 'lifeEvent',  ratio: lifeEventScore / MAX_LIFE_EVENT,   score: lifeEventScore },
  ];

  const weakest = signals.reduce(
    (min, s) => (s.ratio < min.ratio ? s : min),
    signals[0]
  );

  let primaryAction: string;
  let actionCategory: NBAActionCategory;
  let reasonSummary: string;

  switch (weakest.key) {
    case 'contact':
      primaryAction = `Schedule a call with ${fn}`;
      actionCategory = 'Contact';
      reasonSummary =
        daysSinceContact >= 90
          ? `${daysSinceContact} days silent`
          : daysSinceContact >= 30
          ? `${daysSinceContact} days no contact`
          : `Last contact ${daysSinceContact}d ago`;
      break;

    case 'portfolio':
      primaryAction = `Review portfolio rebalancing with ${fn}`;
      actionCategory = 'Portfolio';
      reasonSummary = `Portfolio drifted ${maxDrift.toFixed(0)}%`;
      break;

    case 'goals':
      primaryAction = `Revisit goal progress with ${fn}`;
      actionCategory = 'Goals';
      reasonSummary =
        totalGoals === 0
          ? 'No goals recorded'
          : `${onTrackGoals}/${totalGoals} goals on track`;
      break;

    case 'household':
      primaryAction = `Schedule household meeting for ${fn}'s family`;
      actionCategory = 'Household';
      reasonSummary = `Household score ${householdEngagement}`;
      break;

    case 'lifeEvent':
      primaryAction = `Follow up on recent life event with ${fn}`;
      actionCategory = 'Contact';
      reasonSummary = mostRecentEvent
        ? `Life event ${mostRecentEvent.daysAgo}d ago`
        : 'Life event flagged';
      break;

    default:
      primaryAction = `Review ${fn}'s financial plan`;
      actionCategory = 'Goals';
      reasonSummary = 'Needs attention';
  }

  // ── Score Breakdown ───────────────────────────────────────────────────────
  const scoreBreakdown: NBAScoreBreakdownFactor[] = [
    {
      name: 'Contact',
      score: contactScore,
      maxScore: MAX_CONTACT,
      description: contactDescription,
      color: 'bg-blue-400',
    },
    {
      name: 'Portfolio',
      score: portfolioScore,
      maxScore: MAX_PORTFOLIO,
      description: portfolioDescription,
      color: 'bg-emerald-400',
    },
    {
      name: 'Goals',
      score: goalsScore,
      maxScore: MAX_GOALS,
      description: goalsDescription,
      color: 'bg-amber-400',
    },
    {
      name: 'Household',
      score: householdScore,
      maxScore: MAX_HOUSEHOLD,
      description: householdDescription,
      color: 'bg-violet-400',
    },
    {
      name: 'Life Events',
      score: lifeEventScore,
      maxScore: MAX_LIFE_EVENT,
      description: lifeEventDescription,
      color: 'bg-pink-400',
    },
  ];

  return {
    totalScore,
    primaryAction,
    actionCategory,
    urgencyLevel,
    reasonSummary,
    scoreBreakdown,
  };
}
