"""
AdvisorIQ Synthetic Data Pipeline
config.py — All parameters controlling data generation.
Change values here to adjust the book size, distributions, and scenario mix.
"""

# ── BOOK SIZE ────────────────────────────────────────────────────────────────
NUM_CLIENTS         = 150      # Total clients in the advisor's book
NUM_HOUSEHOLDS      = 95       # Households (some clients share a household)
HISTORY_MONTHS      = 18       # Months of interaction and portfolio history
SNAPSHOT_FREQUENCY  = "monthly"  # Portfolio snapshot frequency

# ── RANDOM SEED (change for different books, keep for reproducibility) ───────
RANDOM_SEED = 42

# ── AUM TIER DISTRIBUTION (must sum to 1.0) ──────────────────────────────────
# Based on Capgemini World Wealth Report distributions
AUM_TIERS = {
    "Tier 1 — Ultra HNW":   {"min": 5_000_000,  "max": 30_000_000, "weight": 0.05},
    "Tier 2 — HNW":         {"min": 1_000_000,  "max": 5_000_000,  "weight": 0.20},
    "Tier 3 — Affluent":    {"min": 250_000,    "max": 1_000_000,  "weight": 0.40},
    "Tier 4 — Mass Affluent":{"min": 50_000,    "max": 250_000,    "weight": 0.35},
}

# ── AGE DISTRIBUTION ─────────────────────────────────────────────────────────
AGE_BANDS = {
    "30-44": {"min": 30, "max": 44, "weight": 0.20},
    "45-54": {"min": 45, "max": 54, "weight": 0.28},
    "55-64": {"min": 55, "max": 64, "weight": 0.32},
    "65-80": {"min": 65, "max": 80, "weight": 0.20},
}

# ── LIFE STAGES (derived from age, can be overridden) ───────────────────────
LIFE_STAGE_BY_AGE = {
    (30, 44): "Accumulation",
    (45, 54): "Pre-retirement",
    (55, 64): "Pre-retirement",
    (65, 80): "Retirement",
}

# ── TENURE DISTRIBUTION (years as client) ────────────────────────────────────
TENURE_BANDS = {
    "New (< 2yr)":      {"min": 0.5, "max": 2,  "weight": 0.15},
    "Established (2-7yr)": {"min": 2, "max": 7,  "weight": 0.45},
    "Long-term (7yr+)": {"min": 7,   "max": 25, "weight": 0.40},
}

# ── CONTACT FREQUENCY (interactions per month by AUM tier) ──────────────────
# Top AUM tiers get more contact — reflects real advisor behaviour
CONTACT_FREQ_BY_TIER = {
    "Tier 1 — Ultra HNW":    {"mean": 3.5, "std": 1.0},
    "Tier 2 — HNW":          {"mean": 2.2, "std": 0.8},
    "Tier 3 — Affluent":     {"mean": 1.2, "std": 0.6},
    "Tier 4 — Mass Affluent": {"mean": 0.6, "std": 0.4},
}

# ── INTERACTION TYPES AND WEIGHTS ────────────────────────────────────────────
INTERACTION_TYPES = {
    "Phone call":     0.40,
    "Email":          0.30,
    "In-person meeting": 0.15,
    "Video call":     0.10,
    "Review meeting": 0.05,
}

# ── SENTIMENT DISTRIBUTION ───────────────────────────────────────────────────
SENTIMENT_WEIGHTS = {
    "positive": 0.55,
    "neutral":  0.35,
    "negative": 0.10,
}

# ── PRODUCT TYPES ────────────────────────────────────────────────────────────
PRODUCT_TYPES = [
    "equity_portfolio",
    "fixed_income",
    "insurance_life",
    "insurance_protection",
    "estate_plan",
    "tax_wrapper_isa",
    "tax_wrapper_pension",
    "mortgage",
    "trust",
    "cash_savings",
]

# Product holding probability by AUM tier (higher AUM = more products)
PRODUCT_PROB_BY_TIER = {
    "Tier 1 — Ultra HNW":    0.85,
    "Tier 2 — HNW":          0.70,
    "Tier 3 — Affluent":     0.50,
    "Tier 4 — Mass Affluent": 0.30,
}

# ── GOAL TYPES ───────────────────────────────────────────────────────────────
GOAL_TYPES = [
    "Retirement income",
    "Education funding",
    "Estate / legacy",
    "Property purchase",
    "Business exit",
    "Income protection",
    "Charitable giving",
    "Emergency fund",
]

# ── LIFE EVENT TYPES ─────────────────────────────────────────────────────────
LIFE_EVENT_TYPES = {
    "Marriage":              {"urgency": "medium", "weight": 0.08},
    "Divorce":               {"urgency": "high",   "weight": 0.04},
    "New child / dependent": {"urgency": "medium", "weight": 0.10},
    "Job change":            {"urgency": "medium", "weight": 0.12},
    "Retirement":            {"urgency": "high",   "weight": 0.10},
    "Bereavement":           {"urgency": "high",   "weight": 0.08},
    "Health event":          {"urgency": "high",   "weight": 0.06},
    "Property purchase":     {"urgency": "medium", "weight": 0.15},
    "Business sale":         {"urgency": "high",   "weight": 0.05},
    "Inheritance received":  {"urgency": "high",   "weight": 0.07},
    "Child leaving home":    {"urgency": "low",    "weight": 0.08},
    "Business start":        {"urgency": "medium", "weight": 0.07},
}

# ── INJECTED SCENARIOS (ground truth for accuracy testing) ───────────────────
# These are deliberately planted in the book — the engine must surface them
INJECTED_SCENARIOS = [
    {
        "scenario_id": "S001",
        "type": "at_risk_high_aum",
        "description": "Tier 1 client, no contact in 75+ days, portfolio drifted 15%+",
        "expected_rank": "top_5",
        "count": 2,
    },
    {
        "scenario_id": "S002",
        "type": "life_event_unactioned",
        "description": "Client had major life event 30+ days ago, no advisor action taken",
        "expected_rank": "top_10",
        "count": 3,
    },
    {
        "scenario_id": "S003",
        "type": "estate_gap_over_60",
        "description": "Client aged 60+, AUM > 500K, no estate documents complete",
        "expected_rank": "top_20",
        "count": 5,
    },
    {
        "scenario_id": "S004",
        "type": "goal_off_track",
        "description": "Primary goal less than 40% complete with less than 3 years to target",
        "expected_rank": "top_15",
        "count": 4,
    },
    {
        "scenario_id": "S005",
        "type": "household_next_gen_gap",
        "description": "HNW household, next gen not engaged, wealth transfer flag active",
        "expected_rank": "top_20",
        "count": 3,
    },
]

# ── PEER BENCHMARKS (advisor_benchmarks reference table) ─────────────────────
PEER_BENCHMARKS = {
    "avg_monthly_contacts_per_client": 1.4,
    "avg_response_rate":               0.72,
    "avg_commitment_fulfillment_rate": 0.81,
    "avg_meeting_duration_mins":       42,
    "top_quartile_contact_freq":       2.1,
    "bottom_quartile_contact_freq":    0.7,
    "avg_days_between_reviews":        92,
    "avg_products_per_tier1_client":   6.2,
    "avg_products_per_tier2_client":   4.1,
    "avg_products_per_tier3_client":   2.8,
    "avg_products_per_tier4_client":   1.9,
}

# ── OUTPUT ───────────────────────────────────────────────────────────────────
OUTPUT_DIR       = "output"
OUTPUT_FORMATS   = ["json", "csv"]   # both are generated
PRETTY_JSON      = True              # readable JSON with indentation
