"""
run_portfolio_signal.py
=======================
Standalone runner for the portfolio drift signal.

For every client this script:
  1. Fetches the most recent portfolio snapshot (equity/bonds/cash targets
     and actuals) from ``portfolio_snapshots``.
  2. Calls ``portfolio_signal()`` to produce total_drift_pct and a 0–1 score.
  3. UPSERTs portfolio_score into ``client_scores``.
  4. Prints a formatted summary table sorted by score descending.

Usage — inside the api Docker container
---------------------------------------
    docker compose exec api python -m scripts.run_portfolio_signal

Usage — directly on host (requires DB port-forwarded to localhost:5432)
-----------------------------------------------------------------------
    DATABASE_URL_SYNC=postgresql://advisoriq:advisoriq@localhost:5432/advisoriq \\
        python -m scripts.run_portfolio_signal

The script is idempotent: re-running overwrites portfolio_score in place
and leaves all other client_scores columns untouched.
"""

import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

# ── Make backend package importable ──────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.signals.portfolio_signal import portfolio_signal  # noqa: E402

# ── Database connection ───────────────────────────────────────────────────────

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://advisoriq:advisoriq@localhost:5432/advisoriq",
)


def connect() -> psycopg2.extensions.connection:
    print(f"Connecting to {DB_URL!r} …")
    return psycopg2.connect(DB_URL)


# ── Data fetch — latest snapshot per client ───────────────────────────────────
# DISTINCT ON (client_id) ordered by snapshot_date DESC picks the most
# recent row per client in a single pass — no correlated subquery needed.

_FETCH_SQL = """
SELECT DISTINCT ON (c.client_id)
    c.client_id,
    c.full_name,
    c.aum,
    ps.snapshot_date,
    ps.target_allocation_equity,
    ps.target_allocation_bonds,
    ps.target_allocation_cash,
    ps.actual_allocation_equity,
    ps.actual_allocation_bonds,
    ps.actual_allocation_cash
FROM clients c
LEFT JOIN portfolio_snapshots ps USING (client_id)
ORDER BY c.client_id, ps.snapshot_date DESC NULLS LAST;
"""


def fetch_clients(conn: psycopg2.extensions.connection) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(_FETCH_SQL)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# ── Score computation ─────────────────────────────────────────────────────────

def compute_scores(clients: list[dict]) -> list[dict]:
    results = []
    for c in clients:
        drift_pct, score = portfolio_signal(
            target_equity=float(c["target_allocation_equity"] or 0),
            actual_equity=float(c["actual_allocation_equity"] or 0),
            target_bonds= float(c["target_allocation_bonds"]  or 0),
            actual_bonds= float(c["actual_allocation_bonds"]  or 0),
            target_cash=  float(c["target_allocation_cash"]   or 0),
            actual_cash=  float(c["actual_allocation_cash"]   or 0),
        )
        results.append({
            "client_id":       c["client_id"],
            "full_name":       c["full_name"],
            "aum":             float(c["aum"] or 0),
            "snapshot_date":   c["snapshot_date"],
            "total_drift_pct": drift_pct,
            "portfolio_score": score,
        })
    return results


# ── Database write ────────────────────────────────────────────────────────────

_UPSERT_SQL = """
INSERT INTO client_scores (client_id, portfolio_score)
VALUES %s
ON CONFLICT (client_id) DO UPDATE
    SET portfolio_score = EXCLUDED.portfolio_score;
"""


def write_scores(conn: psycopg2.extensions.connection, results: list[dict]) -> None:
    rows = [(r["client_id"], round(r["portfolio_score"], 4)) for r in results]
    with conn.cursor() as cur:
        execute_values(cur, _UPSERT_SQL, rows)
    conn.commit()
    print(f"  Wrote portfolio_score for {len(rows)} clients.")


# ── Summary table ─────────────────────────────────────────────────────────────

def _score_bar(score: float, width: int = 10) -> str:
    filled = round(score * width)
    return f"[{'█' * filled}{'░' * (width - filled)}]"


def print_summary(results: list[dict]) -> None:
    sorted_rows = sorted(results, key=lambda r: r["portfolio_score"], reverse=True)

    W_ID    = 10
    W_NAME  = 28
    W_AUM   = 14
    W_DATE  = 12
    W_DRIFT = 10
    W_SCORE = 7

    header = (
        f"{'client_id':<{W_ID}}  "
        f"{'name':<{W_NAME}}  "
        f"{'aum':>{W_AUM}}  "
        f"{'snapshot':>{W_DATE}}  "
        f"{'drift_%':>{W_DRIFT}}  "
        f"{'score':>{W_SCORE}}"
    )
    sep = "-" * len(header)

    print(f"\n{'Portfolio Signal — Results':^{len(header)}}")
    print(sep)
    print(header)
    print(sep)

    for r in sorted_rows:
        aum_fmt  = f"${r['aum']:>12,.0f}"
        date_str = str(r["snapshot_date"]) if r["snapshot_date"] else "N/A"
        bar      = _score_bar(r["portfolio_score"])
        print(
            f"{r['client_id']:<{W_ID}}  "
            f"{r['full_name'][:W_NAME]:<{W_NAME}}  "
            f"{aum_fmt:>{W_AUM}}  "
            f"{date_str:>{W_DATE}}  "
            f"{r['total_drift_pct']:>{W_DRIFT}.2f}  "
            f"{r['portfolio_score']:>{W_SCORE}.4f}  {bar}"
        )

    print(sep)

    scores = [r["portfolio_score"] for r in results]
    drifts = [r["total_drift_pct"] for r in results]
    avg_score    = sum(scores) / len(scores) if scores else 0.0
    avg_drift    = sum(drifts) / len(drifts) if drifts else 0.0
    at_cap       = sum(1 for s in scores if s >= 1.0)
    high_risk    = sum(1 for s in scores if s >= 0.67)
    healthy      = sum(1 for s in scores if s < 0.33)

    print(
        f"\n  Total clients  : {len(results)}\n"
        f"  Avg drift      : {avg_drift:.2f}%\n"
        f"  Avg score      : {avg_score:.4f}\n"
        f"  Capped (≥30% drift, score=1.0) : {at_cap}\n"
        f"  High risk      (score ≥ 0.67)  : {high_risk}\n"
        f"  Healthy        (score < 0.33)  : {healthy}\n"
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    conn = connect()
    try:
        print("Step 1: fetching latest portfolio snapshots …")
        clients = fetch_clients(conn)
        print(f"  Loaded {len(clients)} clients.")

        print("Step 2: computing portfolio_score …")
        results = compute_scores(clients)

        print("Step 3: writing scores to client_scores …")
        write_scores(conn, results)

        print_summary(results)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
