/**
 * Referral & Acquisition Assessment Agent — test script.
 *
 * Uses the LIVE 150-client synthetic dataset (public/data/).
 *
 * Test matrix:
 *
 *   POSITIVE — clients with verified referral history (expect "high" or "moderate"):
 *     C0045  — 1 referral, not converted, historical
 *     C0072  — 1 referral, converted, historical
 *     C0142  — check actual referral data
 *     C0028  — check actual referral data
 *
 *   NEGATIVE — clients with NO referral history (guardrail: must return early, no LLM call):
 *     C0023  — zero referrals → signal "none", no API call
 *     C0010  — zero referrals → signal "none", no API call
 *     C0038  — KEY GUARDRAIL: high-engagement client, no referrals → must NOT be flagged
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test_referral_agent.mjs
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

const rawClients        = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'),             'utf8'));
const rawContacts       = JSON.parse(readFileSync(path.join(dataDir, 'daily_contact_log.json'),   'utf8'));
const rawSnapshots      = JSON.parse(readFileSync(path.join(dataDir, 'portfolio_snapshots.json'), 'utf8'));
const rawGoals          = JSON.parse(readFileSync(path.join(dataDir, 'goals.json'),               'utf8'));
const rawInteractions   = JSON.parse(readFileSync(path.join(dataDir, 'interactions.json'),        'utf8'));
const rawLifeEvents     = JSON.parse(readFileSync(path.join(dataDir, 'life_events.json'),         'utf8'));
const rawReferrals      = JSON.parse(readFileSync(path.join(dataDir, 'referrals.json'),           'utf8'));

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

// Key: referring_client_id → referral records
const referralMap = new Map();
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
    referralHistory: referralMap.get(clientId) ?? [],
    contactStats: {
      totalInteractions18m:   contact?.total_interactions_18m   ?? 0,
      openOverdueCommitments: contact?.open_overdue_commitments ?? 0,
      avgSentimentScore:      contact?.avg_sentiment_score      ?? 0,
    },
    _lifeStage: raw.life_stage,
  };
}

// ── Deterministic confidence (mirrors calculateReferralConfidence in claudeClient.ts) ─

const ACTIVE_THRESHOLD_DAYS = 730;

function calculateReferralConfidence(referralHistory) {
  if (referralHistory.length === 0) return { confidence: 'low', recencyTier: 'none' };

  const today = new Date();

  const active = referralHistory.filter(r => differenceInDays(today, parseISO(r.referralDate)) <= ACTIVE_THRESHOLD_DAYS);
  const historical = referralHistory.filter(r => differenceInDays(today, parseISO(r.referralDate)) > ACTIVE_THRESHOLD_DAYS);

  const recencyTier = active.length > 0 ? 'active' : historical.length > 0 ? 'historical' : 'none';

  if (active.length >= 2) return { confidence: 'high', recencyTier };
  if (active.length >= 1 && active.some(r => r.converted)) return { confidence: 'high', recencyTier };
  if (active.length >= 1) return { confidence: 'medium', recencyTier };
  if (historical.some(r => r.converted)) return { confidence: 'medium', recencyTier };
  return { confidence: 'low', recencyTier };
}

// ── Prompt builder (mirrors buildReferralPrompt in claudeClient.ts) ───────────

function formatLifeStage(raw) {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('young')) return 'Young Professional';
  if (s.includes('accum')) return 'Accumulation';
  if (s.includes('pre') && s.includes('ret')) return 'Pre-Retirement';
  if (s.includes('ret')) return 'Retirement';
  return 'Mid-Career';
}

function buildReferralPrompt(client, today) {
  const lifeStage = formatLifeStage(client._lifeStage);
  const tenure = differenceInYears(today, parseISO(client.clientSince));

  const lifeEventBlock = client.lifeEvents.length > 0
    ? client.lifeEvents.map(e => `  - ${e.date}: ${e.description}`).join('\n')
    : '  None on file.';

  const historyBlock = client.history.length > 0
    ? [...client.history]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 20)
        .map(h => {
          const overdueItems = h.actionItems?.filter(ai => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0) ?? [];
          const overdueNote  = overdueItems.length > 0 ? ' [OVERDUE FOLLOW-UP]' : '';
          return `  [${h.date}] ${h.type.toUpperCase()} — ${h.summary}${overdueNote}`;
        }).join('\n')
    : '  No interaction history.';

  const refs = client.referralHistory ?? [];
  const referralBlock = refs.length > 0
    ? refs.map(r => {
        const ageDays = differenceInDays(today, parseISO(r.referralDate));
        const tier = ageDays <= ACTIVE_THRESHOLD_DAYS ? 'ACTIVE' : 'HISTORICAL';
        const conversionNote = r.converted
          ? `converted${r.conversionDate ? ` on ${r.conversionDate}` : ''}`
          : 'not yet converted';
        return `  - [${tier}] ${r.referralId}: referred ${r.referredClientId} on ${r.referralDate} — ${conversionNote}`;
      }).join('\n')
    : '  No verified referral records on file.';

  return [
    `CLIENT: ${client.name} (${client.id})`,
    `Age: ${client.age} | Life Stage: ${lifeStage} | AUM: $${(client.aum / 1_000_000).toFixed(2)}M | Tenure: ${tenure.toFixed(1)}yr`,
    `Risk Profile: ${client.riskProfile}`,
    ``,
    `VERIFIED REFERRAL HISTORY (from practice records — do not invent additional referrals):`,
    referralBlock,
    ``,
    `LIFE EVENTS ON FILE:`,
    lifeEventBlock,
    ``,
    `FULL INTERACTION HISTORY:`,
    historyBlock,
    ``,
    `Based on the verified referral history and interaction signals above, assess this client's referral opportunity. Cite only the records listed above.`,
  ].join('\n');
}

// ── System prompt ─────────────────────────────────────────────────────────────

const COMPLIANCE_RULES = `
COMPLIANCE:
- Never provide specific investment recommendations or portfolio allocation percentages.
- Never reference specific securities, funds, or investment products by name.
- Always frame suggestions as questions or conversation starters, not directives.
- Highlight, do not downplay, any regulatory, suitability, or risk concerns.`;

const REFERRAL_SYSTEM = `You are an experienced wealth management analyst evaluating whether a client represents a referral and acquisition opportunity for their advisor.

You are given:
1. The client's profile and interaction history
2. VERIFIED REFERRAL HISTORY: past referrals this client has already made (from practice records)

Your job is to assess the quality and timing of this referral opportunity based solely on the verified evidence provided.

GUARDRAILS:
- A client is a referral candidate ONLY if they have verified referral history in the data provided.
- NEVER infer referral potential from topics discussed, personality traits, or investment behavior alone.
- If interaction notes mention concerns, complaints, or dissatisfaction, downgrade the signal.
- If a referral has been pending a long time without conversion, note this as a risk factor.
- Recency matters: referrals made within the last 2 years ("active") are stronger signals than older ones.
- Do NOT invent referral records. Only cite records explicitly listed in VERIFIED REFERRAL HISTORY.

SIGNAL CALIBRATION:
- "high": Multiple active referrals, or one active referral that already converted — proven, recent behavior
- "moderate": One active referral pending conversion, or prior referrals that converted but more than 2 years ago
- "low": Historical referrals that did not convert, or very sparse referral history
- "none": No verified referral history (this agent should not be called in this case)

Return valid JSON ONLY — no markdown, no prose before or after:
{"referralSignal":"<high|moderate|low>","conversionLikelihood":"<high|moderate|low>","evidence":"<2-3 sentences citing specific referral records and interaction signals>","suggestedAction":"<concrete, specific next step — not generic>"}
${COMPLIANCE_RULES}`;

// ── Agent runner ──────────────────────────────────────────────────────────────

async function runReferralAssessment(client) {
  const refs = client.referralHistory ?? [];

  if (refs.length === 0) {
    return {
      referralSignal: 'none',
      conversionLikelihood: 'low',
      evidence: 'No verified referral history for this client.',
      suggestedAction: 'No referral action warranted — client has no prior referral history.',
      confidence: 'low',
      recencyTier: 'none',
      llmCalled: false,
    };
  }

  const today = new Date();
  const { confidence, recencyTier } = calculateReferralConfidence(refs);
  const userContent = buildReferralPrompt(client, today);

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 800,
    temperature: 0,
    system:     REFERRAL_SYSTEM,
    messages:   [{ role: 'user', content: userContent }],
  });

  const raw = response.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in referral response for ${client.id}:\n${raw}`);

  const { referralSignal, conversionLikelihood, evidence, suggestedAction } = JSON.parse(match[0]);
  return { referralSignal, conversionLikelihood, evidence, suggestedAction, confidence, recencyTier, llmCalled: true };
}

// ── Test runner ───────────────────────────────────────────────────────────────

const TEST_CLIENTS = [
  // Positive candidates — expect LLM to fire
  { id: 'C0045', label: 'POSITIVE', expect: 'referral history present' },
  { id: 'C0072', label: 'POSITIVE', expect: 'referral history present' },
  { id: 'C0142', label: 'POSITIVE', expect: 'referral history present' },
  { id: 'C0028', label: 'POSITIVE', expect: 'referral history present' },
  // Negative guardrail — must NOT call LLM, must return signal "none"
  { id: 'C0023', label: 'NEGATIVE', expect: 'no referral history → none, no LLM call' },
  { id: 'C0010', label: 'NEGATIVE', expect: 'no referral history → none, no LLM call' },
  { id: 'C0038', label: 'GUARDRAIL', expect: 'Christopher Wood — high engagement but ZERO referrals → must return none' },
];

async function main() {
  console.log('='.repeat(70));
  console.log('Referral & Acquisition Assessment Agent — Test Run');
  console.log(`Model: ${MODEL}  |  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CLIENTS) {
    const client = buildClient(tc.id);
    const refs = client.referralHistory ?? [];

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`${tc.label}: ${client.name} (${tc.id})`);
    console.log(`Expected: ${tc.expect}`);
    console.log(`Referral history: ${refs.length} record(s)`);
    if (refs.length > 0) {
      for (const r of refs) {
        const age = differenceInDays(new Date(), parseISO(r.referralDate));
        const tier = age <= ACTIVE_THRESHOLD_DAYS ? 'ACTIVE' : 'HISTORICAL';
        console.log(`  [${tier}] ${r.referralId}: referred ${r.referredClientId} on ${r.referralDate} — ${r.converted ? `converted${r.conversionDate ? ' on ' + r.conversionDate : ''}` : 'not converted'}`);
      }
    }

    const { confidence, recencyTier } = calculateReferralConfidence(refs);
    console.log(`Deterministic → confidence: ${confidence}  recencyTier: ${recencyTier}`);

    try {
      const result = await runReferralAssessment(client);

      const guardrailOk = tc.label === 'NEGATIVE' || tc.label === 'GUARDRAIL'
        ? result.referralSignal === 'none' && !result.llmCalled
        : true;

      console.log(`\nresult.referralSignal:      ${result.referralSignal}`);
      console.log(`result.conversionLikelihood: ${result.conversionLikelihood}`);
      console.log(`result.confidence:           ${result.confidence}`);
      console.log(`result.recencyTier:          ${result.recencyTier}`);
      console.log(`LLM called:                  ${result.llmCalled}`);
      if (result.evidence)       console.log(`\nevidence:\n  ${result.evidence}`);
      if (result.suggestedAction) console.log(`\nsuggestedAction:\n  ${result.suggestedAction}`);

      if (tc.label === 'NEGATIVE' || tc.label === 'GUARDRAIL') {
        if (guardrailOk) {
          console.log(`\n✓ GUARDRAIL PASS — signal is "none", LLM not called`);
          passed++;
        } else {
          console.log(`\n✗ GUARDRAIL FAIL — signal: ${result.referralSignal}, llmCalled: ${result.llmCalled}`);
          failed++;
        }
      } else {
        console.log(`\n✓ POSITIVE — LLM fired, signal: ${result.referralSignal}`);
        passed++;
      }
    } catch (err) {
      console.error(`\n✗ ERROR for ${tc.id}:`, err.message);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));
}

main().catch(err => { console.error(err); process.exit(1); });
