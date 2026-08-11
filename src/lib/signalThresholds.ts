// ─── Signal Thresholds ────────────────────────────────────────────────────────
//
// Single source of truth for all deterministic scoring thresholds used across
// nbaEngine.ts, healthScore.ts, crossBookIntelligence.ts, and claudeClient.ts.
// Change a value here and it propagates everywhere — no need to hunt magic numbers.

// ─── NBA Score Weights (must sum to 100) ──────────────────────────────────────
export const NBA_MAX_CONTACT    = 25;
export const NBA_MAX_PORTFOLIO  = 20;
export const NBA_MAX_GOALS      = 20;
export const NBA_MAX_HOUSEHOLD  = 20;
export const NBA_MAX_LIFE_EVENT = 15;

// ─── NBA Contact Signal ────────────────────────────────────────────────────────
// Piecewise linear: 0d→25pts, 30d→20pts, 60d→12pts, 90d+→0pts
export const NBA_CONTACT_LERP: [number, number][] = [
  [0,  25],
  [30, 20],
  [60, 12],
  [90,  0],
];
// Label threshold: contacts within this many days are shown as "recent"
export const NBA_CONTACT_RECENT_DAYS = 7;

// ─── NBA Portfolio Drift Signal ────────────────────────────────────────────────
// Piecewise linear: 0%→20pts, 5%→15pts, 10%→8pts, 15%+→0pts
export const NBA_PORTFOLIO_LERP: [number, number][] = [
  [0,  20],
  [5,  15],
  [10,  8],
  [15,  0],
];

// ─── NBA Life Event Signal ─────────────────────────────────────────────────────
export const NBA_LIFE_EVENT_RECENT_DAYS = 90;   // ≤90d since life event → 0 pts (still in transition)
export const NBA_LIFE_EVENT_MEDIUM_DAYS = 180;  // 90–180d → partial score
export const NBA_LIFE_EVENT_MEDIUM_SCORE = 8;   // pts awarded in the medium band

// ─── NBA Urgency Bands ─────────────────────────────────────────────────────────
export const NBA_URGENCY_CRITICAL = 30;  // total score < 30 → Critical
export const NBA_URGENCY_HIGH     = 55;  // total score < 55 → High
export const NBA_URGENCY_MEDIUM   = 75;  // total score < 75 → Medium
// total score ≥ 75 → Low

// ─── Health Score Thresholds ───────────────────────────────────────────────────
// Contact recency bands
export const HEALTH_CONTACT_GOOD_DAYS = 30;  // ≤30d → 25 pts
export const HEALTH_CONTACT_OK_DAYS   = 60;  // ≤60d → 17 pts
export const HEALTH_CONTACT_POOR_DAYS = 90;  // ≤90d →  8 pts (0 pts above this)

// Portfolio drift bands (percentage points from target)
export const HEALTH_DRIFT_GOOD = 3;   // ≤3%  → 25 pts
export const HEALTH_DRIFT_OK   = 6;   // ≤6%  → 17 pts
export const HEALTH_DRIFT_POOR = 10;  // ≤10% →  8 pts (0 pts above this)

// Action items overdue count → points deducted from 25
export const HEALTH_AI_OVERDUE_WARN     = 1;  // 1 overdue → 17 pts
export const HEALTH_AI_OVERDUE_ALERT    = 2;  // 2 overdue →  8 pts
export const HEALTH_AI_OVERDUE_CRITICAL = 3;  // 3+ overdue → 0 pts

// Color bands
export const HEALTH_COLOR_RED_THRESHOLD   = 50;  // total < 50 → red
export const HEALTH_COLOR_AMBER_THRESHOLD = 75;  // total < 75 → amber (≥75 → green)

// ─── Cross-Book Intelligence Thresholds ───────────────────────────────────────
// Cash concentration
export const CROSSBOOK_EXCESS_CASH_PCT = 15;  // % cash above this is idle capital

// Contact gap (used for AUM-segment contact-cadence check)
export const CROSSBOOK_CONTACT_GAP_DAYS = 45;  // segments averaging > 45d flagged

// Household engagement
export const CROSSBOOK_HH_SCORE_MIN = 50;  // household engagement score below this is flagged

// Action item age
export const CROSSBOOK_ACTION_OVERDUE_DAYS = 30;  // items > 30d past due are overdue
export const CROSSBOOK_ACTION_HIGH_COUNT   = 10;  // > 10 overdue items → HIGH severity
export const CROSSBOOK_ACTION_MEDIUM_COUNT =  3;  // > 3  overdue items → MEDIUM severity

// ─── Cross-Sell / Wallet Capture (claudeClient) ────────────────────────────────
// Magnitude-aware gap gate: goal shortfall > this fraction of target triggers detection
// even when the product is not explicitly curated as flagged_as_gap.
export const CROSSSELL_SHORTFALL_GAP_RATIO = 0.20;  // 20% of target

// ─── Book of Work Priority Gate ────────────────────────────────────────────────
// Clients whose Book of Work combined priority score meets this threshold are
// surfaced as "Priority Clients" on the Dashboard and Practice Book Overview.
export const BOOK_OF_WORK_PRIORITY_THRESHOLD = 30;

// ─── Core Check Thresholds (used in PatternDiscoveryCard) ─────────────────────
export const CORE_CHECK_CONTACT_GAP_DAYS    = 60;  // ≥60d since last contact → engagement gap
export const CORE_CHECK_OPEN_ITEMS_OVERLOAD = 3;   // ≥3 open action items → backlog flag
export const CORE_CHECK_CASH_DRAG_PCT       = 15;  // >15% cash → idle capital (matches CROSSBOOK)

// ─── Demo Anchor Date ─────────────────────────────────────────────────────────
// Synthetic data's "today". lastContact dates are computed as (DEMO_ANCHOR_DATE - days_since_last_contact)
// so both data loading and Core Check comparisons must use the same reference point.
export const DEMO_ANCHOR_DATE = new Date('2026-08-12T00:00:00');
