/**
 * Cross-Sell / Upsell Assessment Agent — test script.
 *
 * Uses the LIVE 150-client synthetic dataset (public/data/).
 *
 * Test matrix:
 *
 *   MULTI-GAP — expect "high" or "moderate":
 *     C0023  (Estate/legacy goal → estate_plan+trust gaps; also insurance gaps)      — 3 flagged gaps
 *     C0002  (Income protection → insurance_protection gap; Retirement income → pension OK; ISA flagged) — 2 flagged gaps
 *     C0051  (Income protection → insurance_protection gap; Property purchase → mortgage not held; ISA flagged) — 2 flagged gaps
 *
 *   SINGLE-GAP — expect "moderate" or "low":
 *     C0089  (Education funding → tax_wrapper_isa flagged gap)                        — 1 flagged gap
 *
 *   ZERO-GAP — expect "none":
 *     C0001  (no flagged gaps)
 *     C0004  (no flagged gaps)
 *     C0005  (no flagged gaps)
 *
 * Gap detection is fully deterministic (mirrors detectCrossSellGaps in claudeClient.ts).
 * Confidence is also deterministic (mirrors calculateCrossSellConfidence).
 * The LLM only contributes the narrative evidence and suggested action.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test_cross_sell_agent.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { differenceInDays, differenceInYears, parseISO, subDays, subYears, format } from 'date-fns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = path.join(__dirname, '..', 'public', 'data');

const MODEL = 'claude-haiku-4-5';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Data loading ──────────────────────────────────────────────────────────────

const rawClients        = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'),              'utf8'));
const rawContacts       = JSON.parse(readFileSync(path.join(dataDir, 'daily_contact_log.json'),    'utf8'));
const rawSnapshots      = JSON.parse(readFileSync(path.join(dataDir, 'portfolio_snapshots.json'),  'utf8'));
const rawGoals          = JSON.parse(readFileSync(path.join(dataDir, 'goals.json'),                'utf8'));
const rawInteractions   = JSON.parse(readFileSync(path.join(dataDir, 'interactions.json'),         'utf8'));
const rawLifeEvents     = JSON.parse(readFileSync(path.join(dataDir, 'life_events.json'),          'utf8'));
const rawProductHoldings= JSON.parse(readFileSync(path.join(dataDir, 'product_holdings.json'),     'utf8'));

const contactMap = new Map(rawContacts.map(c => [c.client_id, c]));

const lifeEventsMap = new Map();
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

const allGoalsMap = new Map();
for (const g of rawGoals) {
  const list = allGoalsMap.get(g.client_id) ?? [];
  list.push(g);
  allGoalsMap.set(g.client_id, list);
}

const interactionsMap = new Map();
for (const i of rawInteractions) {
  const list = interactionsMap.get(i.client_id) ?? [];
  list.push(i);
  interactionsMap.set(i.client_id, list);
}

const productHoldingsMap = new Map();
for (const h of rawProductHoldings) {
  const list = productHoldingsMap.get(h.client_id) ?? [];
  list.push({ productType: h.product_type, held: h.held, flaggedAsGap: h.flagged_as_gap });
  productHoldingsMap.set(h.client_id, list);
}

// ── Build client object ───────────────────────────────────────────────────────

function mapGoalType(raw) {
  switch ((raw ?? '').toLowerCase()) {
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

function buildClient(clientId) {
  const raw = rawClients.find(c => c.client_id === clientId);
  if (!raw) throw new Error(`Client ${clientId} not found`);

  const contact  = contactMap.get(clientId);
  const snapshot = latestSnapshotMap.get(clientId);
  const rawInter = (interactionsMap.get(clientId) ?? []).sort((a, b) => a.date.localeCompare(b.date));

  const lastContact = contact?.last_contact_date ?? format(subDays(new Date(), 30), 'yyyy-MM-dd');

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
    summary: [i.topics_discussed, i.outcome].filter(Boolean).join(' · '),
    actionItems: i.commitment_made && i.follow_up_due_date
      ? [{ id: `ai-${i.interaction_id}`, description: 'Follow-up commitment', assignedTo: 'FA',
           dueDate: i.follow_up_due_date, completed: i.commitment_fulfilled ?? false }]
      : [],
  }));

  const allocation = snapshot ? [
    { assetClass: 'Equity', target: Math.round(snapshot.target_allocation_equity * 100), current: Math.round(snapshot.actual_allocation_equity * 100) },
    { assetClass: 'Bonds',  target: Math.round(snapshot.target_allocation_bonds  * 100), current: Math.round(snapshot.actual_allocation_bonds  * 100) },
    { assetClass: 'Cash',   target: Math.round(snapshot.target_allocation_cash   * 100), current: Math.round(snapshot.actual_allocation_cash   * 100) },
  ] : [{ assetClass: 'Equity', target: 60, current: 60 }];

  const allGoals = (allGoalsMap.get(clientId) ?? [])
    .sort((a, b) => a.priority_rank - b.priority_rank)
    .map(g => ({
      id: g.goal_id, type: mapGoalType(g.goal_type), name: g.goal_type,
      targetAmount: g.target_amount, targetDate: g.target_date,
      currentAmount: Math.round(g.target_amount * (g.current_progress_pct / 100)),
      monthlyContribution: 0, onTrack: g.on_track,
    }));

  const mapRisk = r => {
    switch ((r ?? '').toLowerCase()) {
      case 'conservative': return 'Conservative';
      case 'growth': case 'aggressive': return 'Aggressive';
      default: return 'Moderate';
    }
  };

  return {
    id:          raw.client_id,
    name:        raw.full_name,
    age:         raw.age ?? 0,
    riskProfile: mapRisk(raw.risk_tolerance),
    aum:         snapshot?.aum_value ?? raw.aum ?? 0,
    lastContact,
    clientSince: format(subYears(new Date(), Math.round(raw.tenure_years ?? 5)), 'yyyy-MM-dd'),
    allocation,
    goals:       allGoals,
    history,
    lifeEvents:  lifeEventsMap.get(clientId) ?? [],
    productHoldings: productHoldingsMap.get(clientId) ?? [],
    contactStats: {
      totalInteractions18m:   contact?.total_interactions_18m   ?? 0,
      openOverdueCommitments: contact?.open_overdue_commitments ?? 0,
      avgSentimentScore:      contact?.avg_sentiment_score      ?? 0,
    },
    _lifeStage: raw.life_stage,
  };
}

// ── Deterministic gap detection (mirrors detectCrossSellGaps in claudeClient.ts) ─

const GOAL_PRODUCT_MAP = {
  'Estate':            ['estate_plan', 'trust'],
  'Retirement Income': ['tax_wrapper_pension'],
  'Income Protection': ['insurance_protection'],
  'Property Purchase': ['mortgage'],
  'Education':         ['tax_wrapper_isa'],
  'Business Exit':     ['equity_portfolio'],
  'Charitable Giving': ['trust'],
  'Emergency Fund':    ['cash_savings'],
};

function detectCrossSellGaps(client) {
  const holdings = client.productHoldings ?? [];
  if (holdings.length === 0) return [];

  const holdingMap = new Map(holdings.map(h => [h.productType, h]));
  const gaps = [];
  const seen = new Set();

  for (const goal of client.goals) {
    for (const pt of GOAL_PRODUCT_MAP[goal.type] ?? []) {
      if (seen.has(pt)) continue;
      const h = holdingMap.get(pt);
      if (h && h.flaggedAsGap) {
        gaps.push({ productType: pt, reason: 'goal_gap', goalType: goal.type });
        seen.add(pt);
      }
    }
  }

  for (const h of holdings) {
    if (!seen.has(h.productType) && h.flaggedAsGap) {
      gaps.push({ productType: h.productType, reason: 'flagged_gap' });
      seen.add(h.productType);
    }
  }

  return gaps;
}

// ── Deterministic confidence (mirrors calculateCrossSellConfidence in claudeClient.ts) ─

function calculateCrossSellConfidence(client, gaps) {
  if (gaps.length === 0) return 'low';

  const interactions18m = client.contactStats?.totalInteractions18m ?? client.history.length;
  const goalGaps = gaps.filter(g => g.reason === 'goal_gap');
  const dsc = differenceInDays(new Date(), parseISO(client.lastContact));

  const goalGapOffTrack = goalGaps.some(
    g => client.goals.find(goal => goal.type === g.goalType)?.onTrack === false,
  );

  if (goalGaps.length >= 2 && interactions18m >= 3) return 'high';
  if (goalGaps.length >= 1 && interactions18m >= 5 && (goalGapOffTrack || dsc <= 60)) return 'high';
  if (gaps.length >= 2 && interactions18m >= 3) return 'medium';
  if (gaps.length >= 1 && interactions18m >= 1) return 'medium';
  return 'low';
}

// ── Prompt builder (mirrors buildCrossSellPrompt in claudeClient.ts) ──────────

function buildCrossSellPrompt(client, gaps, today) {
  const lifeStage = client._lifeStage ?? (client.age >= 65 ? 'Retirement'
    : client.age >= 50 ? 'Pre-retirement'
    : client.age >= 40 ? 'Accumulation'
    : 'Early career');
  const tenure = Math.max(0, differenceInYears(today, parseISO(client.clientSince)));

  const goalsBlock = client.goals.length > 0
    ? client.goals.map(g => `  - ${g.type}: target $${(g.targetAmount / 1_000).toFixed(0)}K by ${g.targetDate} | on track: ${g.onTrack}`).join('\n')
    : '  No goals on file.';

  const gapsBlock = gaps.map(g => {
    const label = g.reason === 'goal_gap'
      ? `${g.productType} (goal-aligned: ${g.goalType})`
      : `${g.productType} (practice-flagged gap)`;
    return `  - ${label}`;
  }).join('\n');

  const sortedHistory = [...client.history].sort((a, b) => a.date.localeCompare(b.date));
  const historyBlock = sortedHistory.length > 0
    ? sortedHistory.map(h => {
        const openItems = h.actionItems.filter(ai => !ai.completed);
        const itemLine  = openItems.length > 0
          ? `\n    Open action items: ${openItems.map(ai => ai.description).join('; ')}`
          : '';
        return `  ${h.date} [${h.type}]\n    ${h.summary}${itemLine}`;
      }).join('\n\n')
    : '  No interaction history.';

  const lifeEventBlock = client.lifeEvents.length > 0
    ? client.lifeEvents.map(e => `  - [${e.date}] ${e.description}`).join('\n')
    : '  None on file.';

  return [
    `CLIENT: ${client.name} (${client.id})`,
    `Age: ${client.age} | Life Stage: ${lifeStage} | AUM: $${(client.aum / 1_000_000).toFixed(2)}M | Tenure: ${tenure.toFixed(1)}yr`,
    `Risk Profile: ${client.riskProfile}`,
    ``,
    `CLIENT GOALS:`,
    goalsBlock,
    ``,
    `CANDIDATE GAPS (deterministically detected — your recommendation must stay within this list):`,
    gapsBlock,
    ``,
    `LIFE EVENTS ON FILE:`,
    lifeEventBlock,
    ``,
    `FULL INTERACTION HISTORY:`,
    historyBlock,
    ``,
    `Based on the goals, gaps, life events, and interaction history above, assess the cross-sell opportunity. Stay strictly within the candidate gaps list.`,
  ].join('\n');
}

// ── System prompt (mirrors CROSS_SELL_SYSTEM in claudeClient.ts) ──────────────

const COMPLIANCE_RULES = `
COMPLIANCE REQUIREMENTS — follow these rules in every response:
1. Only reference data explicitly provided in the context. Do not draw on outside knowledge about specific clients.
2. Never estimate, infer, or fabricate financial figures, dates, or client details not present in the provided data.
3. If data needed to answer is missing, state that explicitly rather than filling in gaps.
4. All projections and forward-looking statements are estimates based on stated assumptions and must never be framed as guarantees or predictions.
5. Never recommend specific securities, funds, ETFs, or financial products by name or ticker symbol.
6. Flag any tax considerations for review by the client's CPA or tax advisor — never state tax outcomes as definitive.
7. Never frame output as directives to the advisor — always as inputs for advisor review and professional judgment.
8. Never provide specific legal advice — flag any estate planning considerations for review by the client's attorney.
`;

const CROSS_SELL_SYSTEM = `You are an experienced wealth management analyst identifying cross-sell and upsell opportunities for a single client.

You are given:
1. The client's profile, goals, and interaction history
2. A DETERMINISTIC GAP ANALYSIS: product types where the practice management system has flagged a gap or where the client's goals imply a missing product

Your job is to assess whether these gaps represent genuine, timely opportunities — not to discover new gaps yourself.

GUARDRAILS:
- Only discuss products from the CANDIDATE GAPS list. Never suggest products not on that list.
- Never recommend solely based on AUM. There must be a specific life event, goal alignment, or interaction signal.
- If a client has previously declined a product type (mentioned in interactions), note that and downgrade the signal.
- If there are no candidate gaps, return opportunitySignal: "none".

SIGNAL CALIBRATION:
- "high": Multiple goal-aligned gaps with recent interaction evidence or active life events creating clear entry points
- "moderate": One goal-aligned gap with supporting interaction or life event evidence, or 2+ data-flagged gaps
- "low": Flagged gap(s) exist but no obvious urgency or entry point in the interaction history
- "none": No gaps or insufficient evidence to recommend any product

Return valid JSON ONLY — no markdown, no prose before or after:
{"opportunitySignal":"<high|moderate|low|none>","gapProducts":["<product_type>",...],"evidence":"<2-3 sentences citing specific goals, life events, or interaction signals>","suggestedAction":"<concrete, specific next step — not generic>"}
${COMPLIANCE_RULES}`;

// ── Assessment runner ─────────────────────────────────────────────────────────

async function runAssessment(clientId) {
  const client = buildClient(clientId);
  const gaps   = detectCrossSellGaps(client);
  const confidence = calculateCrossSellConfidence(client, gaps);

  if (gaps.length === 0) {
    return {
      opportunitySignal: 'none',
      gapProducts: [],
      evidence: 'No product gaps detected for this client.',
      suggestedAction: 'No cross-sell action required at this time.',
      confidence,
      _gaps: gaps,
      _client: client,
    };
  }

  const today = new Date();
  const userContent = buildCrossSellPrompt(client, gaps, today);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    temperature: 0,
    system: CROSS_SELL_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw   = response.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response for ${clientId}:\n${raw}`);

  const parsed = JSON.parse(match[0]);
  return { ...parsed, confidence, _gaps: gaps, _client: client };
}

// ── Test matrix ───────────────────────────────────────────────────────────────

const TEST_CLIENTS = [
  { id: 'C0023', label: 'Estate/legacy — 3 gaps (insurance_life, insurance_protection, estate_plan)' },
  { id: 'C0002', label: 'Income protection + Retirement income — 2 gaps (insurance_protection, tax_wrapper_isa)' },
  { id: 'C0051', label: 'Income protection + Property purchase — 2 gaps (insurance_protection, tax_wrapper_isa)' },
  { id: 'C0089', label: 'Education funding — 1 gap (tax_wrapper_isa)' },
  { id: 'C0001', label: 'Zero-gap client — expect "none"' },
  { id: 'C0004', label: 'Zero-gap client — expect "none"' },
  { id: 'C0005', label: 'Zero-gap client — expect "none"' },
];

const SIG_EMOJI = { high: '🟢', moderate: '🟡', low: '🟠', none: '⚫' };
const CONF_EMOJI = { high: '✅', medium: '⚠️', low: '🔻' };

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('  Cross-Sell / Upsell Assessment Agent — Integration Test');
console.log('══════════════════════════════════════════════════════════════════\n');

let passed = 0, failed = 0;

for (const { id, label } of TEST_CLIENTS) {
  console.log(`▶ ${id}  ${label}`);
  try {
    const result = await runAssessment(id);
    const sig  = result.opportunitySignal;
    const conf = result.confidence;
    const gapCount = result._gaps.length;

    console.log(`  Signal:     ${SIG_EMOJI[sig] ?? '?'} ${sig}`);
    console.log(`  Confidence: ${CONF_EMOJI[conf] ?? '?'} ${conf}  (${gapCount} gap(s) detected)`);
    if (result._gaps.length > 0) {
      console.log(`  Gaps:`);
      result._gaps.forEach(g => console.log(`    • ${g.productType} [${g.reason}${g.goalType ? ': ' + g.goalType : ''}]`));
    }
    console.log(`  Products:   ${(result.gapProducts ?? []).join(', ') || 'none'}`);
    console.log(`  Evidence:   ${result.evidence}`);
    console.log(`  Action:     ${result.suggestedAction}`);

    const isZeroGap = ['C0001', 'C0004', 'C0005'].includes(id);
    if (isZeroGap && sig === 'none') {
      console.log('  ✅ PASS — correctly returned "none" for zero-gap client\n');
      passed++;
    } else if (!isZeroGap && sig !== 'none') {
      console.log('  ✅ PASS — non-zero signal for gapped client\n');
      passed++;
    } else if (!isZeroGap && sig === 'none') {
      console.log('  ❌ FAIL — expected a signal for gapped client but got "none"\n');
      failed++;
    } else {
      console.log('  ❌ FAIL — expected "none" for zero-gap client but got signal\n');
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}\n`);
    failed++;
  }
}

console.log('══════════════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed / ${failed} failed / ${TEST_CLIENTS.length} total`);
console.log('══════════════════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
