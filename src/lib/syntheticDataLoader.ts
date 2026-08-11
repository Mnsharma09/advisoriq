/**
 * syntheticDataLoader.ts
 *
 * Two loading strategies — chosen by the presence of VITE_API_URL:
 *
 *   API mode  (VITE_API_URL set)   → GET /api/v1/clients  (pre-joined by Postgres)
 *   JSON mode (no VITE_API_URL)    → fetch 5 JSON files from /public/data/ and join in JS
 *
 * Both paths produce an identical Client[] shape so the rest of the app
 * has no awareness of which mode is active.
 */

import { format, parseISO, subDays, subYears } from 'date-fns';
import { DEMO_ANCHOR_DATE } from './signalThresholds';
import type {
  Client,
  RiskProfile,
  GoalType,
  AllocationItem,
  Goal,
  EstatePlan,
  Interaction,
  InteractionType,
  ActionItem,
  FamilyMember,
  LifeEvent,
  ProductHolding,
  ReferralRecord,
} from '@/types';

// ─── Env ──────────────────────────────────────────────────────────────────────

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

// ─── Upcoming Meeting Seed ────────────────────────────────────────────────────
// Static realistic meeting schedule spread across the next 4 weeks.
// Relative to the demo baseline date of 2026-08-12.

import type { UpcomingMeeting } from '@/types';

const MEETING_SEED: Record<string, UpcomingMeeting[]> = {
  C0001: [{ id: 'um-C0001-1', date: '2026-08-14', time: '10:00 AM', purpose: 'Annual Review' }],
  C0002: [{ id: 'um-C0002-1', date: '2026-08-19', time: '2:00 PM',  purpose: 'Portfolio Review' }],
  C0004: [{ id: 'um-C0004-1', date: '2026-08-13', time: '9:30 AM',  purpose: 'Tax Planning' }],
  C0005: [{ id: 'um-C0005-1', date: '2026-08-21', time: '11:00 AM', purpose: 'Goal Check-In' }],
  C0007: [{ id: 'um-C0007-1', date: '2026-08-15', time: '3:00 PM',  purpose: 'Estate Planning Review' }],
  C0008: [
    { id: 'um-C0008-1', date: '2026-08-13', time: '2:30 PM',  purpose: 'Quarterly Check-In' },
    { id: 'um-C0008-2', date: '2026-09-03', time: '10:00 AM', purpose: 'Annual Review' },
  ],
  C0010: [{ id: 'um-C0010-1', date: '2026-08-18', time: '9:00 AM',  purpose: 'Portfolio Review' }],
  C0012: [{ id: 'um-C0012-1', date: '2026-08-26', time: '1:30 PM',  purpose: 'Insurance Review' }],
  C0014: [{ id: 'um-C0014-1', date: '2026-08-20', time: '10:30 AM', purpose: 'Retirement Planning' }],
  C0016: [{ id: 'um-C0016-1', date: '2026-09-09', time: '2:00 PM',  purpose: 'Annual Review' }],
  C0018: [{ id: 'um-C0018-1', date: '2026-08-25', time: '11:30 AM', purpose: 'Goal Check-In' }],
  C0019: [{ id: 'um-C0019-1', date: '2026-08-14', time: '4:00 PM',  purpose: 'Education Funding Review' }],
  C0021: [{ id: 'um-C0021-1', date: '2026-08-27', time: '9:30 AM',  purpose: 'Portfolio Review' }],
  C0023: [{ id: 'um-C0023-1', date: '2026-09-02', time: '3:30 PM',  purpose: 'Tax Planning' }],
  C0025: [{ id: 'um-C0025-1', date: '2026-08-19', time: '9:00 AM',  purpose: 'Annual Review' }],
  C0027: [
    { id: 'um-C0027-1', date: '2026-08-13', time: '1:00 PM',  purpose: 'Estate Planning Review' },
    { id: 'um-C0027-2', date: '2026-08-20', time: '11:00 AM', purpose: 'Portfolio Review' },
  ],
  C0028: [{ id: 'um-C0028-1', date: '2026-08-18', time: '3:00 PM',  purpose: 'Quarterly Check-In' }],
  C0030: [{ id: 'um-C0030-1', date: '2026-09-08', time: '10:00 AM', purpose: 'Retirement Planning' }],
};

// ─── Shared mapping helpers ───────────────────────────────────────────────────

function mapRiskTolerance(raw: string): RiskProfile {
  switch (raw?.toLowerCase()) {
    case 'conservative':
    case 'income':
      return 'Conservative';
    case 'moderate':
    case 'balanced':
      return 'Moderate';
    case 'growth':
    case 'aggressive':
      return 'Aggressive';
    default:
      return 'Moderate';
  }
}

function mapGoalType(raw: string): GoalType {
  switch (raw?.toLowerCase()) {
    case 'retirement income': return 'Retirement Income';
    case 'business exit':     return 'Business Exit';
    case 'education funding': return 'Education';
    case 'estate / legacy':   return 'Estate';
    case 'charitable giving': return 'Charitable Giving';
    case 'property purchase': return 'Property Purchase';
    case 'emergency fund':    return 'Emergency Fund';
    case 'income protection': return 'Income Protection';
    default:                  return 'Retirement';
  }
}

function mapEmployment(lifeStage: string): string {
  switch (lifeStage) {
    case 'Accumulation':  return 'Professional';
    case 'Pre-retirement':return 'Senior Professional';
    case 'Retirement':    return 'Retired';
    default:              return 'Professional';
  }
}

function buildEstatePlan(complete: boolean): EstatePlan {
  if (complete) {
    return {
      documents: [
        { document: 'Will',                 status: 'In Place' },
        { document: 'Revocable Trust',      status: 'In Place' },
        { document: 'Healthcare Directive', status: 'In Place' },
        { document: 'Power of Attorney',    status: 'In Place' },
        { document: 'HIPAA Authorization',  status: 'In Place' },
      ],
    };
  }
  return {
    documents: [
      { document: 'Will',                 status: 'Needs Update' },
      { document: 'Revocable Trust',      status: 'Needs Update' },
      { document: 'Healthcare Directive', status: 'Missing' },
      { document: 'Power of Attorney',    status: 'In Place' },
      { document: 'HIPAA Authorization',  status: 'Missing' },
    ],
  };
}

function buildAllocation(
  targetEquity: number, targetBonds: number, targetCash: number,
  actualEquity: number, actualBonds: number, actualCash: number,
): AllocationItem[] {
  return [
    { assetClass: 'Equity', target: Math.round(targetEquity * 100), current: Math.round(actualEquity * 100) },
    { assetClass: 'Bonds',  target: Math.round(targetBonds  * 100), current: Math.round(actualBonds  * 100) },
    { assetClass: 'Cash',   target: Math.round(targetCash   * 100), current: Math.round(actualCash   * 100) },
  ];
}

function generateClientSince(tenureYears: number): string {
  return format(subYears(new Date(), Math.round(tenureYears)), 'yyyy-MM-dd');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODE A — API
// ═══════════════════════════════════════════════════════════════════════════════

/** Shape returned by GET /api/v1/clients */
interface ApiClientRow {
  client_id:                    string;
  advisor_id:                   string;
  full_name:                    string;
  first_name?:                  string;
  age?:                         number;
  life_stage?:                  string;
  aum?:                         number;
  tenure_years?:                number;
  risk_tolerance?:              string;
  estate_docs_complete?:        boolean;
  insurance_adequate?:          boolean;
  segment_tag?:                 string;
  city?:                        string;
  household_id?:                string;
  // signals
  days_since_last_contact?:     number;
  nba_scenario_id?:             string | null;   // raw "S001"–"S005" from DB
  nba_scenario_flag?:           boolean;          // computed by API: nba_scenario_id IS NOT NULL
  nba_expected_rank?:           number;
  open_commitment_count?:       number;
  product_gap_count?:           number;
  // contact log
  last_contact_date?:           string;
  total_interactions_18m?:      number;
  open_overdue_commitments?:    number;
  avg_sentiment_score?:         number;
  contacts_last_30_days?:       number;
  contacts_last_60_days?:       number;
  contacts_last_90_days?:       number;
  // portfolio snapshot
  snapshot_date?:               string;
  snapshot_aum?:                number;
  target_allocation_equity?:    number;
  target_allocation_bonds?:     number;
  target_allocation_cash?:      number;
  actual_allocation_equity?:    number;
  actual_allocation_bonds?:     number;
  actual_allocation_cash?:      number;
  drift_pct?:                   number;
  ytd_return?:                  number;
  benchmark_return?:            number;
  // goal
  primary_goal_id?:             string;
  primary_goal_type?:           string;
  primary_goal_target_amount?:  number;
  primary_goal_progress_pct?:   number;
  primary_goal_target_date?:    string;
  primary_goal_on_track?:       boolean;
  // scores
  nba_score?:                   number | null;
  nba_rank?:                    number | null;
  primary_urgency_reason?:      string | null;
}

function transformApiRow(r: ApiClientRow): Client {
  const lastContact = r.last_contact_date
    ?? format(subDays(DEMO_ANCHOR_DATE, r.days_since_last_contact ?? 30), 'yyyy-MM-dd');

  const hasAllocation = r.target_allocation_equity != null;
  const allocation = hasAllocation
    ? buildAllocation(
        r.target_allocation_equity!, r.target_allocation_bonds!, r.target_allocation_cash!,
        r.actual_allocation_equity!, r.actual_allocation_bonds!, r.actual_allocation_cash!,
      )
    : [
        { assetClass: 'Equity', target: 60, current: 60 },
        { assetClass: 'Bonds',  target: 30, current: 30 },
        { assetClass: 'Cash',   target: 10, current: 10 },
      ];

  const goals: Goal[] = r.primary_goal_id
    ? [{
        id:                  r.primary_goal_id,
        type:                mapGoalType(r.primary_goal_type ?? ''),
        name:                r.primary_goal_type ?? 'Primary Goal',
        targetAmount:        r.primary_goal_target_amount ?? 0,
        targetDate:          r.primary_goal_target_date ?? '',
        currentAmount:       Math.round((r.primary_goal_target_amount ?? 0) * ((r.primary_goal_progress_pct ?? 0) / 100)),
        monthlyContribution: 0,
        onTrack:             r.primary_goal_on_track ?? true,
      }]
    : [];

  return {
    id:              r.client_id,
    name:            r.full_name,
    age:             r.age ?? 0,
    employment:      mapEmployment(r.life_stage ?? ''),
    riskProfile:     mapRiskTolerance(r.risk_tolerance ?? ''),
    clientSince:     generateClientSince(r.tenure_years ?? 5),
    aum:             Number(r.snapshot_aum ?? r.aum ?? 0),
    lastContact,
    lastRebalanced:  r.snapshot_date ?? lastContact,
    oneYearReturn:   r.ytd_return      != null ? Math.round(r.ytd_return      * 1000) / 10 : 0,
    benchmarkReturn: r.benchmark_return != null ? Math.round(r.benchmark_return * 1000) / 10 : 0,
    allocation,
    performanceData: [],
    goals,
    history:         [],
    familyMembers:   [],
    lifeEvents:      [],
    upcomingMeetings:[],
    personalitySummary:      `${r.first_name ?? r.full_name.split(' ')[0]} is a ${r.risk_tolerance ?? 'balanced'} investor in the ${r.life_stage ?? 'accumulation'} stage.`,
    communicationPreferences:'Prefers regular proactive check-ins and clear summaries.',
    keyConcerns:             r.primary_goal_type ? `${r.primary_goal_type} planning and portfolio alignment.` : 'Long-term financial security.',
    estatePlan:      buildEstatePlan(r.estate_docs_complete ?? false),
    insurance:       r.insurance_adequate
      ? [{ type: 'Life Insurance' as const, status: 'In Place' as const }]
      : [{ type: 'Life Insurance' as const, status: 'Review Needed' as const }],
    contactStats: {
      totalInteractions18m:   r.total_interactions_18m   ?? 0,
      openOverdueCommitments: r.open_overdue_commitments ?? 0,
      avgSentimentScore:      r.avg_sentiment_score      ?? 0,
    },
    nbaData: {
      score:                r.nba_score               ?? null,
      rank:                 r.nba_rank                ?? null,
      primaryUrgencyReason: r.primary_urgency_reason  ?? null,
      scenarioFlag:         r.nba_scenario_flag       ?? null,
    },
    savedScenarios: [],
    productHoldings: [],
  };
}

async function loadFromAPI(): Promise<Client[]> {
  const rows = await fetchJson<ApiClientRow[]>(`${API_URL}/api/v1/clients`);
  return rows.map(transformApiRow);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODE B — Static JSON files (fallback / no backend)
// ═══════════════════════════════════════════════════════════════════════════════

interface RawClient {
  client_id: string; advisor_id: string; full_name: string; first_name: string; age: number;
  life_stage: string; aum: number; tenure_years: number; risk_tolerance: string;
  estate_docs_complete: boolean; insurance_adequate: boolean; last_review_date: string;
  nba_scenario_flag?: boolean; nba_expected_rank?: number; household_id?: string;
  days_since_last_contact?: number;
}
interface RawContactLog {
  client_id: string; last_contact_date: string; days_since_last_contact: number;
  total_interactions_18m: number; open_overdue_commitments: number; avg_sentiment_score: number;
}
interface RawSnapshot {
  snapshot_id: string; client_id: string; snapshot_date: string; aum_value: number;
  target_allocation_equity: number; target_allocation_bonds: number; target_allocation_cash: number;
  actual_allocation_equity: number; actual_allocation_bonds: number; actual_allocation_cash: number;
  ytd_return: number; benchmark_return: number;
}
interface RawGoal {
  goal_id: string; client_id: string; goal_type: string; target_amount: number;
  current_progress_pct: number; target_date: string; on_track: boolean; priority_rank: number;
}
interface RawClientScore {
  client_id: string; nba_score: number | null; nba_rank: number | null;
  primary_urgency_reason: string | null; nba_scenario_flag: boolean | null;
}
interface RawHousehold {
  household_id: string; primary_client_id: string; member_ids: string;
}
interface RawLifeEvent {
  event_id: string; client_id: string; event_type: string; event_date: string;
}

interface RawProductHolding {
  holding_id: string; client_id: string; product_type: string;
  held: boolean; flagged_as_gap: boolean;
}

interface RawReferral {
  referral_id: string;
  referring_client_id: string;
  referred_client_id: string;
  referral_date: string;
  converted: boolean;
  conversion_date?: string;
}

interface RawInteraction {
  interaction_id:       string;
  client_id:            string;
  date:                 string;
  type:                 string;
  initiated_by:         string | null;
  duration_minutes:     number;
  outcome:              string | null;
  sentiment:            string | null;
  topics_discussed:     string | null;
  commitment_made:      boolean;
  commitment_fulfilled: boolean | null;
  follow_up_created:    boolean;
  follow_up_due_date:   string | null;
}

function _mapInteraction(i: RawInteraction): Interaction {
  const rawType = i.type?.toLowerCase() ?? '';
  const type: InteractionType =
    rawType === 'email'                                ? 'email'   :
    rawType === 'call' || rawType === 'phone call'     ? 'call'    : 'meeting';

  const parts = [i.topics_discussed, i.outcome].filter(Boolean);
  const summary = parts.length > 0
    ? parts.join(' · ')
    : (i.initiated_by ? `${i.initiated_by}-initiated interaction` : 'Interaction recorded');

  const actionItems: ActionItem[] =
    i.commitment_made && i.follow_up_due_date
      ? [{ id: `ai-${i.interaction_id}`, description: 'Follow-up commitment', assignedTo: 'FA', dueDate: i.follow_up_due_date, completed: i.commitment_fulfilled ?? false }]
      : [];

  return { id: i.interaction_id, date: i.date ?? '', type, summary, actionItems };
}

function _buildPerformanceData(snapshots: RawSnapshot[]): Array<{ month: string; portfolio: number; benchmark: number }> {
  return [...snapshots]
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    .map((s) => ({
      month:     format(parseISO(s.snapshot_date), 'MMM yyyy'),
      portfolio: parseFloat((100 * (1 + (s.ytd_return       ?? 0))).toFixed(2)),
      benchmark: parseFloat((100 * (1 + (s.benchmark_return ?? 0))).toFixed(2)),
    }));
}

async function loadFromJSON(): Promise<Client[]> {
  const [rawClients, rawContacts, rawSnapshots, rawGoals, rawScores, rawInteractions, rawHouseholds, rawLifeEvents, rawProductHoldings, rawReferrals] = await Promise.all([
    fetchJson<RawClient[]>('/data/clients.json'),
    fetchJson<RawContactLog[]>('/data/daily_contact_log.json'),
    fetchJson<RawSnapshot[]>('/data/portfolio_snapshots.json'),
    fetchJson<RawGoal[]>('/data/goals.json'),
    fetchJson<RawClientScore[]>('/data/client_scores.json'),
    fetchJson<RawInteraction[]>('/data/interactions.json'),
    fetchJson<RawHousehold[]>('/data/households.json'),
    fetchJson<RawLifeEvent[]>('/data/life_events.json'),
    fetchJson<RawProductHolding[]>('/data/product_holdings.json'),
    fetchJson<RawReferral[]>('/data/referrals.json'),
  ]);

  const contactMap   = new Map(rawContacts.map((c) => [c.client_id, c]));
  const scoreMap     = new Map(rawScores.map((s) => [s.client_id, s]));
  const householdMap = new Map(rawHouseholds.map((h) => [h.household_id, h]));

  const lifeEventsMap = new Map<string, LifeEvent[]>();
  for (const e of rawLifeEvents) {
    const list = lifeEventsMap.get(e.client_id) ?? [];
    list.push({ date: e.event_date, description: e.event_type });
    lifeEventsMap.set(e.client_id, list);
  }

  const clientById = new Map(rawClients.map((c) => [c.client_id, c]));

  const latestSnapshotMap = new Map<string, RawSnapshot>();
  const allSnapshotsMap   = new Map<string, RawSnapshot[]>();
  for (const snap of rawSnapshots) {
    const existing = latestSnapshotMap.get(snap.client_id);
    if (!existing || snap.snapshot_date > existing.snapshot_date) {
      latestSnapshotMap.set(snap.client_id, snap);
    }
    const list = allSnapshotsMap.get(snap.client_id) ?? [];
    list.push(snap);
    allSnapshotsMap.set(snap.client_id, list);
  }

  const primaryGoalMap = new Map<string, RawGoal>();
  const allGoalsMap = new Map<string, RawGoal[]>();
  for (const g of rawGoals) {
    if (g.priority_rank === 1) primaryGoalMap.set(g.client_id, g);
    const list = allGoalsMap.get(g.client_id) ?? [];
    list.push(g);
    allGoalsMap.set(g.client_id, list);
  }

  const productHoldingsMap = new Map<string, ProductHolding[]>();
  for (const h of rawProductHoldings) {
    const list = productHoldingsMap.get(h.client_id) ?? [];
    list.push({ productType: h.product_type, held: h.held, flaggedAsGap: h.flagged_as_gap });
    productHoldingsMap.set(h.client_id, list);
  }

  const referralMap = new Map<string, ReferralRecord[]>();
  for (const r of rawReferrals) {
    const list = referralMap.get(r.referring_client_id) ?? [];
    list.push({
      referralId:       r.referral_id,
      referredClientId: r.referred_client_id,
      referralDate:     r.referral_date,
      converted:        r.converted,
      conversionDate:   r.conversion_date,
    });
    referralMap.set(r.referring_client_id, list);
  }

  const interactionsMap = new Map<string, RawInteraction[]>();
  for (const inter of rawInteractions) {
    const list = interactionsMap.get(inter.client_id) ?? [];
    list.push(inter);
    interactionsMap.set(inter.client_id, list);
  }

  return rawClients.map((raw): Client => {
    const contact  = contactMap.get(raw.client_id);
    const snapshot = latestSnapshotMap.get(raw.client_id);
    const goal     = primaryGoalMap.get(raw.client_id);
    const score    = scoreMap.get(raw.client_id);

    // Always compute lastContact relative to DEMO_ANCHOR_DATE using the recorded
    // days_since_last_contact. The raw last_contact_date in daily_contact_log.json
    // is absolute (generated June 2026) and becomes stale relative to demo "today".
    const lastContact = format(
      subDays(DEMO_ANCHOR_DATE, raw.days_since_last_contact ?? contact?.days_since_last_contact ?? 30),
      'yyyy-MM-dd',
    );

    const apiRow: ApiClientRow = {
      ...raw,
      last_contact_date:         lastContact,
      total_interactions_18m:    contact?.total_interactions_18m    ?? 0,
      open_overdue_commitments:  contact?.open_overdue_commitments  ?? 0,
      avg_sentiment_score:       contact?.avg_sentiment_score       ?? 0,
      snapshot_date:             snapshot?.snapshot_date,
      snapshot_aum:              snapshot?.aum_value,
      target_allocation_equity:  snapshot?.target_allocation_equity,
      target_allocation_bonds:   snapshot?.target_allocation_bonds,
      target_allocation_cash:    snapshot?.target_allocation_cash,
      actual_allocation_equity:  snapshot?.actual_allocation_equity,
      actual_allocation_bonds:   snapshot?.actual_allocation_bonds,
      actual_allocation_cash:    snapshot?.actual_allocation_cash,
      ytd_return:                snapshot?.ytd_return,
      benchmark_return:          snapshot?.benchmark_return,
      primary_goal_id:           goal?.goal_id,
      primary_goal_type:         goal?.goal_type,
      primary_goal_target_amount:goal?.target_amount,
      primary_goal_progress_pct: goal?.current_progress_pct,
      primary_goal_target_date:  goal?.target_date,
      primary_goal_on_track:     goal?.on_track,
      nba_score:                 score?.nba_score ?? null,
      nba_rank:                  score?.nba_rank  ?? null,
      primary_urgency_reason:    score?.primary_urgency_reason ?? null,
      nba_scenario_flag:         score?.nba_scenario_flag ?? raw.nba_scenario_flag ?? undefined,
    };

    const household = raw.household_id ? householdMap.get(raw.household_id) : undefined;
    const familyMembers: FamilyMember[] = household
      ? household.member_ids
          .split('|')
          .map((id) => id.trim())
          .filter((id) => id && id !== raw.client_id)
          .map((id): FamilyMember | null => {
            const member = clientById.get(id);
            return member
              ? { relationship: 'Household Member', name: member.full_name, age: member.age }
              : null;
          })
          .filter((m): m is FamilyMember => m !== null)
      : [];

    const base = transformApiRow(apiRow);

    // Override goals with all goals (sorted by priority rank) so cross-sell and
    // other assessments see the full goal set, not only the primary goal.
    const allGoals: Goal[] = (allGoalsMap.get(raw.client_id) ?? [])
      .sort((a, b) => a.priority_rank - b.priority_rank)
      .map((g): Goal => ({
        id:                  g.goal_id,
        type:                mapGoalType(g.goal_type),
        name:                g.goal_type,
        targetAmount:        g.target_amount,
        targetDate:          g.target_date,
        currentAmount:       Math.round(g.target_amount * (g.current_progress_pct / 100)),
        monthlyContribution: 0,
        onTrack:             g.on_track,
      }));

    return {
      ...base,
      goals:           allGoals.length > 0 ? allGoals : base.goals,
      performanceData: _buildPerformanceData(allSnapshotsMap.get(raw.client_id) ?? []),
      history:         (interactionsMap.get(raw.client_id) ?? []).map(_mapInteraction),
      lifeEvents:      lifeEventsMap.get(raw.client_id) ?? [],
      familyMembers,
      productHoldings: productHoldingsMap.get(raw.client_id) ?? [],
      referralHistory: referralMap.get(raw.client_id) ?? [],
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Public entry point
// ═══════════════════════════════════════════════════════════════════════════════

export async function loadSyntheticClients(): Promise<Client[]> {
  if (API_URL) {
    console.info(`[AdvisorIQ] Loading clients from API: ${API_URL}`);
    try {
      return await loadFromAPI();
    } catch {
      console.warn('[AdvisorIQ] API unreachable — falling back to static JSON files.');
    }
  }
  console.info('[AdvisorIQ] Loading clients from static JSON files.');
  return loadFromJSON();
}

/**
 * Supplements any clients that are missing history or lifeEvents by fetching
 * interactions.json and life_events.json from /data/.
 *
 * This is needed when the app runs in API mode (VITE_API_URL set): the flat
 * /api/v1/clients endpoint returns clients without per-client interaction
 * history or life events (transformApiRow sets both to []). The JSON files
 * are always available as static assets, so we fetch from them as a fallback.
 *
 * Clients that already have history and lifeEvents are passed through unchanged.
 */
export async function enrichClientsWithHistory(clients: Client[]): Promise<Client[]> {
  // Only fetch JSON files if at least one client is missing both fields.
  // A client with no interactions (rare but valid) would have history:[] from the API,
  // so we check both fields together — if BOTH are empty that's the API-mode signature.
  const needsEnrichment = clients.some(c => c.history.length === 0 && c.lifeEvents.length === 0);
  const needsHoldings   = clients.some(c => !c.productHoldings || c.productHoldings.length === 0);
  // referralHistory is undefined on clients cached before this field was added to the schema.
  // An empty array [] means the client was loaded with the field but simply has no referrals.
  const needsReferrals  = clients.some(c => c.referralHistory === undefined);
  // Meeting seed: check if any seeded client is missing their meetings.
  const needsMeetings   = Object.keys(MEETING_SEED).some(id => {
    const c = clients.find(cl => cl.id === id);
    return c && c.upcomingMeetings.length === 0;
  });
  if (!needsEnrichment && !needsHoldings && !needsReferrals && !needsMeetings) return clients;

  console.info('[AdvisorIQ] Supplementing history, lifeEvents, productHoldings, and referralHistory from JSON files.');

  const fetches: [
    Promise<RawInteraction[]>,
    Promise<RawLifeEvent[]>,
    Promise<RawProductHolding[]>,
    Promise<RawReferral[]>,
  ] = [
    fetchJson<RawInteraction[]>('/data/interactions.json'),
    fetchJson<RawLifeEvent[]>('/data/life_events.json'),
    fetchJson<RawProductHolding[]>('/data/product_holdings.json'),
    fetchJson<RawReferral[]>('/data/referrals.json'),
  ];
  const [rawInteractions, rawLifeEvents, rawProductHoldings, rawReferrals] = await Promise.all(fetches);

  const interactionsMap = new Map<string, RawInteraction[]>();
  for (const i of rawInteractions) {
    const list = interactionsMap.get(i.client_id) ?? [];
    list.push(i);
    interactionsMap.set(i.client_id, list);
  }

  const lifeEventsMap = new Map<string, LifeEvent[]>();
  for (const e of rawLifeEvents) {
    const list = lifeEventsMap.get(e.client_id) ?? [];
    list.push({ date: e.event_date, description: e.event_type });
    lifeEventsMap.set(e.client_id, list);
  }

  const productHoldingsMap = new Map<string, ProductHolding[]>();
  for (const h of rawProductHoldings) {
    const list = productHoldingsMap.get(h.client_id) ?? [];
    list.push({ productType: h.product_type, held: h.held, flaggedAsGap: h.flagged_as_gap });
    productHoldingsMap.set(h.client_id, list);
  }

  const referralEnrichMap = new Map<string, ReferralRecord[]>();
  for (const r of rawReferrals) {
    const list = referralEnrichMap.get(r.referring_client_id) ?? [];
    list.push({
      referralId:       r.referral_id,
      referredClientId: r.referred_client_id,
      referralDate:     r.referral_date,
      converted:        r.converted,
      conversionDate:   r.conversion_date,
    });
    referralEnrichMap.set(r.referring_client_id, list);
  }

  return clients.map(c => ({
    ...c,
    history:         c.history.length    > 0 ? c.history    : (interactionsMap.get(c.id) ?? []).map(_mapInteraction),
    lifeEvents:      c.lifeEvents.length > 0 ? c.lifeEvents : (lifeEventsMap.get(c.id)   ?? []),
    productHoldings: (c.productHoldings && c.productHoldings.length > 0)
      ? c.productHoldings
      : (productHoldingsMap.get(c.id) ?? []),
    referralHistory: c.referralHistory !== undefined
      ? c.referralHistory
      : (referralEnrichMap.get(c.id) ?? []),
    upcomingMeetings: c.upcomingMeetings.length > 0
      ? c.upcomingMeetings
      : (MEETING_SEED[c.id] ?? []),
  }));
}
