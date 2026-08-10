-- ============================================================
--  AdvisorIQ Database Schema
--  9 tables mirroring the synthetic data generator output
-- ============================================================

-- ── 1. clients ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
    client_id                   VARCHAR(10)     PRIMARY KEY,
    advisor_id                  VARCHAR(10)     NOT NULL,
    full_name                   VARCHAR(255)    NOT NULL,
    first_name                  VARCHAR(100),
    last_name                   VARCHAR(100),
    gender                      CHAR(1),
    age                         INTEGER,
    age_band                    VARCHAR(20),
    life_stage                  VARCHAR(50),
    life_stage_change_date      DATE,
    aum                         NUMERIC(15,2),
    aum_tier                    VARCHAR(50),
    tenure_years                NUMERIC(5,2),
    risk_tolerance              VARCHAR(20),
    risk_score_target           NUMERIC(4,2),
    risk_score_current          NUMERIC(4,2),
    estate_docs_complete        BOOLEAN,
    insurance_adequate          BOOLEAN,
    last_review_date            DATE,
    next_review_date            DATE,
    review_overdue_flag         BOOLEAN,
    tax_year_end_flag           BOOLEAN,
    household_id                VARCHAR(10),
    is_primary_in_household     BOOLEAN,
    referral_source             VARCHAR(100),
    segment_tag                 VARCHAR(50),
    city                        VARCHAR(100),
    -- Pre-denormalised signal columns (updated nightly)
    days_since_last_contact     INTEGER,
    latest_portfolio_drift_pct  NUMERIC(5,2),
    open_commitment_count       INTEGER,
    product_gap_count           INTEGER,
    unactioned_life_event_flag  BOOLEAN,
    off_track_goal_count        INTEGER,
    -- nba_scenario_flag in the source JSON is a scenario-ID string (S001-S005),
    -- not a boolean.  We store the raw ID and compute the boolean at query time.
    nba_scenario_id             VARCHAR(20),
    nba_expected_rank           VARCHAR(20),    -- e.g. "top_5", "top_10" (not an integer)
    created_at                  TIMESTAMP       DEFAULT NOW(),
    updated_at                  TIMESTAMP       DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_advisor      ON clients(advisor_id);
CREATE INDEX IF NOT EXISTS idx_clients_aum          ON clients(aum DESC);
CREATE INDEX IF NOT EXISTS idx_clients_days_contact ON clients(days_since_last_contact DESC);
CREATE INDEX IF NOT EXISTS idx_clients_scenario     ON clients(nba_scenario_id);

-- ── 2. households ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS households (
    household_id            VARCHAR(10)     PRIMARY KEY,
    primary_client_id       VARCHAR(10)     REFERENCES clients(client_id),
    member_ids              TEXT,                       -- pipe-separated list
    member_count            INTEGER,
    total_household_aum     NUMERIC(15,2),
    engagement_score        NUMERIC(5,2),
    wealth_transfer_flag    BOOLEAN,
    next_gen_engaged        BOOLEAN,
    member_last_contact     JSONB           -- {"C0001": "2026-05-13", ...}
);

CREATE INDEX IF NOT EXISTS idx_households_primary ON households(primary_client_id);

-- ── 3. interactions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interactions (
    interaction_id      VARCHAR(10)     PRIMARY KEY,
    client_id           VARCHAR(10)     REFERENCES clients(client_id),
    advisor_id          VARCHAR(10),
    date                DATE,
    type                VARCHAR(50),
    initiated_by        VARCHAR(20),
    duration_minutes    INTEGER,
    outcome             VARCHAR(100),
    sentiment           VARCHAR(20),
    topics_discussed    TEXT,
    commitment_made     BOOLEAN,
    commitment_fulfilled BOOLEAN,
    follow_up_created   BOOLEAN,
    follow_up_due_date  DATE
);

CREATE INDEX IF NOT EXISTS idx_interactions_client ON interactions(client_id);
CREATE INDEX IF NOT EXISTS idx_interactions_date   ON interactions(date DESC);

-- ── 4. goals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
    goal_id                 VARCHAR(10)     PRIMARY KEY,
    client_id               VARCHAR(10)     REFERENCES clients(client_id),
    goal_type               VARCHAR(50),
    target_amount           NUMERIC(15,2),
    current_progress_pct    NUMERIC(5,2),
    target_date             DATE,
    on_track                BOOLEAN,
    last_reviewed_date      DATE,
    priority_rank           INTEGER,
    years_to_target         NUMERIC(5,2)
);

CREATE INDEX IF NOT EXISTS idx_goals_client        ON goals(client_id);
CREATE INDEX IF NOT EXISTS idx_goals_client_rank   ON goals(client_id, priority_rank);

-- ── 5. life_events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS life_events (
    event_id        VARCHAR(10)     PRIMARY KEY,
    client_id       VARCHAR(10)     REFERENCES clients(client_id),
    event_type      VARCHAR(50),
    event_date      DATE,
    urgency_level   VARCHAR(20),
    advisor_aware   BOOLEAN,
    action_taken    BOOLEAN,
    days_since_event INTEGER
);

CREATE INDEX IF NOT EXISTS idx_life_events_client  ON life_events(client_id);
CREATE INDEX IF NOT EXISTS idx_life_events_urgency ON life_events(urgency_level);

-- ── 6. portfolio_snapshots ────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    snapshot_id                 VARCHAR(10)     PRIMARY KEY,
    client_id                   VARCHAR(10)     REFERENCES clients(client_id),
    snapshot_date               DATE,
    aum_value                   NUMERIC(15,2),
    target_allocation_equity    NUMERIC(5,4),
    target_allocation_bonds     NUMERIC(5,4),
    target_allocation_cash      NUMERIC(5,4),
    actual_allocation_equity    NUMERIC(5,4),
    actual_allocation_bonds     NUMERIC(5,4),
    actual_allocation_cash      NUMERIC(5,4),
    drift_pct                   NUMERIC(5,2),
    goal_progress_pct           NUMERIC(5,2),
    ytd_return                  NUMERIC(8,4),
    benchmark_return            NUMERIC(8,4),
    risk_score                  NUMERIC(4,2)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_client      ON portfolio_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_client_date ON portfolio_snapshots(client_id, snapshot_date DESC);

-- ── 7. product_holdings ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_holdings (
    holding_id          VARCHAR(10)     PRIMARY KEY,
    client_id           VARCHAR(10)     REFERENCES clients(client_id),
    product_type        VARCHAR(50),
    held                BOOLEAN,
    start_date          DATE,
    review_due_date     DATE,
    flagged_as_gap      BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_holdings_client ON product_holdings(client_id);
CREATE INDEX IF NOT EXISTS idx_holdings_gap    ON product_holdings(client_id, flagged_as_gap);

-- ── 8. client_scores ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_scores (
    client_id                   VARCHAR(10)     PRIMARY KEY REFERENCES clients(client_id),
    advisor_id                  VARCHAR(10),
    score_date                  DATE,
    relationship_score          NUMERIC(5,2),
    portfolio_score             NUMERIC(5,2),
    household_score             NUMERIC(5,2),
    book_score                  NUMERIC(5,2),
    advisor_performance_score   NUMERIC(5,2),
    days_since_contact          INTEGER,
    portfolio_drift_pct         NUMERIC(5,2),
    goal_progress_pct           NUMERIC(5,2),
    product_gap_count           INTEGER,
    life_event_urgency          VARCHAR(20),
    interaction_multiplier      NUMERIC(4,2),
    aum_multiplier              NUMERIC(4,2),
    nba_score                   NUMERIC(5,2),
    nba_rank                    INTEGER,
    primary_urgency_reason      TEXT,
    recommended_action          TEXT,
    nba_scenario_id             VARCHAR(20),
    nba_expected_rank           VARCHAR(20),    -- e.g. "top_5", "top_10"
    score_validated             BOOLEAN,
    -- Signal engine outputs (populated independently of the NBA score)
    contact_score               NUMERIC(5,4),   -- 0.0000–1.0000 contact cadence urgency
    goals_score                 NUMERIC(5,4)    -- 0.0000–1.0000 worst-goal shortfall urgency
);

-- ── 9. daily_contact_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_contact_log (
    client_id                   VARCHAR(10)     PRIMARY KEY REFERENCES clients(client_id),
    advisor_id                  VARCHAR(10),
    last_contact_date           DATE,
    days_since_last_contact     INTEGER,
    first_contact_date          DATE,
    total_interactions_18m      INTEGER,
    advisor_initiated_count     INTEGER,
    client_initiated_count      INTEGER,
    response_rate               NUMERIC(4,2),
    avg_sentiment_score         NUMERIC(4,2),
    contacts_last_30_days       INTEGER,
    contacts_last_60_days       INTEGER,
    contacts_last_90_days       INTEGER,
    open_overdue_commitments    INTEGER,
    avg_days_between_contacts   NUMERIC(6,2),
    last_updated                DATE
);
