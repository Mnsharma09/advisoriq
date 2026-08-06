/**
 * Validator sanity check — no LLM, hardcoded filterSpecs only.
 * Tests 3 known correlations from the generator to verify the validator
 * logic and field names are correct before touching the hypothesis generator.
 *
 * Usage: node scripts/sanity_check_validator.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = path.join(__dirname, '..', 'public', 'data');

// ── Normalize raw clients.json row → ClientSignal ────────────────────────────
function aumLabel(aum) {
  if (aum < 500_000)   return '<500K';
  if (aum < 1_000_000) return '500K-1M';
  if (aum < 2_000_000) return '1M-2M';
  return '>2M';
}

function normalizeRawClient(c) {
  return {
    id:                   c.client_id,
    age:                  c.age ?? 0,
    aum:                  c.aum ?? 0,
    aumTier:              aumLabel(c.aum ?? 0),
    risk:                 (c.risk_tolerance ?? '').toLowerCase(),
    daysSinceContact:     c.days_since_last_contact ?? 999,
    portfolioDrift:       c.latest_portfolio_drift_pct ?? 0,
    offTrackGoals:        c.off_track_goal_count ?? 0,
    overdueCommitments:   c.open_commitment_count ?? 0,
    unactionedLifeEvent:  c.unactioned_life_event_flag ?? false,
    estateComplete:       c.estate_docs_complete ?? false,
    insuranceAdequate:    c.insurance_adequate ?? false,
    lifeStage:            c.life_stage ?? 'Unknown',
    tenure:               c.tenure_years ?? 0,
  };
}

// ── Filter evaluation ─────────────────────────────────────────────────────────
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

function validate(label, signals, segmentConditions, metricField, metricOp, metricValue) {
  const metricCond = { field: metricField, op: metricOp, value: metricValue };

  const inGroup  = signals.filter(s => segmentConditions.every(c => applyCondition(s, c)));
  const outGroup = signals.filter(s => !segmentConditions.every(c => applyCondition(s, c)));

  if (inGroup.length === 0) {
    console.log(`\n[${label}]`);
    console.log(`  ❌ SEGMENT IS EMPTY — filter matched 0 clients`);
    console.log(`     Check field names and values in segmentConditions`);
    return;
  }

  const groupMatches = inGroup.filter(s => applyCondition(s, metricCond));
  const baseMatches  = outGroup.filter(s => applyCondition(s, metricCond));

  const matchPct    = (groupMatches.length / inGroup.length) * 100;
  const baselinePct = outGroup.length > 0 ? (baseMatches.length / outGroup.length) * 100 : 0;
  const ratio       = baselinePct > 0 ? matchPct / baselinePct : (matchPct > 0 ? Infinity : 0);

  let verdict;
  if (inGroup.length >= 5 && ratio >= 1.5) verdict = '✅ confirmed';
  else if (ratio > 1.0 || inGroup.length < 5) verdict = '⚠️  weak';
  else verdict = '❌ rejected';

  console.log(`\n[${label}]`);
  console.log(`  Segment: ${JSON.stringify(segmentConditions)}`);
  console.log(`  Metric:  ${metricField} ${metricOp} ${JSON.stringify(metricValue)}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Segment size:     ${inGroup.length} clients`);
  console.log(`  Match %:          ${matchPct.toFixed(1)}%  (${groupMatches.length}/${inGroup.length} in segment)`);
  console.log(`  Baseline %:       ${baselinePct.toFixed(1)}%  (${baseMatches.length}/${outGroup.length} outside segment)`);
  console.log(`  Ratio:            ${isFinite(ratio) ? ratio.toFixed(2) + 'x' : '∞'}`);
  console.log(`  Verdict:          ${verdict}`);
  console.log(`  Sample IDs:       ${inGroup.slice(0, 5).map(s => s.id).join(', ')}${inGroup.length > 5 ? ` … +${inGroup.length - 5}` : ''}`);
}

// ── Spot-check: print unique values of key fields to confirm normalisation ────
function spotCheck(signals) {
  const aumTiers  = [...new Set(signals.map(s => s.aumTier))].sort();
  const risks     = [...new Set(signals.map(s => s.risk))].sort();
  const stages    = [...new Set(signals.map(s => s.lifeStage))].sort();
  const dscSample = signals.slice(0, 5).map(s => `${s.id}:${s.daysSinceContact}d`);

  console.log('\n=== FIELD VALUE SPOT CHECK ===');
  console.log(`  aumTier values:   ${aumTiers.join(', ')}`);
  console.log(`  risk values:      ${risks.join(', ')}`);
  console.log(`  lifeStage values: ${stages.join(', ')}`);
  console.log(`  daysSinceContact sample: ${dscSample.join(', ')}`);
  console.log(`  insuranceAdequate distribution: true=${signals.filter(s => s.insuranceAdequate).length} false=${signals.filter(s => !s.insuranceAdequate).length}`);
  console.log(`  Retirement clients: ${signals.filter(s => s.lifeStage === 'Retirement').length}`);
  console.log(`  Age 65+ clients:    ${signals.filter(s => s.age >= 65).length}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const rawClients = JSON.parse(readFileSync(path.join(dataDir, 'clients.json'), 'utf8'));
const signals    = rawClients.map(normalizeRawClient);

console.log(`Loaded ${rawClients.length} clients → ${signals.length} normalized signals`);

spotCheck(signals);

console.log('\n=== HARDCODED FILTERSPEC VALIDATION ===');

// Test 1: Tier 4 (lowest AUM) → more days since contact
validate(
  'Test 1 — Tier 4 AUM → higher days-since-contact',
  signals,
  [{ field: 'aumTier', op: 'eq', value: '<500K' }],
  'daysSinceContact', 'gt', 30
);

// Test 2: Age 65+ → more likely conservative risk
validate(
  'Test 2 — Age 65+ → conservative risk',
  signals,
  [{ field: 'age', op: 'gte', value: 65 }],
  'risk', 'eq', 'conservative'
);

// Test 3: Retirement life stage → higher insurance adequate
validate(
  'Test 3 — Retirement stage → insuranceAdequate',
  signals,
  [{ field: 'lifeStage', op: 'eq', value: 'Retirement' }],
  'insuranceAdequate', 'eq', true
);

console.log('\n');
