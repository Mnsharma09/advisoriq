"""
run_goals_signal.py
===================
Standalone runner for the goals urgency signal.

For every client this script:
  1. Fetches all goals from the ``goals`` table.
  2. Calls ``goals_signal()`` to compute per-client worst urgency and score.
  3. UPSERTs ``goals_score`` into ``client_scores`` (overwrites prior values).
  4. Prints a summary table sorted by score descending.
  5. Flags any anomalous client where ALL goals are on_track=True but
     goals_score > 0.50 — by construction this should not be possible with
     the current formula (max on-track urgency = 0.30), so any such hit
     indicates a data inconsistency.

Usage — inside the api Docker container
---------------------------------------
    docker compose exec api python -m scripts.run_goals_signal

Usage — directly on host (requires DB port-forwarded to localhost:5432)
-----------------------------------------------------------------------
    DATABASE_URL_SYNC=postgresql://advisoriq:advisoriq@localhost:5432/advisoriq \\
        python -m scripts.run_goals_signal

Formula (see app/signals/goals_signal.py for full details)
----------------------------------------------------------
    remaining     = max(0, 1 - current_progress_pct / 100)
    goal_urgency  = remaining × 0.3  if on_track else remaining
    worst_urgency = max(goal_urgency across all goals)
    goals_score   = min(1.0, worst_urgency)
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

from app.signals.goals_signal import goals_signal, ANOMALY_THRESHOLD  # noqa: E402

# ── Database connection ───────────────────────────────────────────────────────

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://advisoriq:advisoriq@localhost:5432/advisoriq",
)


def connect() -> psycopg2.extensions.connection:
    print(f"Connecting to {DB_URL!r} …")
    return psycopg2.connect(DB_URL)


# ── Data fetch ────────────────────────────────────────────────────────────────

_FETCH_SQL = """
SELECT
    c.client_id,
    c.full_name,
    c.aum,
    g.goal_id,
    g.goal_type,
    g.current_progress_pct,
    g.on_track
FROM clients c
LEFT JOIN goals g USING (client_id)
ORDER BY c.client_id, g.priority_rank NULLS LAST;
"""


def fetch_data(conn: psycopg2.extensions.connection) -> dict[str, dict]:
    with conn.cursor() as cur:
        cur.execute(_FETCH_SQL)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]

    clients: dict[str, dict] = {}
    for row in rows:
        cid = row["client_id"]
        if cid not in clients:
            clients[cid] = {
                "client_id": cid,
                "full_name": row["full_name"],
                "aum":       float(row["aum"] or 0),
                "goals":     [],
            }
        if row["goal_id"] is not None:
            clients[cid]["goals"].append({
                "goal_id":             row["goal_id"],
                "goal_type":           row["goal_type"],
                "current_progress_pct": float(row["current_progress_pct"] or 0),
                "on_track":            row["on_track"],
            })

    return clients


# ── Score computation ─────────────────────────────────────────────────────────

def compute_scores(clients: dict[str, dict]) -> list[dict]:
    results = []
    for c in clients.values():
        goals       = c["goals"]
        num_goals   = len(goals)
        off_track   = sum(1 for g in goals if g["on_track"] is False)
        all_on_track = num_goals > 0 and off_track == 0

        worst_urgency, score = goals_signal(goals)

        anomaly = all_on_track and score > ANOMALY_THRESHOLD

        results.append({
            "client_id":      c["client_id"],
            "full_name":      c["full_name"],
            "aum":            c["aum"],
            "num_goals":      num_goals,
            "off_track":      off_track,
            "all_on_track":   all_on_track,
            "worst_urgency":  worst_urgency,
            "goals_score":    score,
            "anomaly":        anomaly,
        })
    return results


# ── Database write ────────────────────────────────────────────────────────────

_UPSERT_SQL = """
INSERT INTO client_scores (client_id, goals_score)
VALUES %s
ON CONFLICT (client_id) DO UPDATE
    SET goals_score = EXCLUDED.goals_score;
"""


def write_scores(conn: psycopg2.extensions.connection, results: list[dict]) -> None:
    rows = [(r["client_id"], round(r["goals_score"], 4)) for r in results]
    with conn.cursor() as cur:
        execute_values(cur, _UPSERT_SQL, rows)
    conn.commit()
    print(f"  Wrote goals_score for {len(rows)} clients.")


# ── Output helpers ────────────────────────────────────────────────────────────

def _score_bar(score: float, width: int = 10) -> str:
    filled = round(score * width)
    return f"[{'█' * filled}{'░' * (width - filled)}]"


def print_summary(results: list[dict]) -> None:
    sorted_rows = sorted(results, key=lambda r: r["goals_score"], reverse=True)

    W_ID     = 10
    W_NAME   = 28
    W_GOALS  = 6
    W_OFFTR  = 7
    W_URG    = 10
    W_SCORE  = 7
    W_FLAG   = 12   # "ANOMALY" column

    header = (
        f"{'client_id':<{W_ID}}  "
        f"{'name':<{W_NAME}}  "
        f"{'goals':>{W_GOALS}}  "
        f"{'off_tr':>{W_OFFTR}}  "
        f"{'urgency':>{W_URG}}  "
        f"{'score':>{W_SCORE}}  "
        f"{'flag':<{W_FLAG}}"
    )
    sep = "-" * len(header)

    print(f"\n{'Goals Signal — Results':^{len(header)}}")
    print(sep)
    print(header)
    print(sep)

    anomalies = []
    for r in sorted_rows:
        flag = "⚠  ANOMALY" if r["anomaly"] else ""
        bar  = _score_bar(r["goals_score"])
        print(
            f"{r['client_id']:<{W_ID}}  "
            f"{r['full_name'][:W_NAME]:<{W_NAME}}  "
            f"{r['num_goals']:>{W_GOALS}}  "
            f"{r['off_track']:>{W_OFFTR}}  "
            f"{r['worst_urgency']:>{W_URG}.4f}  "
            f"{r['goals_score']:>{W_SCORE}.4f}  "
            f"{flag:<{W_FLAG}}  {bar}"
        )
        if r["anomaly"]:
            anomalies.append(r)

    print(sep)

    # ── Distribution summary ──────────────────────────────────────────────────
    scores   = [r["goals_score"] for r in results]
    avg_s    = sum(scores) / len(scores) if scores else 0.0
    capped   = sum(1 for s in scores if s >= 1.0)
    high     = sum(1 for s in scores if s >= 0.67)
    healthy  = sum(1 for s in scores if s  < 0.33)
    moderate = len(scores) - high - healthy

    print(
        f"\n  Total clients     : {len(results)}\n"
        f"  Avg goals_score   : {avg_s:.4f}\n"
        f"\n  Distribution\n"
        f"  ─────────────────────────────────────\n"
        f"  Capped  (score = 1.0)    : {capped:>3}\n"
        f"  High    (score ≥ 0.67)   : {high:>3}   (includes capped)\n"
        f"  Moderate(0.33–0.67)      : {moderate:>3}\n"
        f"  Healthy (score < 0.33)   : {healthy:>3}\n"
    )

    # ── Anomaly report ────────────────────────────────────────────────────────
    print(f"  Anomaly check (all on_track=True but goals_score > {ANOMALY_THRESHOLD})")
    print(f"  ─────────────────────────────────────")
    if anomalies:
        for r in anomalies:
            print(f"  ⚠  {r['client_id']}  {r['full_name']:<28}  "
                  f"goals={r['num_goals']}  score={r['goals_score']:.4f}")
    else:
        print(f"  ✓ No anomalies — formula is self-consistent.")
    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    conn = connect()
    try:
        print("Step 1: fetching clients and goals …")
        clients = fetch_data(conn)
        print(f"  Loaded {len(clients)} clients.")

        print("Step 2: computing goals_score …")
        results = compute_scores(clients)

        print("Step 3: writing scores to client_scores …")
        write_scores(conn, results)

        print_summary(results)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
