import type { Client, GoalType, ReferralRecord } from '../types';
import { differenceInDays, differenceInYears, parseISO } from 'date-fns';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;

type FilterOp = 'lt' | 'gt' | 'lte' | 'gte' | 'eq' | 'neq' | 'in';
type FilterValue = number | string | boolean | string[];

interface FilterCondition {
  field: string;
  op: FilterOp;
  value: FilterValue;
}

// Normalized per-client signal used by the validator (field names are the filterSpec contract)
interface ClientSignal {
  id: string;
  age: number;
  aum: number;
  aumTier: string;
  risk: string;
  daysSinceContact: number;
  portfolioDrift: number;
  offTrackGoals: number;
  overdueCommitments: number;
  unactionedLifeEvent: boolean;
  estateComplete: boolean;
  insuranceAdequate: boolean;
  lifeStage: string;
  tenure: number;
}

export interface PatternHypothesis {
  hypothesis: string;
  reasoning: string;
  dataPointsToCheck: string;
  filterSpec?: {
    segmentConditions: FilterCondition[];
    metricField: string;
    metricOp: FilterOp;
    metricValue: FilterValue;
  };
}

export interface ValidationResult {
  hypothesis: string;
  sampleSize: number;
  matchPercentage: number;
  comparisonBaselinePercentage: number;
  verdict: 'confirmed' | 'weak' | 'rejected' | 'invalid';
  invalidReason?: string;
  supportingClientIds: string[];
}

async function callClaude(systemPrompt: string, userContent: string, maxTokens: number = MAX_TOKENS, temperature: number = TEMPERATURE): Promise<string> {
  const apiKey = localStorage.getItem('claudeApiKey');
  if (!apiKey) throw new Error('No API key configured. Please add your Claude API key in Settings.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text ?? '';
}

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

const BRIEF_SYSTEM = `Format your response as clean plain text only. Do not use markdown. Do not use hyphens or dashes as section dividers. Do not use asterisks or underscores for emphasis. Do not use hash symbols for headings. Each section heading should be on its own line in ALL CAPS followed by a colon. Use numbered lists where appropriate. Separate sections with a single blank line.

You are an expert financial advisor assistant. Given the client data provided, generate a professional pre-meeting brief. Structure it with these exact sections in ALL CAPS: CLIENT SNAPSHOT, PORTFOLIO STATUS, GOAL PROGRESS, RELEVANT MARKET CONTEXT, SUGGESTED TALKING POINTS, OUTSTANDING ACTION ITEMS, WATCH OUT FOR. Be specific and data-driven. Reference actual numbers from the client data. Write concisely for a senior financial advisor who needs context quickly. Never give generic advice.
${COMPLIANCE_RULES}`;

const EXTRACTION_SYSTEM = `You are an expert financial advisor assistant. Extract and structure the following from these raw meeting notes: Meeting Summary (3–5 bullet points), Action Items (each with: description, assigned to FA or Client, suggested due date), Client Signals (emotional cues or concerns mentioned), Life Events (any personal or financial events disclosed), Follow-up Email Draft (short, warm, professional email summarising next steps). Return valid JSON only, no markdown.
${COMPLIANCE_RULES}`;

const SUGGESTIONS_SYSTEM = `You are an expert financial advisor assistant. Based on this client's financial profile, generate exactly 4 actionable suggestions the advisor should consider. Each suggestion must reference specific numbers from the client data. Each must have: category (one of: Portfolio, Goals, Tax, Relationship, Compliance), priority (High/Medium/Low), title (short), description (2–3 sentences, specific). Return valid JSON array only, no markdown.
${COMPLIANCE_RULES}`;

const NEWS_DRAFT_SYSTEM = `You are an expert financial advisor assistant. Draft a short, personalised client outreach message for a financial advisor to send to their client about the news item provided. The message should be warm, professional, specific to the client's situation, and suggest a next step (call, review, etc.). Keep it under 150 words. This is a draft for the advisor to review and personalise before sending.
${COMPLIANCE_RULES}`;

export async function generateBrief(clientData: string): Promise<string> {
  return callClaude(BRIEF_SYSTEM, `Generate a pre-meeting brief for this client:\n\n${clientData}`);
}

export async function extractMeetingNotes(notes: string): Promise<string> {
  return callClaude(EXTRACTION_SYSTEM, `Extract structured data from these meeting notes:\n\n${notes}`);
}

export async function generateSuggestions(clientData: string): Promise<string> {
  return callClaude(SUGGESTIONS_SYSTEM, `Generate 4 actionable suggestions for this client:\n\n${clientData}`);
}

export async function draftNewsMessage(newsItem: string, clientContext: string): Promise<string> {
  return callClaude(NEWS_DRAFT_SYSTEM, `News item:\n${newsItem}\n\nClient context:\n${clientContext}`);
}

function aumLabel(aum: number): string {
  if (aum < 500_000) return '<500K';
  if (aum < 1_000_000) return '500K-1M';
  if (aum < 2_000_000) return '1M-2M';
  return '>2M';
}

const HYPOTHESIS_SYSTEM = `You are a senior wealth management analyst examining an advisor's full client book.
Your task: propose CANDIDATE hypotheses about patterns that might exist across this book.
Do NOT validate — just surface plausible patterns worth investigating.
Focus on actionable cross-book themes: contact frequency, portfolio risk, life stage transitions, AUM tier behaviour, goal drift, household dynamics, attrition signals.
Return a JSON array ONLY — no markdown, no prose before or after.
Each element must have exactly these keys: "hypothesis", "reasoning", "dataPointsToCheck", "filterSpec".

filterSpec encodes the hypothesis as a machine-executable filter so it can be validated against real data:
{"segmentConditions":[{"field":"<field>","op":"<op>","value":<value>}],"metricField":"<field>","metricOp":"<op>","metricValue":<value>}
- segmentConditions (AND-ed): who is in the pattern group
- metricField/metricOp/metricValue: what signal is elevated in that group vs the rest of the book

Available field names (use EXACTLY these): age, aum, aumTier, risk, daysSinceContact, portfolioDrift, offTrackGoals, overdueCommitments, unactionedLifeEvent, estateComplete, insuranceAdequate, lifeStage, tenure
Ops: "lt","gt","lte","gte","eq","neq","in" (in takes a JSON array value)
The comparison operator key MUST be "op" — never "operator" or any other name.

EXACT VALID VALUES — you MUST use these verbatim in filterSpec; do not invent or paraphrase:
  aumTier  → "<500K" | "500K-1M" | "1M-2M" | ">2M"
  risk     → "conservative" | "moderate" | "growth" | "aggressive"
  lifeStage → "Accumulation" | "Pre-retirement" | "Retirement" | "Early career"
  Boolean fields (unactionedLifeEvent, estateComplete, insuranceAdequate) → true | false (not strings)
  Numeric fields (age, aum, daysSinceContact, portfolioDrift, offTrackGoals, overdueCommitments, tenure) → numbers

Example — "Short-tenure high-AUM clients tend to have unactioned life events":
"filterSpec":{"segmentConditions":[{"field":"tenure","op":"lt","value":3},{"field":"aumTier","op":"in","value":[">2M","1M-2M"]}],"metricField":"unactionedLifeEvent","metricOp":"eq","metricValue":true}

IMPORTANT: In "reasoning" cite at most 5 example client IDs, 2-3 sentences max.`;

async function parseHypotheses(raw: string, retryFn: () => Promise<string>): Promise<PatternHypothesis[]> {
  const tryParse = (text: string): PatternHypothesis[] | null => {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as PatternHypothesis[];
    } catch {
      return null;
    }
  };

  const result = tryParse(raw);
  if (result) return result;

  // Retry once with an explicit conciseness reminder
  const retried = await retryFn();
  const retryResult = tryParse(retried);
  if (retryResult) return retryResult;

  throw new Error(`Could not parse JSON from Claude response (even after retry):\n${retried}`);
}

export async function generatePatternHypotheses(clients: Client[]): Promise<PatternHypothesis[]> {
  const today = new Date();

  const digest = clients.map(c => {
    const dsc = differenceInDays(today, parseISO(c.lastContact));
    const retVsBm = +(c.oneYearReturn - c.benchmarkReturn).toFixed(1);
    const goalsOnTrackPct = c.goals.length > 0
      ? Math.round((c.goals.filter(g => g.onTrack).length / c.goals.length) * 100)
      : 100;
    const overdue = c.history.length > 0
      ? c.history.flatMap(h =>
          h.actionItems.filter(ai => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0)
        ).length
      : (c.contactStats?.openOverdueCommitments ?? 0);

    const parts = [
      c.id,
      `age:${c.age}`,
      `aum:${aumLabel(c.aum)}`,
      `risk:${c.riskProfile}`,
      `dsc:${dsc}d`,
      `ret_vs_bm:${retVsBm}%`,
      `goals_ok:${goalsOnTrackPct}%`,
      `overdue:${overdue}`,
      `life_events:${c.lifeEvents.length}`,
      `family:${c.familyMembers.length}`,
    ];
    if (c.contactStats) {
      parts.push(`i18m:${c.contactStats.totalInteractions18m}`);
      parts.push(`sentiment:${(+(c.contactStats.avgSentimentScore ?? 0)).toFixed(2)}`);
    }
    if (c.nbaData?.score != null) parts.push(`nba:${c.nbaData.score}`);
    return parts.join('|');
  }).join('\n');

  const userContent =
    `Full client book — ${clients.length} clients.\n` +
    `Row format: id|age|aum_tier|risk_profile|days_since_contact|ret_vs_benchmark|goals_on_track_%|overdue_items|life_event_count|family_count[|interactions_18m|avg_sentiment][|nba_score]\n\n` +
    digest +
    `\n\nPropose 5-8 candidate pattern hypotheses. Remember: cite at most 5 client IDs per reasoning field, 2-3 sentences max.`;

  const raw = await callClaude(HYPOTHESIS_SYSTEM, userContent, 3000);

  return parseHypotheses(raw, () =>
    callClaude(
      HYPOTHESIS_SYSTEM,
      userContent +
        '\n\nIMPORTANT: Your previous response was truncated. Be more concise — each "reasoning" field must be 1-2 sentences only and cite at most 3 client IDs. Return fewer hypotheses (5 max) if needed to fit.',
      3000,
    )
  );
}

// ── Attrition Assessment ──────────────────────────────────────────────────────

export type AttritionRiskCategory =
  | 'quiet disengagement'
  | 'dissatisfaction'
  | 'busy but stable'
  | 'no concern';

export interface AttritionAssessment {
  riskCategory: AttritionRiskCategory;
  reasoning: string;
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Confirmed pattern with its filterSpec attached — zip hypotheses + confirmed results before passing in */
export interface ConfirmedPatternWithSpec {
  hypothesis: string;
  matchPercentage: number;
  comparisonBaselinePercentage: number;
  sampleSize: number;
  filterSpec?: PatternHypothesis['filterSpec'];
}

const ATTRITION_SYSTEM = `You are an experienced wealth management analyst assessing a single client's attrition risk for their advisor.

Classify the client into EXACTLY ONE of these four risk categories:
- "quiet disengagement" — gradual drift away: long contact gap, declining engagement, no complaints surfaced, no obvious crisis — client is simply fading
- "dissatisfaction" — active dissatisfaction signals: complaints raised, client-initiated concerns, negative interaction outcomes, unresolved issues
- "busy but stable" — contact gap exists but client appears retained: strong portfolio, positive tone when contacted, long tenure, high engagement history
- "no concern" — recently engaged, positive signals across the board, no meaningful attrition indicators

Weigh THREE layers in order:
1. DETERMINISTIC SIGNALS: health score sub-scores (recency, portfolio, goals, action items), contact frequency trend, portfolio drift, goal on-track rate
2. QUALITATIVE: tone and content of interaction notes — complaints, concerns, positive reinforcement, whether contact is advisor- or client-initiated, topics raised
3. BOOK CONTEXT: confirmed cross-book patterns this client matches — these are statistically validated across the full book, so if this client fits a pattern segment, treat it as a real signal

IMPORTANT: "busy but stable" requires positive evidence of stability (long tenure, recent positive interactions when contacted, strong portfolio) — do not default to it just because there are no complaints.

Return valid JSON ONLY — no markdown, no prose before or after:
{"riskCategory":"<one of the four exact strings>","reasoning":"<2-4 sentences, cite specific numbers and interaction evidence>","suggestedAction":"<concrete, specific next step — not generic>"}`;

/**
 * Deterministic confidence calculation — runs before the LLM call so confidence
 * is never self-reported by the model (which always returns "high" regardless).
 *
 * Rules:
 *   low    — ≤1 interaction: almost no data to judge from
 *   medium — 2–4 interactions (thin history), OR 5–14 interactions with mixed/borderline signals
 *   high   — ≥15 interactions (rich data), OR 5–14 with coherent signals pointing the same way
 */
export function calculateAttritionConfidence(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
): 'high' | 'medium' | 'low' {
  const interactions18m = client.contactStats?.totalInteractions18m ?? client.history.length;

  if (interactions18m <= 1) return 'low';
  if (interactions18m <= 4) return 'medium';
  if (interactions18m >= 15) return 'high';

  // 5–14 interactions: check whether signals are coherent
  const today = new Date();
  const dsc = differenceInDays(today, parseISO(client.lastContact));
  const maxDrift = client.allocation.length > 0
    ? Math.max(...client.allocation.map(a => Math.abs(a.current - a.target)))
    : 0;
  const onTrack     = client.goals.filter(g => g.onTrack).length;
  const overdueCount = client.contactStats?.openOverdueCommitments ?? 0;

  const recency     = dsc <= 30 ? 25 : dsc <= 60 ? 17 : dsc <= 90 ? 8 : 0;
  const portHealth  = maxDrift <= 3 ? 25 : maxDrift <= 6 ? 17 : maxDrift <= 10 ? 8 : 0;
  const goalScore   = client.goals.length > 0 ? Math.round((onTrack / client.goals.length) * 25) : 25;
  const actionScore = overdueCount === 0 ? 25 : overdueCount === 1 ? 17 : overdueCount === 2 ? 8 : 0;
  const healthTotal = recency + portHealth + goalScore + actionScore;

  const signal = normalizeClient(client, today);
  const hasPatternMatch = confirmedPatterns.some(p =>
    p.filterSpec?.segmentConditions?.every(c => applyCondition(signal, c))
  );

  // Mixed: contact recency and portfolio health point in opposite directions
  const mixedSignals = (recency >= 17 && portHealth <= 8) || (recency <= 8 && portHealth >= 17);

  // Borderline: within 8 points of a band threshold (50 = RED/AMBER, 75 = AMBER/GREEN)
  const isBorderline = Math.abs(healthTotal - 50) < 8 || Math.abs(healthTotal - 75) < 8;

  if (hasPatternMatch && !mixedSignals) return 'high';
  if (!isBorderline && !mixedSignals) return 'high';
  return 'medium';
}

// ── Shared narrative context ──────────────────────────────────────────────────
//
// Returns the formatted building blocks that are genuinely shared between
// buildAttritionPrompt and buildWalletCapturePrompt:
//   • lifeStage / tenure — identical formula in both
//   • lifeEventBlock     — individual bullet list used by wallet capture;
//                          attrition keeps its own inline count in the PORTFOLIO section
//   • historyBlock       — full history, multi-line with open action items (wallet capture
//                          format); attrition uses a separate last-8 single-line slice below
//   • matchedPatterns    — pattern-filter computation is identical; each builder formats
//                          the resulting patternBlock differently (attrition adds ratio)
//
interface ClientNarrativeContext {
  lifeStage: string;
  tenure: number;
  lifeEventBlock: string;
  historyBlock: string;
  matchedPatterns: ConfirmedPatternWithSpec[];
}

function formatClientNarrativeContext(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
  today: Date,
): ClientNarrativeContext {
  const lifeStage = client.age >= 65 ? 'Retirement'
    : client.age >= 50 ? 'Pre-retirement'
    : client.age >= 40 ? 'Accumulation'
    : 'Early career';

  const tenure = Math.max(0, differenceInYears(today, parseISO(client.clientSince)));

  const lifeEventBlock = client.lifeEvents.length > 0
    ? client.lifeEvents.map(e => `  - [${e.date}] ${e.description}`).join('\n')
    : '  None on file.';

  const sortedHistory = [...client.history].sort((a, b) => a.date.localeCompare(b.date));
  const historyBlock = sortedHistory.length > 0
    ? sortedHistory.map(h => {
        const openItems = h.actionItems.filter(ai => !ai.completed);
        const itemLine = openItems.length > 0
          ? `\n    Open action items: ${openItems.map(ai => ai.description).join('; ')}`
          : '';
        return `  ${h.date} [${h.type}]\n    ${h.summary}${itemLine}`;
      }).join('\n\n')
    : '  No interaction history.';

  const signal = normalizeClient(client, today);
  const matchedPatterns = confirmedPatterns.filter(p =>
    p.filterSpec?.segmentConditions?.every(c => applyCondition(signal, c))
  );

  return { lifeStage, tenure, lifeEventBlock, historyBlock, matchedPatterns };
}

// ─────────────────────────────────────────────────────────────────────────────

function buildAttritionPrompt(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
  today: Date,
): string {
  const { lifeStage, tenure, matchedPatterns } =
    formatClientNarrativeContext(client, confirmedPatterns, today);

  // ── Health score sub-scores (inline — avoids circular dep) ─────────────────
  const dsc = differenceInDays(today, parseISO(client.lastContact));
  const recency = dsc <= 30 ? 25 : dsc <= 60 ? 17 : dsc <= 90 ? 8 : 0;

  const maxDrift = client.allocation.length > 0
    ? Math.max(...client.allocation.map(a => Math.abs(a.current - a.target)))
    : 0;
  const portfolioHealth = maxDrift <= 3 ? 25 : maxDrift <= 6 ? 17 : maxDrift <= 10 ? 8 : 0;

  const onTrack = client.goals.filter(g => g.onTrack).length;
  const goalProgress = client.goals.length > 0 ? Math.round((onTrack / client.goals.length) * 25) : 25;

  const overdueCount = client.history.length > 0
    ? client.history.flatMap(h =>
        h.actionItems.filter(ai => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0)
      ).length
    : (client.contactStats?.openOverdueCommitments ?? 0);
  const actionItemScore = overdueCount === 0 ? 25 : overdueCount === 1 ? 17 : overdueCount === 2 ? 8 : 0;
  const healthTotal = recency + portfolioHealth + goalProgress + actionItemScore;
  const healthColor = healthTotal < 50 ? 'RED' : healthTotal < 75 ? 'AMBER' : 'GREEN';

  // ── Interaction history (last 8, single-line — intentionally narrower than wallet capture) ──
  const recentHistory = [...client.history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8);

  const historyBlock = recentHistory.length > 0
    ? recentHistory.map(h => `  ${h.date} [${h.type}] ${h.summary}`).join('\n')
    : '  No interaction history loaded.';

  // ── Pattern block (attrition includes ratio; wallet capture omits it) ───────
  const patternBlock = matchedPatterns.length > 0
    ? matchedPatterns.map(p => {
        const ratio = p.comparisonBaselinePercentage > 0
          ? (p.matchPercentage / p.comparisonBaselinePercentage).toFixed(2) + 'x'
          : '∞';
        return `  - "${p.hypothesis}" (match=${p.matchPercentage}%, baseline=${p.comparisonBaselinePercentage}%, ratio=${ratio}, n=${p.sampleSize})`;
      }).join('\n')
    : '  None — this client does not match any confirmed pattern segments.';

  return [
    `CLIENT: ${client.name} (${client.id})`,
    `Age: ${client.age} | Life Stage: ${lifeStage} | AUM: $${(client.aum / 1_000_000).toFixed(2)}M | Tenure: ${tenure.toFixed(1)}yr`,
    `Risk Profile: ${client.riskProfile}`,
    ``,
    `HEALTH SCORE: ${healthTotal}/100 (${healthColor})`,
    `  Recency (contact):  ${recency}/25  (${dsc} days since last contact)`,
    `  Portfolio health:   ${portfolioHealth}/25  (max drift ${maxDrift.toFixed(1)}%)`,
    `  Goal progress:      ${goalProgress}/25  (${onTrack}/${client.goals.length} goals on track)`,
    `  Action items:       ${actionItemScore}/25  (${overdueCount} overdue)`,
    ``,
    `CONTACT STATS (aggregate):`,
    `  Total interactions (18m): ${client.contactStats?.totalInteractions18m ?? 'n/a'}`,
    `  Avg sentiment score (0=neg, 1=pos): ${(+(client.contactStats?.avgSentimentScore ?? 0)).toFixed(2)}`,
    `  Open overdue commitments: ${client.contactStats?.openOverdueCommitments ?? 0}`,
    ``,
    `PORTFOLIO: 1yr return ${client.oneYearReturn ?? 0}% vs benchmark ${client.benchmarkReturn ?? 0}% (delta: ${((client.oneYearReturn ?? 0) - (client.benchmarkReturn ?? 0)).toFixed(1)}%)`,
    `  Life events on file: ${client.lifeEvents.length} | Unactioned: ${client.lifeEvents.length > 0 ? 'possibly' : 'no'}`,
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

/** Returns which confirmed patterns the given client currently matches. */
export function getMatchedPatterns(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
): ConfirmedPatternWithSpec[] {
  const today = new Date();
  const signal = normalizeClient(client, today);
  return confirmedPatterns.filter(p =>
    p.filterSpec?.segmentConditions?.every(c => applyCondition(signal, c))
  );
}

export async function generateAttritionAssessment(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
): Promise<AttritionAssessment> {
  const today = new Date();
  const confidence = calculateAttritionConfidence(client, confirmedPatterns);
  const userContent = buildAttritionPrompt(client, confirmedPatterns, today);
  const raw = await callClaude(ATTRITION_SYSTEM, userContent, 500);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in attrition response:\n${raw}`);

  const { riskCategory, reasoning, suggestedAction } = JSON.parse(match[0]);
  return { riskCategory, reasoning, suggestedAction, confidence };
}

// ── Wallet Capture Assessment ─────────────────────────────────────────────────

export type WalletCaptureOpportunitySignal = 'strong' | 'moderate' | 'none';

export interface WalletCaptureAssessment {
  opportunitySignal: WalletCaptureOpportunitySignal;
  evidence: string;
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
}

const WALLET_CAPTURE_SYSTEM = `You are a senior wealth management analyst identifying wallet capture opportunities — assets a client likely holds outside this firm.

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

/**
 * Deterministic confidence for wallet capture — never LLM self-reported.
 * Measures richness of available textual evidence the LLM can work from:
 *   low    — ≤1 interaction and no life events: almost nothing to assess
 *   medium — some data but thin (2–4 interactions, ≤1 life event, no pattern match)
 *   high   — ≥5 interactions, OR ≥2 life events, OR a confirmed pattern match in context
 */
export function calculateWalletCaptureConfidence(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
): 'high' | 'medium' | 'low' {
  const interactions18m = client.contactStats?.totalInteractions18m ?? client.history.length;
  const lifeEventCount = client.lifeEvents.length;

  if (interactions18m <= 1 && lifeEventCount === 0) return 'low';

  const today = new Date();
  const signal = normalizeClient(client, today);
  const hasPatternMatch = confirmedPatterns.some(p =>
    p.filterSpec?.segmentConditions?.every(c => applyCondition(signal, c))
  );

  if (interactions18m >= 5 || lifeEventCount >= 2 || hasPatternMatch) return 'high';

  return 'medium';
}

function buildWalletCapturePrompt(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
  today: Date,
): string {
  const { lifeStage, tenure, lifeEventBlock, historyBlock, matchedPatterns } =
    formatClientNarrativeContext(client, confirmedPatterns, today);

  const patternBlock = matchedPatterns.length > 0
    ? matchedPatterns.map(p => `  - "${p.hypothesis}" (${p.matchPercentage}% vs ${p.comparisonBaselinePercentage}% baseline, n=${p.sampleSize})`).join('\n')
    : '  None.';

  return [
    `CLIENT: ${client.name} (${client.id})`,
    `Age: ${client.age} | Life Stage: ${lifeStage} | AUM at firm: $${(client.aum / 1_000_000).toFixed(3)}M | Tenure: ${tenure.toFixed(1)}yr`,
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

// Appended on retry to force a shorter evidence field and prevent truncation.
const WALLET_CAPTURE_CONCISE_SUFFIX =
  '\n\nIMPORTANT: Your previous response was truncated. Respond with valid JSON only. ' +
  'Keep the "evidence" field to ONE sentence (≤25 words) citing only the single strongest signal.';

export async function generateWalletCaptureAssessment(
  client: Client,
  confirmedPatterns: ConfirmedPatternWithSpec[],
): Promise<WalletCaptureAssessment> {
  const today = new Date();
  const confidence = calculateWalletCaptureConfidence(client, confirmedPatterns);
  const userContent = buildWalletCapturePrompt(client, confirmedPatterns, today);

  // Clients with extensive interaction histories (50+ entries) can produce evidence
  // citations that overflow a low token limit. 1500 tokens provides headroom for even
  // the largest books; the typical response is well under 300 tokens.
  const raw = await callClaude(WALLET_CAPTURE_SYSTEM, userContent, 1500, 0);
  const match = raw.match(/\{[\s\S]*\}/);

  if (!match) {
    // Response was truncated before the JSON closed — retry once with an explicit
    // instruction to keep the evidence field concise.
    console.warn(`[AdvisorIQ] Wallet capture truncated for ${client.id} — retrying with conciseness instruction.`);
    const retryContent = userContent + WALLET_CAPTURE_CONCISE_SUFFIX;
    const retryRaw = await callClaude(WALLET_CAPTURE_SYSTEM, retryContent, 1500, 0);
    const retryMatch = retryRaw.match(/\{[\s\S]*\}/);
    if (!retryMatch) throw new Error(`Wallet capture response truncated twice for ${client.id}:\n${retryRaw}`);
    const { opportunitySignal, evidence, suggestedAction } = JSON.parse(retryMatch[0]);
    return { opportunitySignal, evidence, suggestedAction, confidence };
  }

  const { opportunitySignal, evidence, suggestedAction } = JSON.parse(match[0]);
  return { opportunitySignal, evidence, suggestedAction, confidence };
}

// ── Cross-Sell / Upsell Assessment ───────────────────────────────────────────

export type CrossSellOpportunitySignal = 'high' | 'moderate' | 'low' | 'none';

export interface CrossSellGap {
  productType: string;
  reason: 'goal_gap' | 'flagged_gap';
  goalType?: string;
}

export interface CrossSellAssessment {
  opportunitySignal: CrossSellOpportunitySignal;
  gapProducts: string[];
  evidence: string;
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
}

// Hardcoded goal → product mapping — never resolved by an LLM call.
const GOAL_PRODUCT_MAP: Partial<Record<GoalType, string[]>> = {
  'Estate':            ['estate_plan', 'trust'],
  'Retirement Income': ['tax_wrapper_pension'],
  'Income Protection': ['insurance_protection'],
  'Property Purchase': ['mortgage'],
  'Education':         ['tax_wrapper_isa'],
  'Business Exit':     ['equity_portfolio'],
  'Charitable Giving': ['trust'],
  'Emergency Fund':    ['cash_savings'],
};

/** Deterministic gap detection — no LLM involved. */
export function detectCrossSellGaps(client: Client): CrossSellGap[] {
  const holdings = client.productHoldings ?? [];
  if (holdings.length === 0) return [];

  const holdingMap = new Map(holdings.map(h => [h.productType, h]));
  const gaps: CrossSellGap[] = [];
  const seen = new Set<string>();

  // Primary: goal-aligned gaps — gated on flaggedAsGap, not merely !held.
  // The practice management system's curated flag is a stronger, less noisy signal.
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

  // Secondary: data-flagged gaps not captured by goal alignment above
  for (const h of holdings) {
    if (!seen.has(h.productType) && h.flaggedAsGap) {
      gaps.push({ productType: h.productType, reason: 'flagged_gap' });
      seen.add(h.productType);
    }
  }

  return gaps;
}

export function calculateCrossSellConfidence(
  client: Client,
  gaps: CrossSellGap[],
): 'high' | 'medium' | 'low' {
  if (gaps.length === 0) return 'low';

  const interactions18m = client.contactStats?.totalInteractions18m ?? client.history.length;
  const goalGaps = gaps.filter(g => g.reason === 'goal_gap');
  const today = new Date();
  const dsc = differenceInDays(today, parseISO(client.lastContact));

  // Only count a goal as "off-track" for B2 if it's the same goal that produced the gap.
  // Using any off-track goal on the client would inflate confidence when the off-track goal
  // is unrelated to the specific product gap being scored.
  const goalGapOffTrack = goalGaps.some(
    g => client.goals.find(goal => goal.type === g.goalType)?.onTrack === false,
  );

  if (goalGaps.length >= 2 && interactions18m >= 3) return 'high';
  if (goalGaps.length >= 1 && interactions18m >= 5 && (goalGapOffTrack || dsc <= 60)) return 'high';
  if (gaps.length >= 2 && interactions18m >= 3) return 'medium';
  if (gaps.length >= 1 && interactions18m >= 1) return 'medium';
  return 'low';
}

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

function buildCrossSellPrompt(client: Client, gaps: CrossSellGap[], today: Date): string {
  const { lifeStage, tenure, lifeEventBlock, historyBlock } =
    formatClientNarrativeContext(client, [], today);

  const goalsBlock = client.goals.length > 0
    ? client.goals.map(g => `  - ${g.type}: target $${(g.targetAmount / 1_000).toFixed(0)}K by ${g.targetDate} | on track: ${g.onTrack}`).join('\n')
    : '  No goals on file.';

  const gapsBlock = gaps.length > 0
    ? gaps.map(g => {
        const label = g.reason === 'goal_gap'
          ? `${g.productType} (goal-aligned: ${g.goalType})`
          : `${g.productType} (practice-flagged gap)`;
        return `  - ${label}`;
      }).join('\n')
    : '  None — no product gaps detected.';

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

export async function generateCrossSellAssessment(client: Client): Promise<CrossSellAssessment> {
  const today = new Date();
  const gaps = detectCrossSellGaps(client);
  const confidence = calculateCrossSellConfidence(client, gaps);

  if (gaps.length === 0) {
    return {
      opportunitySignal: 'none',
      gapProducts: [],
      evidence: 'No product gaps detected for this client.',
      suggestedAction: 'No cross-sell action required at this time.',
      confidence,
    };
  }

  const userContent = buildCrossSellPrompt(client, gaps, today);
  const raw = await callClaude(CROSS_SELL_SYSTEM, userContent, 1000, 0);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in cross-sell response for ${client.id}:\n${raw}`);

  const { opportunitySignal, gapProducts, evidence, suggestedAction } = JSON.parse(match[0]);
  return { opportunitySignal, gapProducts: gapProducts ?? [], evidence, suggestedAction, confidence };
}

// ── Referral / Acquisition Assessment ────────────────────────────────────────

export type ReferralSignal = 'high' | 'moderate' | 'low' | 'none';

export interface ReferralAssessment {
  referralSignal: ReferralSignal;
  conversionLikelihood: 'high' | 'moderate' | 'low';
  evidence: string;
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
  recencyTier: 'active' | 'historical' | 'none';
}

export function calculateReferralConfidence(
  referralHistory: ReferralRecord[],
): { confidence: 'high' | 'medium' | 'low'; recencyTier: 'active' | 'historical' | 'none' } {
  if (referralHistory.length === 0) return { confidence: 'low', recencyTier: 'none' };

  const today = new Date();
  const ACTIVE_THRESHOLD_DAYS = 730;

  const active = referralHistory.filter(r => {
    const days = differenceInDays(today, parseISO(r.referralDate));
    return days <= ACTIVE_THRESHOLD_DAYS;
  });
  const historical = referralHistory.filter(r => {
    const days = differenceInDays(today, parseISO(r.referralDate));
    return days > ACTIVE_THRESHOLD_DAYS;
  });

  const recencyTier: 'active' | 'historical' | 'none' =
    active.length > 0 ? 'active' : historical.length > 0 ? 'historical' : 'none';

  if (active.length >= 2) return { confidence: 'high', recencyTier };
  if (active.length >= 1 && active.some(r => r.converted)) return { confidence: 'high', recencyTier };
  if (active.length >= 1) return { confidence: 'medium', recencyTier };
  if (historical.some(r => r.converted)) return { confidence: 'medium', recencyTier };
  return { confidence: 'low', recencyTier };
}

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

function buildReferralPrompt(
  client: Client,
  today: Date,
): string {
  const { lifeStage, tenure, lifeEventBlock, historyBlock } =
    formatClientNarrativeContext(client, [], today);

  const refs = client.referralHistory ?? [];
  const ACTIVE_THRESHOLD_DAYS = 730;

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

export async function generateReferralAssessment(client: Client): Promise<ReferralAssessment> {
  const refs = client.referralHistory ?? [];

  if (refs.length === 0) {
    return {
      referralSignal: 'none',
      conversionLikelihood: 'low',
      evidence: 'No verified referral history for this client.',
      suggestedAction: 'No referral action warranted — client has no prior referral history.',
      confidence: 'low',
      recencyTier: 'none',
    };
  }

  const today = new Date();
  const { confidence, recencyTier } = calculateReferralConfidence(refs);

  const userContent = buildReferralPrompt(client, today);
  const raw = await callClaude(REFERRAL_SYSTEM, userContent, 800, 0);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in referral response for ${client.id}:\n${raw}`);

  const { referralSignal, conversionLikelihood, evidence, suggestedAction } = JSON.parse(match[0]);
  return { referralSignal, conversionLikelihood, evidence, suggestedAction, confidence, recencyTier };
}

// ── Synthesizer types ─────────────────────────────────────────────────────────

export interface SynthesisFinding {
  title: string;
  evidence: string;
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SynthesisResult {
  headline: string;
  findings: SynthesisFinding[];
  watchlist: string[];
  summary: string;
}

// ── Validator ─────────────────────────────────────────────────────────────────

function normalizeClient(c: Client, today: Date): ClientSignal {
  const overdueItems = c.history.length > 0
    ? c.history.flatMap(h =>
        h.actionItems.filter(ai => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0)
      ).length
    : (c.contactStats?.openOverdueCommitments ?? 0);

  return {
    id: c.id,
    age: c.age,
    aum: c.aum,
    aumTier: aumLabel(c.aum),
    risk: c.riskProfile.toLowerCase(),
    daysSinceContact: differenceInDays(today, parseISO(c.lastContact)),
    portfolioDrift: c.allocation.length > 0
      ? Math.max(...c.allocation.map(a => Math.abs(a.current - a.target)))
      : 0,
    offTrackGoals: c.goals.filter(g => !g.onTrack).length,
    overdueCommitments: overdueItems,
    unactionedLifeEvent: c.lifeEvents.length > 0,
    estateComplete: (c.estatePlan?.documents ?? []).length > 0 &&
      c.estatePlan!.documents.every(d => d.status === 'In Place'),
    insuranceAdequate: (c.insurance ?? []).length > 0 &&
      c.insurance!.every(i => i.status === 'In Place'),
    lifeStage: c.age >= 65 ? 'Retirement' : c.age >= 50 ? 'Pre-retirement' : c.age >= 40 ? 'Accumulation' : 'Early career',
    tenure: Math.max(0, differenceInYears(today, parseISO(c.clientSince))),
  };
}

function applyCondition(signal: ClientSignal, cond: FilterCondition): boolean {
  const v = signal[cond.field as keyof ClientSignal];
  const cv = cond.value;
  switch (cond.op) {
    case 'lt':  return (v as number) < (cv as number);
    case 'gt':  return (v as number) > (cv as number);
    case 'lte': return (v as number) <= (cv as number);
    case 'gte': return (v as number) >= (cv as number);
    case 'eq':  return v === cv;
    case 'neq': return v !== cv;
    case 'in':  return (cv as string[]).includes(String(v));
    default:    return false;
  }
}

// Categorical fields where the value must exist in the actual dataset
const CATEGORICAL_FIELDS = new Set(['aumTier', 'risk', 'lifeStage']);

function buildValidValueSets(signals: ClientSignal[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const field of CATEGORICAL_FIELDS) {
    map.set(field, new Set(signals.map(s => String(s[field as keyof ClientSignal]))));
  }
  return map;
}

function checkFilterSpecValues(
  filterSpec: PatternHypothesis['filterSpec'],
  validValues: Map<string, Set<string>>,
): string | null {
  if (!filterSpec) return null;
  const allConds: FilterCondition[] = [
    ...filterSpec.segmentConditions,
    { field: filterSpec.metricField, op: filterSpec.metricOp, value: filterSpec.metricValue },
  ];
  for (const cond of allConds) {
    const validSet = validValues.get(cond.field);
    if (!validSet) continue; // numeric or boolean field — skip
    if (cond.op === 'eq' || cond.op === 'neq') {
      if (!validSet.has(String(cond.value))) {
        return `field "${cond.field}" value "${cond.value}" not in dataset (valid: ${[...validSet].join(', ')})`;
      }
    }
    if (cond.op === 'in') {
      const bad = (cond.value as string[]).filter(v => !validSet.has(v));
      if (bad.length > 0) {
        return `field "${cond.field}" unknown values [${bad.join(', ')}] (valid: ${[...validSet].join(', ')})`;
      }
    }
  }
  return null;
}

export function validatePatternHypotheses(
  hypotheses: PatternHypothesis[],
  clients: Client[],
): ValidationResult[] {
  const today = new Date();
  const signals = clients.map(c => normalizeClient(c, today));
  const validValues = buildValidValueSets(signals);

  return hypotheses.map(h => {
    const base: ValidationResult = {
      hypothesis: h.hypothesis,
      sampleSize: 0,
      matchPercentage: 0,
      comparisonBaselinePercentage: 0,
      verdict: 'weak',
      supportingClientIds: [],
    };

    if (!h.filterSpec || h.filterSpec.segmentConditions.length === 0) return base;

    // Pre-check: catch invalid categorical values before running stats
    const invalidReason = checkFilterSpecValues(h.filterSpec, validValues);
    if (invalidReason) {
      return { ...base, verdict: 'invalid', invalidReason };
    }

    const { segmentConditions, metricField, metricOp, metricValue } = h.filterSpec;
    const metricCond: FilterCondition = { field: metricField, op: metricOp, value: metricValue };

    const inGroup  = signals.filter(s => segmentConditions.every(c => applyCondition(s, c)));
    const outGroup = signals.filter(s => !segmentConditions.every(c => applyCondition(s, c)));

    if (inGroup.length === 0) return { ...base, verdict: 'rejected' };

    const groupMatches = inGroup.filter(s => applyCondition(s, metricCond));
    const baseMatches  = outGroup.filter(s => applyCondition(s, metricCond));

    const matchPct    = (groupMatches.length / inGroup.length) * 100;
    const baselinePct = outGroup.length > 0 ? (baseMatches.length / outGroup.length) * 100 : 0;
    const ratio       = baselinePct > 0 ? matchPct / baselinePct : (matchPct > 0 ? Infinity : 0);

    let verdict: 'confirmed' | 'weak' | 'rejected';
    if (inGroup.length >= 5 && ratio >= 1.5) {
      verdict = 'confirmed';
    } else if (ratio > 1.0 || inGroup.length < 5) {
      verdict = 'weak';
    } else {
      verdict = 'rejected';
    }

    return {
      hypothesis: h.hypothesis,
      sampleSize: inGroup.length,
      matchPercentage:              Math.round(matchPct    * 10) / 10,
      comparisonBaselinePercentage: Math.round(baselinePct * 10) / 10,
      verdict,
      supportingClientIds: groupMatches.map(s => s.id),
    };
  });
}

// ── Synthesizer ───────────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM = `You are an expert financial advisor assistant synthesising statistical findings from a cross-book pattern analysis into advisor-facing language.

RULES:
1. Every "confirmed" finding provided MUST appear in the "findings" array — do not omit any.
2. Cite the exact statistics given (match%, baseline%, ratio, n). Do not round or restate differently.
3. If n < 20 for a finding, say "based on [n] clients" explicitly in the evidence string.
4. For "weak — close to threshold" items: include up to 2 as short watchlist sentences only. No statistics claims, no recommended action. Omit the rest.
5. Do NOT mention rejected, thin-sample, or invalid hypotheses at all.
6. confidence must be: "high" if n >= 30 AND ratio >= 2.0x; "medium" if n >= 15 OR ratio >= 1.7x; "low" otherwise.
7. suggestedAction must be a specific next step for advisor review — frame as "Consider..." or "Review..." never as a directive.
8. headline: one sentence capturing the most important confirmed finding, or "No strong cross-book patterns confirmed in this analysis" if none.
9. summary: must include the exact tested and confirmed counts, e.g. "Tested 7 hypotheses across the client book; 2 confirmed with strong statistical evidence."
10. Return valid JSON ONLY — no markdown fences, no prose before or after.

EXACT OUTPUT SCHEMA — you MUST use these exact field names and structure. Do not rename, paraphrase, or restructure any field:
{
  "headline": "<string>",
  "findings": [
    {
      "title": "<short plain-English title for this finding>",
      "evidence": "<exact statistics: match%, baseline%, ratio, n>",
      "suggestedAction": "<specific next step framed as Consider... or Review...>",
      "confidence": "<must be exactly one of: high | medium | low>"
    }
  ],
  "watchlist": ["<short sentence>"],
  "summary": "<string>"
}
CRITICAL: "confidence" MUST be present on EVERY individual finding object inside the "findings" array. It must NEVER appear only at the top level. Every finding object must have all four fields: title, evidence, suggestedAction, confidence.
${COMPLIANCE_RULES}`;

function buildSynthesisPrompt(_hypotheses: PatternHypothesis[], results: ValidationResult[]): string {
  const total = results.length;

  const confirmed = results.filter(r => r.verdict === 'confirmed');
  const weak      = results.filter(r => r.verdict === 'weak');
  const excluded  = results.filter(r => r.verdict === 'rejected' || r.verdict === 'invalid');

  const weakClose = weak.filter(r => {
    const ratio = r.comparisonBaselinePercentage > 0
      ? r.matchPercentage / r.comparisonBaselinePercentage : 0;
    return ratio >= 1.2 && r.sampleSize >= 5;
  });

  const lines: string[] = [`ANALYSIS SCOPE: ${total} hypotheses tested.\n`];

  if (confirmed.length === 0) {
    lines.push('CONFIRMED FINDINGS: None met the threshold (ratio >= 1.5x, n >= 5).\n');
  } else {
    lines.push('CONFIRMED FINDINGS (all must appear in "findings" output):');
    confirmed.forEach((r, i) => {
      const ratio = r.comparisonBaselinePercentage > 0
        ? (r.matchPercentage / r.comparisonBaselinePercentage).toFixed(2) + 'x'
        : '∞';
      lines.push(`${i + 1}. ${r.hypothesis}`);
      lines.push(`   match=${r.matchPercentage}%, baseline=${r.comparisonBaselinePercentage}%, ratio=${ratio}, n=${r.sampleSize}`);
    });
    lines.push('');
  }

  if (weakClose.length > 0) {
    lines.push('WEAK — CLOSE TO THRESHOLD (ratio 1.2x–1.49x, n >= 5; include up to 2 in "watchlist" only, no statistics claims, no recommended action):');
    weakClose.slice(0, 3).forEach((r, i) => {
      const ratio = r.comparisonBaselinePercentage > 0
        ? (r.matchPercentage / r.comparisonBaselinePercentage).toFixed(2) + 'x'
        : '?';
      lines.push(`${i + 1}. ${r.hypothesis} (ratio=${ratio}, n=${r.sampleSize})`);
    });
    lines.push('');
  }

  lines.push(
    `EXCLUDED: ${excluded.length + (weak.length - weakClose.length)} hypotheses had no meaningful signal, thin samples, or invalid filter specs — do NOT mention these.`,
    '',
    `Generate the synthesis. The "summary" must state: "Tested ${total} hypotheses across the client book; ${confirmed.length} confirmed with strong statistical evidence${confirmed.length === 0 ? '' : ', others did not meet the bar'}."`
  );

  return lines.join('\n');
}

export async function synthesizePatternFindings(
  hypotheses: PatternHypothesis[],
  results: ValidationResult[],
): Promise<SynthesisResult> {
  const userContent = buildSynthesisPrompt(hypotheses, results);
  const raw = await callClaude(SYNTHESIS_SYSTEM, userContent, 1500);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object in synthesis response:\n${raw}`);

  return JSON.parse(match[0]) as SynthesisResult;
}

// ── Book of Work ──────────────────────────────────────────────────────────────

/**
 * Curated 20-client subset for the Book of Work demo.
 * Selection criteria:
 *   - 4 high attrition signals (C0089 attrScore:7, C0142 attrScore:6, C0103 overdue+long gap, C0085 overdue)
 *   - 4 strong wallet capture candidates (C0078, C0014, C0018, C0008 — all have liquidity life events)
 *   - 3 overlap clients (both attrition + wallet capture signals: C0067, C0041, C0051)
 *   - 3 rich-data / high-AUM (C0055 $26M, C0126 $22M, C0150 $15M)
 *   - 3 average mid-tier (C0031, C0009, C0056)
 *   - 3 low-signal realism fillers (C0002, C0074, C0023)
 */
export const BOOK_OF_WORK_CLIENT_IDS: readonly string[] = [
  'C0089', 'C0142', 'C0103', 'C0085',   // high attrition
  'C0078', 'C0014', 'C0018', 'C0008',   // wallet capture
  'C0067', 'C0041', 'C0051',             // overlap
  'C0055', 'C0126', 'C0150',             // rich data / high AUM
  'C0031', 'C0009', 'C0056',             // average mid-tier
  'C0002', 'C0074', 'C0023',             // low signal / realism
];

export interface BookOfWorkClientResult {
  clientId: string;
  clientName: string;
  aum: number;
  attrition: AttritionAssessment | null;
  walletCapture: WalletCaptureAssessment | null;
  error: string | null;
  priorityScore: number;
  rank: number;
  justification: string;
}

export interface BookOfWorkProgress {
  completed: number;
  total: number;
  currentClientName?: string;
}

const ATTRITION_PRIORITY: Record<AttritionRiskCategory, number> = {
  dissatisfaction:      40,
  'quiet disengagement': 30,
  'busy but stable':    10,
  'no concern':          0,
};

const WALLET_PRIORITY: Record<WalletCaptureOpportunitySignal, number> = {
  strong:   30,
  moderate: 15,
  none:      0,
};

const CONFIDENCE_MULT: Record<'high' | 'medium' | 'low', number> = {
  high:   1.0,
  medium: 0.8,
  low:    0.6,
};

/**
 * Deterministic ranking — never an LLM call.
 * Priority score = attrition severity × confidence + wallet capture strength × confidence.
 */
export function rankBookOfWork(
  raw: Pick<BookOfWorkClientResult, 'clientId' | 'clientName' | 'aum' | 'attrition' | 'walletCapture' | 'error'>[],
): BookOfWorkClientResult[] {
  const scored = raw.map(r => {
    const attrScore = r.attrition
      ? (ATTRITION_PRIORITY[r.attrition.riskCategory] ?? 0) * (CONFIDENCE_MULT[r.attrition.confidence] ?? 0.6)
      : 0;
    const walletScore = r.walletCapture
      ? (WALLET_PRIORITY[r.walletCapture.opportunitySignal] ?? 0) * (CONFIDENCE_MULT[r.walletCapture.confidence] ?? 0.6)
      : 0;
    const priorityScore = Math.round(attrScore + walletScore);

    const reasons: string[] = [];
    if (r.attrition) {
      const cat = r.attrition.riskCategory;
      if (cat !== 'no concern') {
        reasons.push(`${cat} (${r.attrition.confidence} confidence attrition)`);
      }
    }
    if (r.walletCapture && r.walletCapture.opportunitySignal !== 'none') {
      reasons.push(`${r.walletCapture.opportunitySignal} wallet capture signal (${r.walletCapture.confidence} confidence)`);
    }
    if (r.error) reasons.push(`assessment error: ${r.error}`);

    const justification = reasons.length > 0
      ? reasons.join(' · ')
      : 'No significant signals detected.';

    return { ...r, priorityScore, rank: 0, justification };
  });

  return scored
    .sort((a, b) => b.priorityScore - a.priorityScore || a.clientName.localeCompare(b.clientName))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Runs attrition + wallet capture for the 20 Book of Work clients.
 * Concurrency: ~5 clients at a time (10 Claude calls per chunk).
 * Per-client error handling: one failure does not abort the batch.
 */
export async function runBookOfWorkBatch(
  clients: Client[],
  confirmedPatterns: ConfirmedPatternWithSpec[],
  onProgress: (p: BookOfWorkProgress) => void,
): Promise<BookOfWorkClientResult[]> {
  const idSet = new Set(BOOK_OF_WORK_CLIENT_IDS);
  const targets = clients.filter(c => idSet.has(c.id));
  const total = targets.length;
  let completed = 0;

  type RawResult = Pick<BookOfWorkClientResult, 'clientId' | 'clientName' | 'aum' | 'attrition' | 'walletCapture' | 'error'>;

  const allResults: RawResult[] = [];

  const CHUNK = 5;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const chunkResults = await Promise.all(
      chunk.map(async (client): Promise<RawResult> => {
        onProgress({ completed, total, currentClientName: client.name });
        let attrition: AttritionAssessment | null = null;
        let walletCapture: WalletCaptureAssessment | null = null;
        let error: string | null = null;
        try {
          [attrition, walletCapture] = await Promise.all([
            generateAttritionAssessment(client, confirmedPatterns),
            generateWalletCaptureAssessment(client, confirmedPatterns),
          ]);
        } catch (err) {
          error = err instanceof Error ? err.message : 'Unknown error';
        }
        completed++;
        onProgress({ completed, total });
        return { clientId: client.id, clientName: client.name, aum: client.aum, attrition, walletCapture, error };
      }),
    );
    allResults.push(...chunkResults);
  }

  return rankBookOfWork(allResults);
}
