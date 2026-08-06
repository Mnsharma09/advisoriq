/**
 * Cross-Book Pattern Discovery — Hypothesis Generator + Validator test
 * Runs against the 150-client synthetic dataset in public/data/clients.json
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/test_hypothesis_generator.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'public', 'data');

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 3000;

// ── AUM label (must match claudeClient.ts) ────────────────────────────────────
function aumLabel(aum) {
  if (aum < 500_000) return '<500K';
  if (aum < 1_000_000) return '500K-1M';
  if (aum < 2_000_000) return '1M-2M';
  return '>2M';
}

// ── Normalize raw clients.json row → ClientSignal ────────────────────────────
function normalizeRawClient(c) {
  return {
    id: c.client_id,
    age: c.age ?? 0,
    aum: c.aum ?? 0,
    aumTier: aumLabel(c.aum ?? 0),
    risk: (c.risk_tolerance ?? '').toLowerCase(),
    daysSinceContact: c.days_since_last_contact ?? 999,
    portfolioDrift: c.latest_portfolio_drift_pct ?? 0,
    offTrackGoals: c.off_track_goal_count ?? 0,
    overdueCommitments: c.open_commitment_count ?? 0,
    unactionedLifeEvent: c.unactioned_life_event_flag ?? false,
    estateComplete: c.estate_docs_complete ?? false,
    insuranceAdequate: c.insurance_adequate ?? false,
    lifeStage: c.life_stage ?? 'Unknown',
    tenure: c.tenure_years ?? 0,
  };
}

// ── Digest for LLM input ──────────────────────────────────────────────────────
function buildDigest(clients) {
  return clients.map(c => [
    c.client_id,
    `age:${c.age ?? '?'}`,
    `aum:${aumLabel(c.aum ?? 0)}`,
    `risk:${c.risk_tolerance ?? '?'}`,
    `dsc:${c.days_since_last_contact ?? '?'}d`,
    `drift:${c.latest_portfolio_drift_pct != null ? c.latest_portfolio_drift_pct.toFixed(1) + '%' : '?'}`,
    `offtrack_goals:${c.off_track_goal_count ?? 0}`,
    `overdue:${c.open_commitment_count ?? 0}`,
    `life_event_unactioned:${c.unactioned_life_event_flag ? 'Y' : 'N'}`,
    `estate_complete:${c.estate_docs_complete ? 'Y' : 'N'}`,
    `insurance_ok:${c.insurance_adequate ? 'Y' : 'N'}`,
    `life_stage:${c.life_stage ?? '?'}`,
    `tenure:${c.tenure_years != null ? c.tenure_years.toFixed(1) + 'y' : '?'}`,
  ].join('|')).join('\n');
}

// ── Deterministic filter evaluation ──────────────────────────────────────────
function applyCondition(signal, cond) {
  const v = signal[cond.field];
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

// ── Categorical pre-check ─────────────────────────────────────────────────────
const CATEGORICAL_FIELDS = new Set(['aumTier', 'risk', 'lifeStage']);

function buildValidValueSets(signals) {
  const map = new Map();
  for (const field of CATEGORICAL_FIELDS) {
    map.set(field, new Set(signals.map(s => String(s[field]))));
  }
  return map;
}

function checkFilterSpecValues(filterSpec, validValues) {
  if (!filterSpec) return null;
  const allConds = [
    ...filterSpec.segmentConditions,
    { field: filterSpec.metricField, op: filterSpec.metricOp, value: filterSpec.metricValue },
  ];
  for (const cond of allConds) {
    const validSet = validValues.get(cond.field);
    if (!validSet) continue;
    if (cond.op === 'eq' || cond.op === 'neq') {
      if (!validSet.has(String(cond.value))) {
        return `field "${cond.field}" value "${cond.value}" not in dataset (valid: ${[...validSet].join(', ')})`;
      }
    }
    if (cond.op === 'in') {
      const bad = (Array.isArray(cond.value) ? cond.value : []).filter(v => !validSet.has(v));
      if (bad.length > 0) {
        return `field "${cond.field}" unknown values [${bad.join(', ')}] (valid: ${[...validSet].join(', ')})`;
      }
    }
  }
  return null;
}

// ── Validate all hypotheses against full dataset ──────────────────────────────
function validateHypotheses(hypotheses, signals) {
  const validValues = buildValidValueSets(signals);

  return hypotheses.map(h => {
    const base = {
      hypothesis: h.hypothesis,
      sampleSize: 0,
      matchPercentage: 0,
      comparisonBaselinePercentage: 0,
      verdict: 'weak',
      supportingClientIds: [],
    };

    if (!h.filterSpec || !h.filterSpec.segmentConditions?.length) return base;

    // Pre-check: catch invalid categorical values before running stats
    const invalidReason = checkFilterSpecValues(h.filterSpec, validValues);
    if (invalidReason) {
      return { ...base, verdict: 'invalid', invalidReason };
    }

    const { segmentConditions, metricField, metricOp, metricValue } = h.filterSpec;
    const metricCond = { field: metricField, op: metricOp, value: metricValue };

    const inGroup  = signals.filter(s => segmentConditions.every(c => applyCondition(s, c)));
    const outGroup = signals.filter(s => !segmentConditions.every(c => applyCondition(s, c)));

    if (inGroup.length === 0) return { ...base, verdict: 'rejected' };

    const groupMatches = inGroup.filter(s => applyCondition(s, metricCond));
    const baseMatches  = outGroup.filter(s => applyCondition(s, metricCond));

    const matchPct    = (groupMatches.length / inGroup.length) * 100;
    const baselinePct = outGroup.length > 0 ? (baseMatches.length / outGroup.length) * 100 : 0;
    const ratio       = baselinePct > 0 ? matchPct / baselinePct : (matchPct > 0 ? Infinity : 0);

    let verdict;
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

// ── Claude call helpers ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior wealth management analyst examining an advisor's full client book.
Your task: propose CANDIDATE hypotheses about patterns that might exist across this book.
Do NOT validate — just surface plausible patterns worth investigating.
Focus on actionable cross-book themes: contact frequency, portfolio risk, life stage transitions, AUM tier behaviour, goal drift, estate/insurance gaps, attrition signals.
Return a JSON array ONLY — no markdown, no prose before or after.
Each element must have exactly these keys: "hypothesis", "reasoning", "dataPointsToCheck", "filterSpec".

filterSpec encodes the hypothesis as a machine-executable filter so it can be validated against real data:
{"segmentConditions":[{"field":"<field>","op":"<op>","value":<value>}],"metricField":"<field>","metricOp":"<op>","metricValue":<value>}
- segmentConditions (AND-ed): who is in the pattern group
- metricField/metricOp/metricValue: what signal is elevated in that group vs the rest of the book

Available field names (use EXACTLY these): age, aum, aumTier, risk, daysSinceContact, portfolioDrift, offTrackGoals, overdueCommitments, unactionedLifeEvent, estateComplete, insuranceAdequate, lifeStage, tenure
Ops: "lt","gt","lte","gte","eq","neq","in" (in takes a JSON array value)

EXACT VALID VALUES — you MUST use these verbatim in filterSpec; do not invent or paraphrase:
  aumTier  → "<500K" | "500K-1M" | "1M-2M" | ">2M"
  risk     → "conservative" | "moderate" | "growth" | "aggressive"
  lifeStage → "Accumulation" | "Pre-retirement" | "Retirement" | "Early career"
  Boolean fields (unactionedLifeEvent, estateComplete, insuranceAdequate) → true | false (not strings)
  Numeric fields (age, aum, daysSinceContact, portfolioDrift, offTrackGoals, overdueCommitments, tenure) → numbers

Example — "Short-tenure high-AUM clients tend to have unactioned life events":
"filterSpec":{"segmentConditions":[{"field":"tenure","op":"lt","value":3},{"field":"aumTier","op":"in","value":[">2M","1M-2M"]}],"metricField":"unactionedLifeEvent","metricOp":"eq","metricValue":true}

IMPORTANT: In "reasoning" cite at most 5 example client IDs, 2-3 sentences max.`;

const ROW_FORMAT = 'Row format: client_id|age|aum_tier|risk_tolerance|days_since_contact|portfolio_drift|off_track_goals|overdue_commitments|unactioned_life_event|estate_docs_complete|insurance_adequate|life_stage|tenure';

function tryParseJSON(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function callClaude(client, userContent, attempt = 1) {
  console.log(`  → API call (attempt ${attempt}, max_tokens=${MAX_TOKENS})`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  const raw = response.content[0]?.text ?? '';
  console.log(`  ← stop_reason: ${response.stop_reason}  |  in:${response.usage.input_tokens} out:${response.usage.output_tokens} tokens`);
  return { raw, stop_reason: response.stop_reason };
}

// ── Results table printer ─────────────────────────────────────────────────────
function printResultsTable(results) {
  const VERDICT_ICON = { confirmed: '✅', weak: '⚠️ ', rejected: '❌', invalid: '🚫' };
  const COL = { hyp: 52, n: 6, match: 9, base: 9, verdict: 11 };

  const hr = '─'.repeat(COL.hyp + COL.n + COL.match + COL.base + COL.verdict + 4);
  const header = [
    'Hypothesis'.padEnd(COL.hyp),
    'n'.padStart(COL.n),
    'Match%'.padStart(COL.match),
    'Base%'.padStart(COL.base),
    'Verdict'.padEnd(COL.verdict),
  ].join(' │ ');

  console.log('\n=== VALIDATION RESULTS TABLE ===\n');
  console.log(header);
  console.log(hr);

  results.forEach(r => {
    const hyp = r.hypothesis.length > COL.hyp
      ? r.hypothesis.slice(0, COL.hyp - 1) + '…'
      : r.hypothesis.padEnd(COL.hyp);
    const icon = VERDICT_ICON[r.verdict] ?? '  ';
    console.log([
      hyp,
      String(r.sampleSize).padStart(COL.n),
      `${r.matchPercentage.toFixed(1)}%`.padStart(COL.match),
      `${r.comparisonBaselinePercentage.toFixed(1)}%`.padStart(COL.base),
      `${icon} ${r.verdict}`.padEnd(COL.verdict),
    ].join(' │ '));
  });

  console.log(hr);
  console.log(`\nConfirmed: ${results.filter(r => r.verdict === 'confirmed').length}  Weak: ${results.filter(r => r.verdict === 'weak').length}  Rejected: ${results.filter(r => r.verdict === 'rejected').length}  Invalid: ${results.filter(r => r.verdict === 'invalid').length}`);

  const invalid = results.filter(r => r.verdict === 'invalid');
  if (invalid.length > 0) {
    console.log('\n=== INVALID FILTER SPECS (generator used wrong field values) ===\n');
    invalid.forEach(r => {
      console.log(`  [${r.hypothesis.slice(0, 60)}]`);
      console.log(`    Reason: ${r.invalidReason}`);
    });
  }

  console.log('\n=== SUPPORTING CLIENT IDs (confirmed only) ===\n');
  results.filter(r => r.verdict === 'confirmed').forEach(r => {
    console.log(`[${r.hypothesis.slice(0, 60)}]`);
    console.log(`  n=${r.sampleSize} | ${r.matchPercentage}% vs ${r.comparisonBaselinePercentage}% baseline`);
    console.log(`  Matching clients (${r.supportingClientIds.length}): ${r.supportingClientIds.join(', ')}`);
    console.log();
  });
}

// ── Synthesizer ───────────────────────────────────────────────────────────────

const COMPLIANCE_RULES = `
COMPLIANCE: Only reference statistics explicitly provided. Do not fabricate figures. Never recommend specific securities or products. Frame all output as inputs for advisor review and professional judgment, not directives.`;

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

function buildSynthesisPrompt(hypotheses, results) {
  const total = results.length;

  const confirmed  = results.filter(r => r.verdict === 'confirmed');
  const weak       = results.filter(r => r.verdict === 'weak');
  const excluded   = results.filter(r => r.verdict === 'rejected' || r.verdict === 'invalid');
  const weakClose  = weak.filter(r => {
    const ratio = r.comparisonBaselinePercentage > 0
      ? r.matchPercentage / r.comparisonBaselinePercentage : 0;
    return ratio >= 1.2 && r.sampleSize >= 5;
  });

  const lines = [`ANALYSIS SCOPE: ${total} hypotheses tested.\n`];

  if (confirmed.length === 0) {
    lines.push('CONFIRMED FINDINGS: None met the threshold (ratio >= 1.5x, n >= 5).\n');
  } else {
    lines.push('CONFIRMED FINDINGS (all must appear in "findings" output):');
    confirmed.forEach((r, i) => {
      const ratio = r.comparisonBaselinePercentage > 0
        ? (r.matchPercentage / r.comparisonBaselinePercentage).toFixed(2) + 'x' : '∞';
      lines.push(`${i + 1}. ${r.hypothesis}`);
      lines.push(`   match=${r.matchPercentage}%, baseline=${r.comparisonBaselinePercentage}%, ratio=${ratio}, n=${r.sampleSize}`);
    });
    lines.push('');
  }

  if (weakClose.length > 0) {
    lines.push('WEAK — CLOSE TO THRESHOLD (ratio 1.2x–1.49x, n >= 5; include up to 2 in "watchlist" only, no statistics claims, no recommended action):');
    weakClose.slice(0, 3).forEach((r, i) => {
      const ratio = r.comparisonBaselinePercentage > 0
        ? (r.matchPercentage / r.comparisonBaselinePercentage).toFixed(2) + 'x' : '?';
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

async function synthesize(anthropic, hypotheses, results) {
  const userContent = buildSynthesisPrompt(hypotheses, results);
  console.log('\nStep 3: Synthesizing findings via Claude...');
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    system: SYNTHESIS_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });
  const raw = response.content[0]?.text ?? '';
  console.log(`  ← stop_reason: ${response.stop_reason}  |  in:${response.usage.input_tokens} out:${response.usage.output_tokens} tokens`);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('\nERROR: No JSON object in synthesis response:\n' + raw);
    return null;
  }
  return { result: JSON.parse(match[0]), raw };
}

function printSynthesis(result) {
  if (!result || typeof result !== 'object') {
    console.log('  [synthesis result missing or unparseable]');
    return;
  }

  const CONF_ICON = { high: '🟢', medium: '🟡', low: '🟠' };

  console.log('\n' + '═'.repeat(70));
  console.log('  CROSS-BOOK PATTERN DISCOVERY — ADVISOR REPORT');
  console.log('═'.repeat(70));
  console.log(`\n  ${result.headline ?? '[headline not provided]'}\n`);

  const findings = Array.isArray(result.findings) ? result.findings : [];
  if (findings.length === 0) {
    console.log('  No confirmed findings in this analysis.\n');
  } else {
    findings.forEach((f, i) => {
      if (!f || typeof f !== 'object') {
        console.log(`  Finding ${i + 1}  [malformed finding object — skipped]\n`);
        return;
      }
      const conf = typeof f.confidence === 'string' ? f.confidence : null;
      const icon = conf ? (CONF_ICON[conf] ?? '⚪') : '⚪';
      const confLabel = conf ? conf.toUpperCase() : '[confidence not provided]';
      const title = f.title ?? f.finding ?? f.hypothesis ?? '[title not provided]';
      const evidence = typeof f.evidence === 'string'
        ? f.evidence
        : (f.evidence != null ? JSON.stringify(f.evidence) : '[evidence not provided]');
      const action = f.suggestedAction ?? f.action ?? '[suggested action not provided]';

      console.log(`  Finding ${i + 1}  ${icon} ${confLabel}`);
      console.log(`  ${'─'.repeat(66)}`);
      console.log(`  Pattern:  ${title}`);
      console.log(`  Evidence: ${evidence}`);
      console.log(`  Action:   ${action}`);
      console.log();
    });
  }

  const watchlist = Array.isArray(result.watchlist) ? result.watchlist : [];
  if (watchlist.length > 0) {
    console.log(`  WATCH LIST (not yet statistically strong):`);
    watchlist.forEach(w => console.log(`  • ${typeof w === 'string' ? w : JSON.stringify(w)}`));
    console.log();
  }

  console.log(`  ${result.summary ?? '[summary not provided]'}`);
  console.log('═'.repeat(70) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY not set.'); process.exit(1); }

  const rawClients = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'), 'utf8'));
  console.log(`Loaded ${rawClients.length} clients from clients.json`);

  const signals = rawClients.map(normalizeRawClient);
  const digest  = buildDigest(rawClients);

  const baseContent =
    `Full client book — ${rawClients.length} clients.\n${ROW_FORMAT}\n\n` +
    digest +
    `\n\nPropose 5-8 candidate pattern hypotheses. Remember: cite at most 5 client IDs per reasoning field, 2-3 sentences max.`;

  const anthropic = new Anthropic({ apiKey });

  // ── Step 1: Generate hypotheses ────────────────────────────────────────────
  console.log(`\nStep 1: Generating hypotheses via ${MODEL}...`);
  const { raw } = await callClaude(anthropic, baseContent, 1);

  console.log('\n=== RAW CLAUDE OUTPUT ===\n');
  console.log(raw);

  let hypotheses = tryParseJSON(raw);
  if (!hypotheses) {
    console.warn('\nWARNING: Could not parse JSON. Retrying...\n');
    const retry = await callClaude(anthropic,
      baseContent + '\n\nIMPORTANT: Your previous response was truncated. Be more concise — each "reasoning" must be 1-2 sentences, at most 3 client IDs. Return 5 hypotheses max.',
      2);
    console.log('\n=== RAW CLAUDE OUTPUT (retry) ===\n');
    console.log(retry.raw);
    hypotheses = tryParseJSON(retry.raw);
    if (!hypotheses) { console.error('ERROR: Could not parse JSON even after retry.'); process.exit(1); }
  }

  console.log(`\nParsed ${hypotheses.length} hypotheses. FilterSpec coverage: ${hypotheses.filter(h => h.filterSpec).length}/${hypotheses.length}\n`);

  // ── Step 2: Validate deterministically ────────────────────────────────────
  console.log('Step 2: Validating hypotheses against full dataset (deterministic)...');
  const results = validateHypotheses(hypotheses, signals);

  // ── Print parsed hypotheses ────────────────────────────────────────────────
  console.log('\n=== PARSED HYPOTHESES + FILTER SPECS ===\n');
  hypotheses.forEach((h, i) => {
    console.log(`[${i + 1}] ${h.hypothesis}`);
    console.log(`    Reasoning:  ${h.reasoning}`);
    console.log(`    Check:      ${h.dataPointsToCheck}`);
    console.log(`    FilterSpec: ${h.filterSpec ? JSON.stringify(h.filterSpec) : 'MISSING'}`);
    console.log();
  });

  // ── Print results table ────────────────────────────────────────────────────
  printResultsTable(results);

  // ── Step 3: Synthesize ────────────────────────────────────────────────────
  const synth = await synthesize(anthropic, hypotheses, results);
  if (synth) {
    console.log('\n=== RAW SYNTHESIS OUTPUT ===\n');
    console.log(synth.raw);
    console.log();
    printSynthesis(synth.result);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
