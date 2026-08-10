"""
GET /api/v1/clients                       — full pre-joined list (150 rows, ~1 ms)
GET /api/v1/clients/{id}/detail           — ALL tables joined (goals, interactions×50,
                                            contact_log, snapshot, holdings, life_events, household)
GET /api/v1/clients/{id}                  — single client detail (goals + last 10 interactions)
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select

from ..database import get_db
from ..models import Client, ClientScore, Goal, Interaction, Household
from ..schemas import ClientListItem, ClientDetail, ClientDetailFull

router = APIRouter(prefix="/clients", tags=["clients"])

# ─── Pre-joined list query ────────────────────────────────────────────────────
#
# Uses a LATERAL subquery to get the latest portfolio snapshot per client,
# and direct LEFT JOINs for the 1:1 tables. Runs in < 5 ms on 150 rows.

_LIST_SQL = text("""
SELECT
    c.client_id,
    c.advisor_id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.age,
    c.life_stage,
    c.aum,
    c.aum_tier,
    c.tenure_years,
    c.risk_tolerance,
    c.estate_docs_complete,
    c.insurance_adequate,
    c.segment_tag,
    c.city,
    c.household_id,
    -- pre-denormalised signals on clients table
    c.days_since_last_contact,
    c.latest_portfolio_drift_pct,
    c.open_commitment_count,
    c.product_gap_count,
    c.unactioned_life_event_flag,
    c.off_track_goal_count,
    c.nba_scenario_id,
    c.nba_expected_rank,
    -- daily_contact_log
    dcl.last_contact_date,
    dcl.total_interactions_18m,
    dcl.open_overdue_commitments,
    dcl.avg_sentiment_score,
    dcl.contacts_last_30_days,
    dcl.contacts_last_60_days,
    dcl.contacts_last_90_days,
    -- latest portfolio snapshot (LATERAL)
    ps.snapshot_date,
    ps.aum_value          AS snapshot_aum,
    ps.target_allocation_equity,
    ps.target_allocation_bonds,
    ps.target_allocation_cash,
    ps.actual_allocation_equity,
    ps.actual_allocation_bonds,
    ps.actual_allocation_cash,
    ps.drift_pct,
    ps.ytd_return,
    ps.benchmark_return,
    -- primary goal (priority_rank = 1)
    g.goal_id             AS primary_goal_id,
    g.goal_type           AS primary_goal_type,
    g.target_amount       AS primary_goal_target_amount,
    g.current_progress_pct AS primary_goal_progress_pct,
    g.target_date         AS primary_goal_target_date,
    g.on_track            AS primary_goal_on_track,
    -- client scores
    cs.nba_score,
    cs.nba_rank,
    cs.primary_urgency_reason
FROM clients c
LEFT JOIN daily_contact_log dcl ON dcl.client_id = c.client_id
LEFT JOIN LATERAL (
    SELECT *
    FROM portfolio_snapshots
    WHERE client_id = c.client_id
    ORDER BY snapshot_date DESC
    LIMIT 1
) ps ON true
LEFT JOIN goals g
    ON  g.client_id    = c.client_id
    AND g.priority_rank = 1
LEFT JOIN client_scores cs ON cs.client_id = c.client_id
WHERE c.advisor_id = :advisor_id
ORDER BY
    (c.nba_scenario_id IS NOT NULL) DESC,        -- scenario-flagged first
    c.days_since_last_contact DESC NULLS LAST    -- then longest silent
""")


@router.get("", response_model=list[ClientListItem])
async def list_clients(
    advisor_id: str = Query(default="ADV001", description="Filter by advisor"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(_LIST_SQL, {"advisor_id": advisor_id})
    rows = result.mappings().all()
    return [ClientListItem.model_validate(dict(row)) for row in rows]


# ─── Full client detail — all 8 tables ───────────────────────────────────────

@router.get("/{client_id}/detail", response_model=ClientDetailFull)
async def get_client_detail_full(
    client_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all tables for a single client in one round-trip:
      clients · daily_contact_log · portfolio_snapshots (latest)
      goals (all) · product_holdings · life_events · households · client_scores
    """
    stmt = (
        select(Client)
        .where(Client.client_id == client_id)
        .options(
            selectinload(Client.goals),
            selectinload(Client.score),
            selectinload(Client.contact_log),
            selectinload(Client.life_events),
            selectinload(Client.holdings),
            selectinload(Client.snapshots),
        )
    )
    result = await db.execute(stmt)
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client {client_id!r} not found")

    # Interactions: up to 50, newest first
    inter_result = await db.execute(
        select(Interaction)
        .where(Interaction.client_id == client_id)
        .order_by(Interaction.date.desc())
        .limit(50)
    )
    interactions = inter_result.scalars().all()

    # Household (no ORM relationship on Client → Household)
    household = None
    if client.household_id:
        hh_result = await db.execute(
            select(Household).where(Household.household_id == client.household_id)
        )
        household = hh_result.scalar_one_or_none()

    # Latest snapshot: relationship is ordered desc, first element is newest
    latest_snapshot = client.snapshots[0] if client.snapshots else None

    # Life events sorted newest first
    sorted_life_events = sorted(
        client.life_events,
        key=lambda e: e.event_date or date.min,
        reverse=True,
    )

    return ClientDetailFull(
        **{col.key: getattr(client, col.key) for col in Client.__table__.columns},
        goals=client.goals,
        interactions=interactions,
        score=client.score,
        contact_log=client.contact_log,
        latest_snapshot=latest_snapshot,
        product_holdings=client.holdings,
        life_events=sorted_life_events,
        household=household,
    )


# ─── Single client detail ─────────────────────────────────────────────────────

@router.get("/{client_id}", response_model=ClientDetail)
async def get_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Client)
        .where(Client.client_id == client_id)
        .options(
            selectinload(Client.goals),
            selectinload(Client.score),
        )
    )
    result = await db.execute(stmt)
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client {client_id!r} not found")

    # Load last 10 interactions separately (avoid loading 3 000+ rows by default)
    inter_stmt = (
        select(Interaction)
        .where(Interaction.client_id == client_id)
        .order_by(Interaction.date.desc())
        .limit(10)
    )
    inter_result = await db.execute(inter_stmt)
    interactions = inter_result.scalars().all()

    return ClientDetail(
        **{c.key: getattr(client, c.key) for c in Client.__table__.columns},
        goals=client.goals,
        interactions=interactions,
        score=client.score,
    )
