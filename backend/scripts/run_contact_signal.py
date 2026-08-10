"""
run_contact_signal.py
=====================
Standalone runner for the contact cadence signal.

For every client in the database this script:
  1. Reads AUM from `clients` and days_since_last_contact from
     `daily_contact_log` (the authoritative, nightly-refreshed source).
  2. Calls `contact_signal()` to produce a 0–1 score.
  3. UPSERTs contact_score into `client_scores`.
  4. Prints a formatted summary table sorted by contact_score descending.

Usage — inside the api Docker container
---------------------------------------
    docker compose exec api python -m scripts.run_contact_signal

Usage — directly on host (requires DB port-forwarded to localhost:5432)
-----------------------------------------------------------------------
    DATABASE_URL_SYNC=postgresql://advisoriq:advisoriq@localhost:5432/advisoriq \\
        python -m scripts.run_contact_signal

The script is intentionally idempotent: re-running it overwrites the
contact_score column in place and leaves all other columns untouched.
"""

import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

# ── Make backend package importable when run as __main__ ─────────────────────
# Adds the /backend directory (parent of /backend/scripts) to sys.path so that
# `from app.signals.contact_signal import ...` resolves correctly whether the
# script is run via `python -m scripts.run_contact_signal` from /backend or
# directly as `python scripts/run_contact_signal.py`.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.signals.contact_signal import contact_signal, aum_tier_cadence  # noqa: E402

# ── Database connection ───────────────────────────────────────────────────────

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://advisoriq:advisoriq@localhost:5432/advisoriq",
)


def connect() -> psycopg2.extensions.connection:
    print(f"Connecting to {DB_URL!r} …")
    return psycopg2.connect(DB_URL)


# ── Schema migration: add contact_score column if it doesn't exist ───────────

_ADD_COLUMN_SQL = """
ALTER TABLE client_scores
    ADD COLUMN IF NOT EXISTS contact_score NUMERIC(5, 4);
"""


def ensure_column(conn: psycopg2.extensions.connection) -> None:
    with conn.cursor() as cur:
        cur.execute(_ADD_COLUMN_SQL)
    conn.commit()
    print("  contact_score column ready.")


# ── Data fetch ────────────────────────────────────────────────────────────────

_FETCH_SQL = """
SELECT
    c.client_id,
    c.full_name,
    c.aum,
    COALESCE(d.days_since_last_contact, c.days_since_last_contact, 0)
        AS days_since_last_contact
FROM clients c
LEFT JOIN daily_contact_log d USING (client_id)
ORDER BY c.client_id;
"""


def fetch_clients(conn: psycopg2.extensions.connection) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(_FETCH_SQL)
        cols = [desc[0] for desc in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# ── Score computation ─────────────────────────────────────────────────────────

def compute_scores(clients: list[dict]) -> list[dict]:
    results = []
    for c in clients:
        aum  = float(c["aum"] or 0)
        days = int(c["days_since_last_contact"] or 0)
        tier_label, cadence = aum_tier_cadence(aum)
        score = contact_signal(days, aum)
        results.append({
            "client_id":              c["client_id"],
            "full_name":              c["full_name"],
            "aum":                    aum,
            "days_since_last_contact": days,
            "tier_label":             tier_label,
            "cadence_used":           cadence,
            "contact_score":          score,
        })
    return results


# ── Database write ────────────────────────────────────────────────────────────

_UPSERT_SQL = """
INSERT INTO client_scores (client_id, contact_score)
VALUES %s
ON CONFLICT (client_id) DO UPDATE
    SET contact_score = EXCLUDED.contact_score;
"""


def write_scores(conn: psycopg2.extensions.connection, results: list[dict]) -> None:
    rows = [(r["client_id"], round(r["contact_score"], 4)) for r in results]
    with conn.cursor() as cur:
        execute_values(cur, _UPSERT_SQL, rows)
    conn.commit()
    print(f"  Wrote contact_score for {len(rows)} clients.")


# ── Summary table ─────────────────────────────────────────────────────────────

def print_summary(results: list[dict]) -> None:
    # Sort by score descending (most overdue first)
    sorted_rows = sorted(results, key=lambda r: r["contact_score"], reverse=True)

    # Column widths
    W_ID    = 10
    W_NAME  = 28
    W_AUM   = 14
    W_DAYS  = 5
    W_TIER  = 18
    W_CAD   = 7
    W_SCORE = 7

    header = (
        f"{'client_id':<{W_ID}}  "
        f"{'name':<{W_NAME}}  "
        f"{'aum':>{W_AUM}}  "
        f"{'days':>{W_DAYS}}  "
        f"{'tier':<{W_TIER}}  "
        f"{'cad':>{W_CAD}}  "
        f"{'score':>{W_SCORE}}"
    )
    sep = "-" * len(header)

    print(f"\n{'Contact Signal — Results':^{len(header)}}")
    print(sep)
    print(header)
    print(sep)

    for r in sorted_rows:
        aum_fmt   = f"${r['aum']:>12,.0f}"
        score_bar = _score_bar(r["contact_score"])
        print(
            f"{r['client_id']:<{W_ID}}  "
            f"{r['full_name'][:W_NAME]:<{W_NAME}}  "
            f"{aum_fmt:>{W_AUM}}  "
            f"{r['days_since_last_contact']:>{W_DAYS}}  "
            f"{r['tier_label']:<{W_TIER}}  "
            f"{r['cadence_used']:>{W_CAD}}  "
            f"{r['contact_score']:>{W_SCORE}.4f}  {score_bar}"
        )

    print(sep)

    # Aggregate summary
    scores = [r["contact_score"] for r in results]
    at_cadence   = sum(1 for s in scores if s >= 1.0)
    overdue_75   = sum(1 for s in scores if s >= 0.75)
    on_track     = sum(1 for s in scores if s < 0.5)
    avg_score    = sum(scores) / len(scores) if scores else 0.0

    print(
        f"\n  Total clients : {len(results)}\n"
        f"  Avg score     : {avg_score:.4f}\n"
        f"  At/beyond cadence (score = 1.0) : {at_cadence}\n"
        f"  ≥ 75% of cadence (score ≥ 0.75) : {overdue_75}\n"
        f"  Healthy (score < 0.50)           : {on_track}\n"
    )


def _score_bar(score: float, width: int = 10) -> str:
    """ASCII progress bar for visual scanning."""
    filled = round(score * width)
    bar    = "█" * filled + "░" * (width - filled)
    return f"[{bar}]"


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    conn = connect()
    try:
        print("Step 1: ensuring contact_score column exists …")
        ensure_column(conn)

        print("Step 2: fetching client AUM + contact data …")
        clients = fetch_clients(conn)
        print(f"  Loaded {len(clients)} clients.")

        print("Step 3: computing contact_score …")
        results = compute_scores(clients)

        print("Step 4: writing scores to client_scores …")
        write_scores(conn, results)

        print_summary(results)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
