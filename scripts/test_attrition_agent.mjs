/**
 * Attrition Assessment Agent — test script.
 *
 * Healthy-client validation batch — verifies the agent returns "no concern" or
 * "busy but stable" (not "quiet disengagement" by default) for clearly low-risk clients:
 *
 *   C0075 — Grace Bell       (Early career, $840K, 20 interactions, health=83, 0 negative, drift 0.4%)
 *   C0143 — Nadia Thompson   (Pre-retirement, $570K, 28 interactions, health=75, 1 negative, goal on-track)
 *   C0024 — Eleanor Cooper   (Retirement, $2M, 18 interactions, health=75, 15yr tenure, outperforming +14.5%)
 *
 * None match P1 or P2. All have GREEN health scores and ≥15 interactions (confidence=high).
 * Expected: "no concern" or "busy but stable" for all three.
 *
 * Includes 2 hardcoded confirmed patterns (validated against real data in sanity_check_validator.mjs):
 *   P1: Low-AUM clients (<$500K) overdue for contact (daysSinceContact > 60)
 *   P2: Pre-retirement clients with off-track goals
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test_attrition_agent.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { differenceInDays, differenceInYears, parseISO, subDays, subYears, format } from 'date-fns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = path.join(__dirname, '..', 'public', 'data');

const MODEL = 'claude-haiku-4-5';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Data loading ──────────────────────────────────────────────────────────────

const rawClients     = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'),             'utf8'));
const rawContacts    = JSON.parse(readFileSync(path.join(dataDir, 'daily_contact_log.json'),   'utf8'));
const rawSnapshots   = JSON.parse(readFileSync(path.join(dataDir, 'portfolio_snapshots.json'), 'utf8'));
const rawGoals       = JSON.parse(readFileSync(path.join(dataDir, 'goals.json'),               'utf8'));
const rawInteractions= JSON.parse(readFileSync(path.join(dataDir, 'interactions.json'),        'utf8'));
const rawLifeEvents  = JSON.parse(readFileSync(path.join(dataDir, 'life_events.json'),         'utf8'));

const contactMap      = new Map(rawContacts.map(c  => [c.client_id,  c]));
const lifeEventsMap   = new Map();
for (const e of rawLifeEvents) {
  const list = lifeEventsMap.get(e.client_id) ?? [];
  list.push({ date: e.event_date, description: e.event_type });
  lifeEventsMap.set(e.client_id, list);
}

const latestSnapshotMap = new Map();
for (const snap of rawSnapshots) {
  const ex = latestSnapshotMap.get(snap.client_id);
  if (!ex || snap.snapshot_date > ex.snapshot_date) latestSnapshotMap.set(snap.client_id, snap);
}

const primaryGoalMap = new Map();
for (const g of rawGoals) {
  if (g.priority_rank === 1) primaryGoalMap.set(g.client_id, g);
}

const interactionsMap = new Map();
for (const i of rawInteractions) {
  const list = interactionsMap.get(i.client_id) ?? [];
  list.push(i);
  interactionsMap.set(i.client_id, list);
}

// ── Build a full client object ────────────────────────────────────────────────

function aumLabel(aum) {
  if (aum < 500_000)   return '<500K';
  if (aum < 1_000_000) return '500K-1M';
  if (aum < 2_000_000) return '1M-2M';
  return '>2M';
}

function buildClient(clientId) {
  const raw      = rawClients.find(c => c.client_id === clientId);
  if (!raw) throw new Error(`Client ${clientId} not found`);

  const contact  = contactMap.get(clientId);
  const snapshot = latestSnapshotMap.get(clientId);
  const goal     = primaryGoalMap.get(clientId);
  const rawInter = (interactionsMap.get(clientId) ?? []).sort((a, b) => a.date.localeCompare(b.date));

  const lastContact = contact?.last_contact_date ?? format(subDays(new Date(), 30), 'yyyy-MM-dd');

  // Map interaction type
  const mapType = t => {
    const lc = (t ?? '').toLowerCase();
    if (lc === 'email') return 'email';
    if (lc === 'call' || lc === 'phone call') return 'call';
    return 'meeting';
  };

  const history = rawInter.map(i => ({
    id:   i.interaction_id,
    date: i.date ?? '',
    type: mapType(i.type),
    summary: [i.topics_discussed, i.sentiment ? `sentiment:${i.sentiment}` : null, i.outcome].filter(Boolean).join(' · '),
    actionItems: i.commitment_made && i.follow_up_due_date
      ? [{ id: `ai-${i.interaction_id}`, description: 'Follow-up commitment', assignedTo: 'FA',
           dueDate: i.follow_up_due_date, completed: i.commitment_fulfilled ?? false }]
      : [],
  }));

  const allocation = snapshot ? [
    { assetClass: 'Equity', target: Math.round(snapshot.target_allocation_equity * 100), current: Math.round(snapshot.actual_allocation_equity * 100) },
    { assetClass: 'Bonds',  target: Math.round(snapshot.target_allocation_bonds  * 100), current: Math.round(snapshot.actual_allocation_bonds  * 100) },
    { assetClass: 'Cash',   target: Math.round(snapshot.target_allocation_cash   * 100), current: Math.round(snapshot.actual_allocation_cash   * 100) },
  ] : [{ assetClass: 'Equity', target: 60, current: 60 }, { assetClass: 'Bonds', target: 30, current: 30 }, { assetClass: 'Cash', target: 10, current: 10 }];

  const goals = goal ? [{
    id: goal.goal_id, type: goal.goal_type, name: goal.goal_type,
    targetAmount: goal.target_amount,
    targetDate:   goal.target_date,
    currentAmount: Math.round(goal.target_amount * (goal.current_progress_pct / 100)),
    monthlyContribution: 0,
    onTrack: goal.on_track,
  }] : [];

  const mapRisk = r => {
    switch ((r ?? '').toLowerCase()) {
      case 'conservative': return 'Conservative';
      case 'growth': case 'aggressive': return 'Aggressive';
      default: return 'Moderate';
    }
  };

  return {
    id:    raw.client_id,
    name:  raw.full_name,
    age:   raw.age ?? 0,
    employment: raw.life_stage === 'Retirement' ? 'Retired' : 'Professional',
    riskProfile: mapRisk(raw.risk_tolerance),
    aum:   snapshot?.aum_value ?? raw.aum ?? 0,
    lastContact,
    clientSince: format(subYears(new Date(), Math.round(raw.tenure_years ?? 5)), 'yyyy-MM-dd'),
    lastRebalanced: snapshot?.snapshot_date ?? lastContact,
    oneYearReturn:   snapshot ? Math.round((snapshot.ytd_return ?? 0) * 1000) / 10 : 0,
    benchmarkReturn: snapshot ? Math.round((snapshot.benchmark_return ?? 0) * 1000) / 10 : 0,
    allocation,
    performanceData: [],
    goals,
    history,
    familyMembers:  [],
    lifeEvents:     lifeEventsMap.get(clientId) ?? [],
    upcomingMeetings: [],
    personalitySummary: '',
    communicationPreferences: '',
    keyConcerns: '',
    contactStats: {
      totalInteractions18m:   contact?.total_interactions_18m   ?? 0,
      openOverdueCommitments: contact?.open_overdue_commitments ?? 0,
      avgSentimentScore:      contact?.avg_sentiment_score      ?? 0,
    },
    estatePlan: { documents: [] },
    insurance:  [],
    // Extra raw fields for logging
    _referralSource: raw.referral_source,
    _tenure: raw.tenure_years,
    _riskScoreTarget: raw.risk_score_target,
    _riskScoreCurrent: raw.risk_score_current,
    _aumTier: aumLabel(raw.aum ?? 0),
    _lifeStage: raw.life_stage,
    _daysSinceContact: raw.days_since_last_contact,
  };
}

// ── Filter helpers (mirroring the TypeScript validator) ───────────────────────

function applyCondition(signal, cond) {
  const v  = signal[cond.field];
  const cv = cond.value;
  if (v === undefined) return false;
  switch (cond.op) {
    case 'lt':  return v < cv;
    case 'gt':  return v > cv;
    case 'lte': return v <= cv;
    case 'gte': return v >= cv;
    case 'eq':  return v === cv;
    case 'neq': return v !== cv;
    case 'in':  return Array.isArray(cv) && cv.includes(String(v));
    default:    return false;
  }
}

function normalizeClient(c, today) {
  const dsc = differenceInDays(today, parseISO(c.lastContact));
  const maxDrift = c.allocation.length > 0
    ? Math.max(...c.allocation.map(a => Math.abs(a.current - a.target)))
    : 0;
  return {
    id: c.id,
    age: c.age,
    aum: c.aum,
    aumTier: c._aumTier ?? aumLabel(c.aum),
    risk: c.riskProfile.toLowerCase(),
    daysSinceContact: dsc,
    portfolioDrift: maxDrift,
    offTrackGoals: c.goals.filter(g => !g.onTrack).length,
    overdueCommitments: c.contactStats?.openOverdueCommitments ?? 0,
    unactionedLifeEvent: c.lifeEvents.length > 0,
    estateComplete: false,
    insuranceAdequate: false,
    lifeStage: c.age >= 65 ? 'Retirement' : c.age >= 50 ? 'Pre-retirement' : c.age >= 40 ? 'Accumulation' : 'Early career',
    tenure: Math.max(0, differenceInYears(today, parseISO(c.clientSince))),
  };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(c, confirmedPatterns, today) {
  const dsc = differenceInDays(today, parseISO(c.lastContact));
  const maxDrift = c.allocation.length > 0
    ? Math.max(...c.allocation.map(a => Math.abs(a.current - a.target)))
    : 0;
  const recency       = dsc <= 30 ? 25 : dsc <= 60 ? 17 : dsc <= 90 ? 8 : 0;
  const portHealth    = maxDrift <= 3 ? 25 : maxDrift <= 6 ? 17 : maxDrift <= 10 ? 8 : 0;
  const onTrack       = c.goals.filter(g => g.onTrack).length;
  const goalScore     = c.goals.length > 0 ? Math.round((onTrack / c.goals.length) * 25) : 25;
  const overdueCount  = c.contactStats?.openOverdueCommitments ?? 0;
  const actionScore   = overdueCount === 0 ? 25 : overdueCount === 1 ? 17 : overdueCount === 2 ? 8 : 0;
  const healthTotal   = recency + portHealth + goalScore + actionScore;
  const healthColor   = healthTotal < 50 ? 'RED' : healthTotal < 75 ? 'AMBER' : 'GREEN';

  const lifeStage = c.age >= 65 ? 'Retirement' : c.age >= 50 ? 'Pre-retirement' : c.age >= 40 ? 'Accumulation' : 'Early career';
  const tenure    = Math.max(0, differenceInYears(today, parseISO(c.clientSince)));

  const recentHistory = [...c.history].sort((a, b) => a.date.localeCompare(b.date)).slice(-8);
  const historyBlock  = recentHistory.length > 0
    ? recentHistory.map(h => `  ${h.date} [${h.type}] ${h.summary}`).join('\n')
    : '  No interaction history loaded.';

  const signal = normalizeClient(c, today);
  const matched = confirmedPatterns.filter(p =>
    p.filterSpec?.segmentConditions?.every(cond => applyCondition(signal, cond))
  );
  const patternBlock = matched.length > 0
    ? matched.map(p => {
        const ratio = p.comparisonBaselinePercentage > 0
          ? (p.matchPercentage / p.comparisonBaselinePercentage).toFixed(2) + 'x'
          : '∞';
        return `  - "${p.hypothesis}" (match=${p.matchPercentage}%, baseline=${p.comparisonBaselinePercentage}%, ratio=${ratio}, n=${p.sampleSize})`;
      }).join('\n')
    : '  None — this client does not match any confirmed pattern segments.';

  const ret = c.oneYearReturn ?? 0;
  const bm  = c.benchmarkReturn ?? 0;

  return [
    `CLIENT: ${c.name} (${c.id})`,
    `Age: ${c.age} | Life Stage: ${lifeStage} | AUM: $${(c.aum / 1_000_000).toFixed(2)}M | Tenure: ${tenure.toFixed(1)}yr | Referral: ${c._referralSource ?? 'unknown'}`,
    `Risk Profile: ${c.riskProfile} | Risk Score: Target ${c._riskScoreTarget ?? 'n/a'}, Current ${c._riskScoreCurrent ?? 'n/a'}`,
    ``,
    `HEALTH SCORE: ${healthTotal}/100 (${healthColor})`,
    `  Recency (contact):  ${recency}/25  (${dsc} days since last contact)`,
    `  Portfolio health:   ${portHealth}/25  (max drift ${maxDrift.toFixed(1)}%)`,
    `  Goal progress:      ${goalScore}/25  (${onTrack}/${c.goals.length} goals on track)`,
    `  Action items:       ${actionScore}/25  (${overdueCount} overdue)`,
    ``,
    `CONTACT STATS:`,
    `  Total interactions (18m): ${c.contactStats?.totalInteractions18m ?? 'n/a'}`,
    `  Avg sentiment score (0=neg, 1=pos): ${(+(c.contactStats?.avgSentimentScore ?? 0)).toFixed(2)}`,
    `  Open overdue commitments: ${c.contactStats?.openOverdueCommitments ?? 0}`,
    ``,
    `PORTFOLIO: 1yr return ${ret}% vs benchmark ${bm}% (delta: ${(ret - bm).toFixed(1)}%)`,
    `Life events on file: ${c.lifeEvents.length}`,
    ``,
    `RECENT INTERACTION HISTORY (oldest→newest, last 8):`,
    historyBlock,
    ``,
    `CONFIRMED CROSS-BOOK PATTERNS — this client matches:`,
    patternBlock,
    ``,
    `Assess this client's attrition risk. Cite specific evidence. Be direct.`,
  ].join('\n');
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM = `You are an experienced wealth management analyst assessing a single client's attrition risk for their advisor.

Classify the client into EXACTLY ONE of these four risk categories:
- "quiet disengagement" — gradual drift away: long contact gap, declining engagement, no complaints surfaced, no obvious crisis — client is simply fading
- "dissatisfaction" — active dissatisfaction signals: complaints raised, client-initiated concerns, negative interaction outcomes, unresolved issues
- "busy but stable" — contact gap exists but client appears retained: strong portfolio, positive tone when contacted, long tenure, high historical engagement
- "no concern" — recently engaged, positive signals across the board, no meaningful attrition indicators

Weigh THREE layers in order:
1. DETERMINISTIC SIGNALS: health score sub-scores, contact frequency, portfolio drift, goal on-track rate
2. QUALITATIVE: tone and content of interaction notes — complaints, concerns, positive reinforcement, advisor- vs client-initiated, recurring topics
3. BOOK CONTEXT: confirmed cross-book patterns this client matches — statistically validated, treat as real signal

IMPORTANT: "busy but stable" requires positive evidence of stability — do not default to it just because there are no complaints.

Return valid JSON ONLY — no markdown, no prose before or after:
{"riskCategory":"<one of the four exact strings>","reasoning":"<2-4 sentences citing specific numbers and interaction evidence>","suggestedAction":"<concrete, specific next step — not generic>"}`;

// ── Deterministic confidence (mirrors calculateAttritionConfidence in claudeClient.ts) ──────

function calculateConfidence(c, confirmedPatterns, today) {
  const interactions18m = c.contactStats?.totalInteractions18m ?? c.history.length;

  if (interactions18m <= 1) return 'low';
  if (interactions18m <= 4) return 'medium';
  if (interactions18m >= 15) return 'high';

  // 5–14 interactions: check signal coherence
  const dsc = differenceInDays(today, parseISO(c.lastContact));
  const maxDrift = c.allocation.length > 0
    ? Math.max(...c.allocation.map(a => Math.abs(a.current - a.target)))
    : 0;
  const onTrack     = c.goals.filter(g => g.onTrack).length;
  const overdueCount = c.contactStats?.openOverdueCommitments ?? 0;

  const recency     = dsc <= 30 ? 25 : dsc <= 60 ? 17 : dsc <= 90 ? 8 : 0;
  const portHealth  = maxDrift <= 3 ? 25 : maxDrift <= 6 ? 17 : maxDrift <= 10 ? 8 : 0;
  const goalScore   = c.goals.length > 0 ? Math.round((onTrack / c.goals.length) * 25) : 25;
  const actionScore = overdueCount === 0 ? 25 : overdueCount === 1 ? 17 : overdueCount === 2 ? 8 : 0;
  const healthTotal = recency + portHealth + goalScore + actionScore;

  const signal = normalizeClient(c, today);
  const hasPatternMatch = confirmedPatterns.some(p =>
    p.filterSpec?.segmentConditions?.every(cond => applyCondition(signal, cond))
  );

  const mixedSignals = (recency >= 17 && portHealth <= 8) || (recency <= 8 && portHealth >= 17);
  const isBorderline = Math.abs(healthTotal - 50) < 8 || Math.abs(healthTotal - 75) < 8;

  if (hasPatternMatch && !mixedSignals) return 'high';
  if (!isBorderline && !mixedSignals) return 'high';
  return 'medium';
}

// ── Confirmed patterns (hardcoded from known data correlations) ───────────────
// These mirror patterns we know exist in the synthetic data (validated in sanity_check_validator.mjs).
// In production these would come from a prior Pattern Discovery run.

const CONFIRMED_PATTERNS = [
  {
    hypothesis: 'Low-AUM clients (under $500K) are significantly under-contacted compared to the rest of the book',
    matchPercentage:              74.1,
    comparisonBaselinePercentage: 41.3,
    sampleSize: 58,
    filterSpec: {
      segmentConditions: [{ field: 'aumTier', op: 'eq', value: '<500K' }],
      metricField: 'daysSinceContact',
      metricOp:    'gt',
      metricValue: 60,
    },
  },
  {
    hypothesis: 'Pre-retirement clients are more likely to have at least one off-track financial goal',
    matchPercentage:              38.5,
    comparisonBaselinePercentage: 24.2,
    sampleSize: 52,
    filterSpec: {
      segmentConditions: [{ field: 'lifeStage', op: 'eq', value: 'Pre-retirement' }],
      metricField: 'offTrackGoals',
      metricOp:    'gt',
      metricValue: 0,
    },
  },
];

// ── Assess one client ─────────────────────────────────────────────────────────

async function assess(clientId) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ASSESSING: ${clientId}`);
  console.log('═'.repeat(70));

  const c      = buildClient(clientId);
  const today  = new Date();
  const prompt = buildPrompt(c, CONFIRMED_PATTERNS, today);

  // Deterministic confidence — calculated before the LLM call
  const confidence = calculateConfidence(c, CONFIRMED_PATTERNS, today);

  console.log('\n── PROMPT SENT TO MODEL ──────────────────────────────────────');
  console.log(prompt);
  console.log(`\n── DETERMINISTIC CONFIDENCE: ${confidence.toUpperCase()} ────────────────────────`);
  console.log(`   interactions18m=${c.contactStats?.totalInteractions18m ?? c.history.length}`);
  console.log('\n── CALLING MODEL ─────────────────────────────────────────────');

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 500,
    temperature: 0.2,
    system:     SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0]?.text ?? '';
  console.log('\n── RAW RESPONSE ──────────────────────────────────────────────');
  console.log(raw);

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found');
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.log(`\n❌ PARSE ERROR: ${e.message}`);
    return;
  }

  // Attach deterministic confidence (overrides whatever LLM may have put in JSON)
  parsed.confidence = confidence;

  console.log('\n── PARSED RESULT ─────────────────────────────────────────────');
  console.log(`  Risk Category:    ${parsed.riskCategory}`);
  console.log(`  Confidence:       ${parsed.confidence}  ← deterministic`);
  console.log(`  Reasoning:        ${parsed.reasoning}`);
  console.log(`  Suggested Action: ${parsed.suggestedAction}`);

  const signal  = normalizeClient(c, today);
  const matched = CONFIRMED_PATTERNS.filter(p =>
    p.filterSpec?.segmentConditions?.every(cond => applyCondition(signal, cond))
  );
  console.log(`\n  Pattern matches:  ${matched.length > 0 ? matched.map(p => p.hypothesis.slice(0, 60) + '…').join(', ') : 'none'}`);

  return parsed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  console.log('Attrition Assessment Agent — Healthy-Client Validation');
  console.log(`Model: ${MODEL}`);
  console.log(`Confirmed patterns in context: ${CONFIRMED_PATTERNS.length}`);
  console.log('Expected: "no concern" or "busy but stable" for all three');

  const results = {};
  for (const id of ['C0075', 'C0143', 'C0024']) {
    results[id] = await assess(id);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('SUMMARY TABLE');
  console.log('═'.repeat(70));
  console.log(`${'Client'.padEnd(10)} ${'Risk Category'.padEnd(26)} ${'Conf'.padEnd(8)} Suggested Action`);
  console.log('-'.repeat(70));
  for (const [id, r] of Object.entries(results)) {
    if (r) {
      const name = buildClient(id).name;
      console.log(`${(id + ' ' + name).padEnd(10)} ${(r.riskCategory ?? '').padEnd(26)} ${(r.confidence ?? '').padEnd(8)} ${r.suggestedAction?.slice(0, 40) ?? ''}`);
    }
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
