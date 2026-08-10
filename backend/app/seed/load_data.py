#!/usr/bin/env python3
"""
load_data.py — Seeds the AdvisorIQ database from synthetic JSON files.

Usage (inside the backend container or locally with DB running):
    python -m app.seed.load_data

Expects JSON files at /app/data/ (mounted from public/data/ via docker-compose).
Idempotent: uses INSERT ... ON CONFLICT DO NOTHING so re-runs are safe.
"""

import json
import os
import sys
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values

# Default: walk up from this file (backend/app/seed/load_data.py) to the
# repo root, then into public/data/.  Resolves correctly whether you run
# the script locally or inside the Docker container (where DATA_DIR is
# overridden to /app/data by docker-compose).
_REPO_ROOT = Path(__file__).parents[3]          # backend/app/seed → AdvisorIQ/
DATA_DIR = Path(os.getenv("DATA_DIR", str(_REPO_ROOT / "public" / "data")))
DB_URL   = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://advisoriq:advisoriq@db:5432/advisoriq",
)

SCHEMA_FILE = Path(__file__).parent / "sql" / "schema.sql"


def connect() -> psycopg2.extensions.connection:
    print(f"Connecting to {DB_URL!r} …")
    return psycopg2.connect(DB_URL)


def create_schema(conn):
    print("Creating schema …")
    with conn.cursor() as cur:
        cur.execute(SCHEMA_FILE.read_text())
    conn.commit()
    print("  Schema ready.")


def load_json(name: str) -> list[dict]:
    path = DATA_DIR / f"{name}.json"
    if not path.exists():
        print(f"  ⚠  {path} not found — skipping.")
        return []
    data = json.loads(path.read_text())
    return data if isinstance(data, list) else list(data.values())


def upsert(conn, table: str, rows: list[dict], pk: str) -> int:
    if not rows:
        return 0
    cols  = list(rows[0].keys())
    vals  = [[r.get(c) for c in cols] for r in rows]
    query = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT ({pk}) DO NOTHING"
    )
    with conn.cursor() as cur:
        execute_values(cur, query, vals)
    conn.commit()
    return len(rows)


def rename_scenario_flag(rows: list[dict]) -> list[dict]:
    """
    The source JSON uses 'nba_scenario_flag' to store a scenario-ID string
    (e.g. "S004"), not a boolean.  Our schema stores it as nba_scenario_id
    VARCHAR so we rename the key before upserting.
    """
    out = []
    for r in rows:
        row = dict(r)
        if "nba_scenario_flag" in row:
            row["nba_scenario_id"] = row.pop("nba_scenario_flag")
        out.append(row)
    return out


def seed_clients(conn):
    rows = rename_scenario_flag(load_json("clients"))
    n = upsert(conn, "clients", rows, "client_id")
    print(f"  clients: {n} rows")


def seed_households(conn):
    rows = load_json("households")
    # member_last_contact is a JSON string in the file — keep as-is (psycopg2 handles JSONB)
    n = upsert(conn, "households", rows, "household_id")
    print(f"  households: {n} rows")


def seed_daily_contact_log(conn):
    rows = load_json("daily_contact_log")
    n = upsert(conn, "daily_contact_log", rows, "client_id")
    print(f"  daily_contact_log: {n} rows")


def seed_goals(conn):
    rows = load_json("goals")
    n = upsert(conn, "goals", rows, "goal_id")
    print(f"  goals: {n} rows")


def seed_life_events(conn):
    rows = load_json("life_events")
    n = upsert(conn, "life_events", rows, "event_id")
    print(f"  life_events: {n} rows")


def seed_portfolio_snapshots(conn):
    rows = load_json("portfolio_snapshots")
    n = upsert(conn, "portfolio_snapshots", rows, "snapshot_id")
    print(f"  portfolio_snapshots: {n} rows")


def seed_product_holdings(conn):
    rows = load_json("product_holdings")
    n = upsert(conn, "product_holdings", rows, "holding_id")
    print(f"  product_holdings: {n} rows")


def seed_client_scores(conn):
    rows = rename_scenario_flag(load_json("client_scores"))
    n = upsert(conn, "client_scores", rows, "client_id")
    print(f"  client_scores: {n} rows")


def seed_interactions(conn):
    rows = load_json("interactions")
    n = upsert(conn, "interactions", rows, "interaction_id")
    print(f"  interactions: {n} rows")


def main():
    conn = connect()
    try:
        create_schema(conn)
        print("Seeding tables …")
        # Order matters: clients must exist before FK references
        seed_clients(conn)
        seed_households(conn)
        seed_daily_contact_log(conn)
        seed_goals(conn)
        seed_life_events(conn)
        seed_portfolio_snapshots(conn)
        seed_product_holdings(conn)
        seed_client_scores(conn)
        seed_interactions(conn)
        print("Done ✓")
    except Exception as exc:
        conn.rollback()
        print(f"Error: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
