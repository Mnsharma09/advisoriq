/**
 * Wallet Capture Assessment Agent — test script.
 *
 * Uses the LIVE 150-client synthetic dataset (public/data/), same approach
 * as test_attrition_agent.mjs and test_hypothesis_generator.mjs.
 *
 * Test matrix (selected by searching actual interactions.json / life_events.json):
 *
 *   SIGNAL-RICH — expect "strong":
 *     C0078  Diana Wang       (Retirement, $815K, 27 interactions18m)
 *                              Life events: Inheritance received ×2 (2024, 2025), Business sale (2024), Divorce
 *                              Topics: inheritance planning, business exit planning
 *     C0064  Aisha Tanaka     (Pre-retirement, $13.1M, 69 interactions18m)
 *                              Life event: Inheritance received (2024-07-05)
 *                              Topics: inheritance planning (12 interactions)
 *
 *   NO-SIGNAL — expect "none":
 *     C0059  Mark Patel       (Pre-retirement, $749K, 17 interactions18m)
 *                              Life events: New child, Business start (not sale)
 *                              Topics: property discussion, tax planning, cash flow — no inheritance language
 *     C0042  Rachel Jones     (Pre-retirement, $4.4M, 3 interactions)
 *                              Life events: Job change ×2, Health event, Child leaving home
 *                              Topics: insurance review, tax planning, risk tolerance, rebalancing — purely routine
 *
 * Confidence is deterministic (mirrors calculateWalletCaptureConfidence in claudeClient.ts).
 * The LLM never self-reports it.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test_wallet_capture_agent.mjs
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

// ── Data loading (identical to test_attrition_agent.mjs) ─────────────────────

const rawClients      = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'),             'utf8'));
const rawContacts     = JSON.parse(readFileSync(path.join(dataDir, 'daily_contact_log.json'),   'utf8'));
const rawSnapshots    = JSON.parse(readFileSync(path.join(dataDir, 'portfolio_snapshots.json'), 'utf8'));
const rawGoals        = JSON.parse(readFileSync(path.join(dataDir, 'goals.json'),               'utf8'));
const rawInteractions = JSON.parse(readFileSync(path.join(dataDir, 'interactions.json'),        'utf8'));
const rawLifeEvents   = JSON.parse(readFileSync(path.join(dataDir, 'life_events.json'),         'utf8'));

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

// ── Build a full client object (identical to test_attrition_agent.mjs) ───────

function aumLabel(aum) {
  if (aum < 500_000)   return '<500K';
  if (aum < 1_000_000) return '500K-1M';
  if (aum < 2_000_000) return '1M-2M';
  return '>2M';
}

function buildClient(clientId) {
  const raw = rawClients.find(c => c.client_id === clientId);
  if (!raw) throw new Error(`Client ${clientId} not found`);

  const contact  = contactMap.get(clientId);
  const snapshot = latestSnapshotMap.get(clientId);
  const goal     = primaryGoalMap.get(clientId);
  const rawInter = (interactionsMap.get(clientId) ?? []).sort((a, b) => a.date.localeCompare(b.date));

  const lastContact = contact?.last_contact_date ?? format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const mapType = t => {
    const lc = (t ?? '').toLowerCase();
    if (lc === 'email') return 'email';
    if (lc === 'call' || lc === 'phone call') return 'call';
    return 'meeting';
  };

  // For wallet capture we include ALL interaction text so the LLM has full evidence
  const history = rawInter.map(i => ({
    id:   i.interaction_id,
    date: i.date ?? '',
    type: mapType(i.type),
    summary: [i.topics_discussed, i.outcome, i.notes].filter(Boolean).join(' · '),
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
    id:          raw.client_id,
    name:        raw.full_name,
    age:         raw.age ?? 0,
    riskProfile: mapRisk(raw.risk_tolerance),
    aum:         snapshot?.aum_value ?? raw.aum ?? 0,
    lastContact,
    clientSince: format(subYears(new Date(), Math.round(raw.tenure_years ?? 5)), 'yyyy-MM-dd'),
    allocation,
    goals,
    history,
    lifeEvents:  lifeEventsMap.get(clientId) ?? [],
    contactStats: {
      totalInteractions18m:   contact?.total_interactions_18m   ?? 0,
      openOverdueCommitments: contact?.open_overdue_commitments ?? 0,
      avgSentimentScore:      contact?.avg_sentiment_score      ?? 0,
    },
    _aumTier:  aumLabel(raw.aum ?? 0),
    _lifeStage: raw.life_stage,
  };
}

// ── Filter helpers (mirrors TypeScript applyCondition / normalizeClient) ──────

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
  return {
    id: c.id,
    age: c.age,
    aum: c.aum,
    aumTier: c._aumTier ?? aumLabel(c.aum),
    risk: c.riskProfile.toLowerCase(),
    daysSinceContact: differenceInDays(today, parseISO(c.lastContact)),
    portfolioDrift: c.allocation.length > 0
      ? Math.max(...c.allocation.map(a => Math.abs(a.current - a.target)))
      : 0,
    offTrackGoals: c.goals.filter(g => !g.onTrack).length,
    overdueCommitments: c.contactStats?.openOverdueCommitments ?? 0,
    unactionedLifeEvent: c.lifeEvents.length > 0,
    estateComplete: false,
    insuranceAdequate: false,
    lifeStage: c._lifeStage ?? (c.age >= 65 ? 'Retirement' : c.age >= 50 ? 'Pre-retirement' : c.age >= 40 ? 'Accumulation' : 'Early career'),
    tenure: Math.max(0, differenceInYears(today, parseISO(c.clientSince))),
  };
}

// ── Deterministic confidence (mirrors calculateWalletCaptureConfidence in TS) ──

const CONFIRMED_PATTERNS = []; // no patterns in this standalone test

function calculateWalletCaptureConfidence(c, confirmedPatterns) {
  const interactions18m = c.contactStats?.totalInteractions18m ?? c.history.length;
  const lifeEventCount  = c.lifeEvents.length;

  if (interactions18m <= 1 && lifeEventCount === 0) return 'low';

  const today = new Date();
  const signal = normalizeClient(c, today);
  const hasPatternMatch = confirmedPatterns.some(p =>
    p.filterSpec?.segmentConditions?.every(cond => applyCondition(signal, cond))
  );

  if (interactions18m >= 5 || lifeEventCount >= 2 || hasPatternMatch) return 'high';

  return 'medium';
}

// ── Prompt builder (mirrors buildWalletCapturePrompt in claudeClient.ts) ─────

function buildWalletCapturePrompt(c, confirmedPatterns, today) {
  const lifeStage = c._lifeStage ?? (c.age >= 65 ? 'Retirement'
    : c.age >= 50 ? 'Pre-retirement'
    : c.age >= 40 ? 'Accumulation'
    : 'Early career');
  const tenure = Math.max(0, differenceInYears(today, parseISO(c.clientSince)));

  const sortedHistory = [...c.history].sort((a, b) => a.date.localeCompare(b.date));
  const historyBlock = sortedHistory.length > 0
    ? sortedHistory.map(h => {
        const openItems = h.actionItems.filter(ai => !ai.completed);
        const itemLine  = openItems.length > 0
          ? `\n    Open action items: ${openItems.map(ai => ai.description).join('; ')}`
          : '';
        return `  ${h.date} [${h.type}]\n    ${h.summary}${itemLine}`;
      }).join('\n\n')
    : '  No interaction history.';

  const lifeEventBlock = c.lifeEvents.length > 0
    ? c.lifeEvents.map(e => `  - [${e.date}] ${e.description}`).join('\n')
    : '  None on file.';

  const signal = normalizeClient(c, today);
  const matchedPatterns = confirmedPatterns.filter(p =>
    p.filterSpec?.segmentConditions?.every(cond => applyCondition(signal, cond))
  );
  const patternBlock = matchedPatterns.length > 0
    ? matchedPatterns.map(p =>
        `  - "${p.hypothesis}" (${p.matchPercentage}% vs ${p.comparisonBaselinePercentage}% baseline, n=${p.sampleSize})`
      ).join('\n')
    : '  None.';

  return [
    `CLIENT: ${c.name} (${c.id})`,
    `Age: ${c.age} | Life Stage: ${lifeStage} | AUM at firm: $${(c.aum / 1_000_000).toFixed(3)}M | Tenure: ${tenure.toFixed(1)}yr`,
    ``,
    `LIFE EVENTS ON FILE:`,
    lifeEventBlock,
    ``,
    `FULL INTERACTION HISTORY:`,
    historyBlock,
    ``,
    `CONFIRMED CROSS-BOOK PATTERNS — this client matches:`,
    patternBlock,
    ``,
    `Based ONLY on the interaction text and life events above, identify any signals that the client holds meaningful assets outside this firm. If no such signals exist in the text, return opportunitySignal: "none".`,
  ].join('\n');
}

// ── System prompt (mirrors WALLET_CAPTURE_SYSTEM in claudeClient.ts) ─────────

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

const SYSTEM = `You are a senior wealth management analyst identifying wallet capture opportunities — assets a client likely holds outside this firm.

TASK: Review the client's life events and interaction notes. Return the MOST CONSERVATIVE signal that the explicit text justifies.

━━━ SIGNAL DEFINITIONS — READ CAREFULLY ━━━

"strong" — use ONLY when ALL THREE conditions are met:
  (a) A named liquidity event appears in the life events: "Inheritance received", "Business sale", or equivalent explicit receipt of assets.
  (b) Interaction notes contain on-topic discussions that reference or follow up on that same specific event (e.g. "inheritance planning" interactions that follow an "Inheritance received" life event).
  (c) There is no indication the assets have already been consolidated at this firm.

"moderate" — use ONLY when there is a REAL but INCOMPLETE signal. Exactly two cases qualify:
  CASE 1: A life event from the LIQUIDITY EVENT LIST ONLY (see "strong" definition above: "Inheritance received", "Business sale", or equivalent explicit receipt of assets) is present, BUT interaction notes contain NO discussion referencing that specific event.
  CASE 2: Interaction notes contain the literal words "another advisor", "another account", "outside holdings", "held elsewhere", or a named competing institution — with or without a matching life event.
  Nothing else qualifies for "moderate". In particular, interaction TOPIC TAGS (e.g. "business exit planning", "property discussion") without a matching life event do NOT qualify — they record what was discussed, not what happened. A planning conversation is not evidence of an external asset.
  INELIGIBILITY RULE: If the only life events present are non-liquidity events from the blocklist below (Job change, New child, Business start, Health event, Property purchase, Child leaving home, Marriage, Bereavement, Divorce), this client is INELIGIBLE for "moderate" or "strong" regardless of interaction topic tags — return "none".

"none" — use when the text contains NO explicit signal of externally-held assets. This is the correct answer for:
  - "Job change" — does NOT imply an old 401(k) exists. That is speculation, not evidence.
  - "New child / dependent", "Marriage", "Health event", "Bereavement", "Child leaving home" — routine life administration, not liquidity events.
  - "Business start" — starting a business is NOT the same as selling one. No proceeds exist yet.
  - "Property purchase" — buying property consumes assets; it does not indicate assets held elsewhere.
  - "Divorce" alone — not evidence of outside assets unless the notes explicitly discuss a settlement or QDRO.
  - Interaction topic tags — "business exit planning", "estate planning", "property discussion", "inheritance planning" — without a matching life event confirming a completed transaction. A topic tag means a conversation happened. It does NOT mean a transaction occurred or that assets are held outside this firm.

━━━ TOPIC TAGS ARE NOT EVIDENCE ━━━
The interaction history uses structured topic tags like "business exit planning · positive — action taken". These tags record WHAT WAS DISCUSSED, not WHAT HAPPENED. "Action taken" means the advisor took a follow-up action (e.g. sent materials, scheduled a meeting) — it does NOT mean a business was sold or assets changed hands. Do not treat a planning topic as confirmation of a completed external-asset event.

━━━ CRITICAL ANTI-HALLUCINATION RULE ━━━
Do NOT infer that routine life events imply hidden assets. If you find yourself speculating about what MIGHT exist (e.g. "the client may have a 401(k) from their previous employer" or "the business exit planning discussions suggest a sale may be pending") rather than citing what the text explicitly states, you MUST return "none" instead. Inference is not evidence.

━━━ RULES ━━━
1. Cite specific text from the notes or life events as evidence. Quote or closely paraphrase the exact label or wording.
2. If no explicit signal exists, return "none". Do NOT upgrade to "moderate" or "strong" based on supposition.
3. suggestedAction: when signal is "none", write "No wallet capture action indicated at this time." When signal is "moderate" or "strong", reference the specific life event or text — never write generic "review portfolio" language.

Return valid JSON ONLY — no markdown, no prose before or after:
{"opportunitySignal":"<strong|moderate|none>","evidence":"<exact text cited, or 'No explicit external-asset signal found in interaction text or life events'>","suggestedAction":"<specific action or 'No wallet capture action indicated at this time'>"}
${COMPLIANCE_RULES}`;

// ── Runner ────────────────────────────────────────────────────────────────────

async function assess(clientId, expectedSignal) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ASSESSING: ${clientId}  (expected: ${expectedSignal})`);
  console.log('═'.repeat(70));

  const c      = buildClient(clientId);
  const today  = new Date();
  const prompt = buildWalletCapturePrompt(c, CONFIRMED_PATTERNS, today);

  const confidence = calculateWalletCaptureConfidence(c, CONFIRMED_PATTERNS);

  console.log('\n── CLIENT PROFILE ────────────────────────────────────────────');
  console.log(`  Name:             ${c.name}`);
  console.log(`  Life Stage:       ${c._lifeStage}`);
  console.log(`  AUM:              $${(c.aum / 1000).toFixed(0)}K`);
  console.log(`  Interactions 18m: ${c.contactStats?.totalInteractions18m}`);
  console.log(`  Life Events:      ${c.lifeEvents.map(e => `${e.description}(${e.date})`).join(', ')}`);

  console.log('\n── PROMPT SENT TO MODEL ──────────────────────────────────────');
  console.log(prompt);

  console.log(`\n── DETERMINISTIC CONFIDENCE: ${confidence.toUpperCase()} ────────────────────────`);
  console.log(`   interactions18m=${c.contactStats?.totalInteractions18m}  lifeEvents=${c.lifeEvents.length}`);
  console.log('\n── CALLING MODEL ─────────────────────────────────────────────');

  const response = await anthropic.messages.create({
    model:       MODEL,
    max_tokens:  1500,
    temperature: 0,
    system:      SYSTEM,
    messages:    [{ role: 'user', content: prompt }],
  });

  let raw = response.content[0]?.text ?? '';
  console.log('\n── RAW RESPONSE ──────────────────────────────────────────────');
  console.log(raw);

  let parsed;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    // Truncated — retry once with a conciseness instruction (mirrors app behaviour)
    console.log('\n⚠️  Response truncated — retrying with conciseness instruction…');
    const retryResponse = await anthropic.messages.create({
      model:       MODEL,
      max_tokens:  1500,
      temperature: 0,
      system:      SYSTEM,
      messages:    [{ role: 'user', content: prompt +
        '\n\nIMPORTANT: Your previous response was truncated. Respond with valid JSON only. ' +
        'Keep the "evidence" field to ONE sentence (≤25 words) citing only the single strongest signal.' }],
    });
    raw = retryResponse.content[0]?.text ?? '';
    console.log('\n── RETRY RAW RESPONSE ────────────────────────────────────────');
    console.log(raw);
  }

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object found after retry');
    parsed = JSON.parse(m[0]);
  } catch (e) {
    console.log(`\n❌ PARSE ERROR: ${e.message}`);
    return null;
  }

  // Inject deterministic confidence — never from the LLM
  parsed.confidence = confidence;

  const correct = parsed.opportunitySignal === expectedSignal;
  console.log('\n── PARSED RESULT ─────────────────────────────────────────────');
  console.log(`  opportunitySignal : ${parsed.opportunitySignal}  ${correct ? '✓ matches expected' : `✗ EXPECTED: ${expectedSignal}`}`);
  console.log(`  confidence        : ${parsed.confidence}  ← deterministic`);
  console.log(`  evidence          : ${parsed.evidence}`);
  console.log(`  suggestedAction   : ${parsed.suggestedAction}`);

  return { ...parsed, clientId, clientName: c.name, expected: expectedSignal, correct };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  console.log('Wallet Capture Assessment Agent — Test Run');
  console.log(`Model: ${MODEL}`);
  console.log('Dataset: public/data/ (150-client synthetic)');
  console.log('Signal clients: C0078 (Inheritance×2 + Business sale), C0064 (Inheritance received)');
  console.log('Truncation stress test: C0074 Chen Patel (83 interactions, Inheritance received)');
  console.log('No-signal clients: C0059 (Business start, no sale), C0042 (Job changes, routine only)');

  const tests = [
    { id: 'C0078', expected: 'strong'  },
    { id: 'C0064', expected: 'strong'  },
    { id: 'C0074', expected: 'strong'  }, // 83 interactions — truncation stress test
    { id: 'C0059', expected: 'none'    },
    { id: 'C0042', expected: 'none'    },
  ];

  const results = [];
  for (const { id, expected } of tests) {
    const r = await assess(id, expected);
    if (r) results.push(r);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('SUMMARY TABLE');
  console.log('═'.repeat(70));
  console.log(`${'Client'.padEnd(22)} ${'Signal'.padEnd(10)} ${'Conf'.padEnd(8)} ${'Match?'.padEnd(8)} Evidence (first 60 chars)`);
  console.log('-'.repeat(70));
  for (const r of results) {
    const label = `${r.clientId} ${r.clientName}`;
    console.log(
      `${label.padEnd(22)} ${(r.opportunitySignal ?? '').padEnd(10)} ${(r.confidence ?? '').padEnd(8)} ${(r.correct ? '✓' : `✗ exp:${r.expected}`).padEnd(8)} ${(r.evidence ?? '').slice(0, 60)}`
    );
  }
  const passed = results.filter(r => r.correct).length;
  console.log(`\nResult: ${passed}/${results.length} matched expected signal.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
