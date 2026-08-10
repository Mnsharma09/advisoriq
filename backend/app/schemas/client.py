"""
Pydantic v2 response schemas.

ClientListItem  — compact row returned by GET /clients (pre-joined).
ClientDetail    — full profile returned by GET /clients/{id}.
InteractionOut  — single interaction row.
SnapshotOut     — portfolio snapshot row.
ScoreOut        — client_scores row.
"""

from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, model_validator


# ─── Shared config ────────────────────────────────────────────────────────────

class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ─── Sub-schemas ──────────────────────────────────────────────────────────────

class AllocationItem(_Base):
    asset_class: str
    target: float
    current: float


class GoalOut(_Base):
    goal_id: str
    goal_type: Optional[str]
    target_amount: Optional[Decimal]
    current_progress_pct: Optional[Decimal]
    target_date: Optional[date]
    on_track: Optional[bool]
    priority_rank: Optional[int]


class InteractionOut(_Base):
    interaction_id: str
    date: Optional[date]
    type: Optional[str]
    initiated_by: Optional[str]
    duration_minutes: Optional[int]
    outcome: Optional[str]
    sentiment: Optional[str]
    topics_discussed: Optional[str]
    commitment_made: Optional[bool]
    follow_up_created: Optional[bool]
    follow_up_due_date: Optional[date]


class SnapshotOut(_Base):
    snapshot_id: str
    snapshot_date: Optional[date]
    aum_value: Optional[Decimal]
    target_allocation_equity: Optional[Decimal]
    target_allocation_bonds: Optional[Decimal]
    target_allocation_cash: Optional[Decimal]
    actual_allocation_equity: Optional[Decimal]
    actual_allocation_bonds: Optional[Decimal]
    actual_allocation_cash: Optional[Decimal]
    drift_pct: Optional[Decimal]
    goal_progress_pct: Optional[Decimal]
    ytd_return: Optional[Decimal]
    benchmark_return: Optional[Decimal]
    risk_score: Optional[Decimal]


class ScoreOut(_Base):
    nba_score: Optional[Decimal]
    nba_rank: Optional[int]
    primary_urgency_reason: Optional[str]
    recommended_action: Optional[str]
    nba_scenario_id: Optional[str]            # raw S001-S005 identifier
    nba_scenario_flag: Optional[bool] = None  # computed: nba_scenario_id IS NOT NULL
    nba_expected_rank: Optional[str]    # "top_5" / "top_10" / "top_15" / "top_20"
    score_validated: Optional[bool]

    @model_validator(mode="after")
    def compute_scenario_flag(self) -> "ScoreOut":
        self.nba_scenario_flag = self.nba_scenario_id is not None
        return self


# ─── Client list item (compact, pre-joined) ────────────────────────────────────

class ClientListItem(_Base):
    """
    Returned by GET /api/v1/clients.
    Contains all fields the frontend needs to build the client list,
    NBA queue, and cross-book intelligence — with no follow-up requests.
    """
    # Identity
    client_id:                  str
    advisor_id:                 str
    full_name:                  str
    first_name:                 Optional[str]
    last_name:                  Optional[str]
    age:                        Optional[int]
    life_stage:                 Optional[str]
    aum:                        Optional[Decimal]
    aum_tier:                   Optional[str]
    tenure_years:               Optional[Decimal]
    risk_tolerance:             Optional[str]
    estate_docs_complete:       Optional[bool]
    insurance_adequate:         Optional[bool]
    segment_tag:                Optional[str]
    city:                       Optional[str]
    household_id:               Optional[str]
    # Pre-denormalised signals
    days_since_last_contact:    Optional[int]
    latest_portfolio_drift_pct: Optional[Decimal]
    open_commitment_count:      Optional[int]
    product_gap_count:          Optional[int]
    unactioned_life_event_flag: Optional[bool]
    off_track_goal_count:       Optional[int]
    nba_scenario_id:            Optional[str]            # raw scenario code
    nba_scenario_flag:          Optional[bool] = None    # computed
    nba_expected_rank:          Optional[str]            # "top_5" / "top_10" / "top_15" / "top_20"
    # From daily_contact_log (joined)
    last_contact_date:              Optional[date]
    total_interactions_18m:         Optional[int]
    open_overdue_commitments:       Optional[int]
    avg_sentiment_score:            Optional[Decimal]
    contacts_last_30_days:          Optional[int]
    contacts_last_60_days:          Optional[int]
    contacts_last_90_days:          Optional[int]
    # From portfolio_snapshots latest (joined)
    snapshot_date:                  Optional[date]
    snapshot_aum:                   Optional[Decimal]
    target_allocation_equity:       Optional[Decimal]
    target_allocation_bonds:        Optional[Decimal]
    target_allocation_cash:         Optional[Decimal]
    actual_allocation_equity:       Optional[Decimal]
    actual_allocation_bonds:        Optional[Decimal]
    actual_allocation_cash:         Optional[Decimal]
    drift_pct:                      Optional[Decimal]
    ytd_return:                     Optional[Decimal]
    benchmark_return:               Optional[Decimal]
    # From goals priority_rank=1 (joined)
    primary_goal_id:                Optional[str]
    primary_goal_type:              Optional[str]
    primary_goal_target_amount:     Optional[Decimal]
    primary_goal_progress_pct:      Optional[Decimal]
    primary_goal_target_date:       Optional[date]
    primary_goal_on_track:          Optional[bool]
    # From client_scores (joined)
    nba_score:                      Optional[Decimal]
    nba_rank:                       Optional[int]
    primary_urgency_reason:         Optional[str]

    @model_validator(mode="after")
    def compute_scenario_flag(self) -> "ClientListItem":
        self.nba_scenario_flag = self.nba_scenario_id is not None
        return self


# ─── Sub-schemas for detail endpoint ─────────────────────────────────────────

class ContactLogOut(_Base):
    last_contact_date:          Optional[date]
    days_since_last_contact:    Optional[int]
    total_interactions_18m:     Optional[int]
    advisor_initiated_count:    Optional[int]
    client_initiated_count:     Optional[int]
    response_rate:              Optional[Decimal]
    avg_sentiment_score:        Optional[Decimal]
    contacts_last_30_days:      Optional[int]
    contacts_last_60_days:      Optional[int]
    contacts_last_90_days:      Optional[int]
    open_overdue_commitments:   Optional[int]
    avg_days_between_contacts:  Optional[Decimal]


class ProductHoldingOut(_Base):
    holding_id:      str
    product_type:    Optional[str]
    held:            Optional[bool]
    start_date:      Optional[date]
    review_due_date: Optional[date]
    flagged_as_gap:  Optional[bool]


class LifeEventOut(_Base):
    event_id:         str
    event_type:       Optional[str]
    event_date:       Optional[date]
    urgency_level:    Optional[str]
    advisor_aware:    Optional[bool]
    action_taken:     Optional[bool]
    days_since_event: Optional[int]


class HouseholdOut(_Base):
    household_id:          str
    primary_client_id:     Optional[str]
    member_ids:            Optional[str]   # pipe-separated client IDs
    member_count:          Optional[int]
    total_household_aum:   Optional[Decimal]
    engagement_score:      Optional[Decimal]
    wealth_transfer_flag:  Optional[bool]
    next_gen_engaged:      Optional[bool]


# ─── Client detail (full profile) ────────────────────────────────────────────

class ClientDetail(_Base):
    """
    Returned by GET /api/v1/clients/{client_id}.
    Includes full goal list, recent interactions, and scores.
    Heavy interactions and full snapshot history are paginated separately.
    """
    client_id:              str
    advisor_id:             str
    full_name:              str
    first_name:             Optional[str]
    last_name:              Optional[str]
    age:                    Optional[int]
    life_stage:             Optional[str]
    aum:                    Optional[Decimal]
    aum_tier:               Optional[str]
    tenure_years:           Optional[Decimal]
    risk_tolerance:         Optional[str]
    risk_score_target:      Optional[Decimal]
    risk_score_current:     Optional[Decimal]
    estate_docs_complete:   Optional[bool]
    insurance_adequate:     Optional[bool]
    last_review_date:       Optional[date]
    next_review_date:       Optional[date]
    segment_tag:            Optional[str]
    city:                   Optional[str]
    household_id:           Optional[str]
    nba_scenario_id:        Optional[str]  = None   # raw S001-S005 (passed from ORM)
    nba_scenario_flag:      Optional[bool] = None   # computed below if needed
    nba_expected_rank:      Optional[str]  = None

    # Nested
    goals:          list[GoalOut]       = []
    interactions:   list[InteractionOut]= []   # last 10
    score:          Optional[ScoreOut]  = None


# ─── Client detail full (all tables) ─────────────────────────────────────────

class ClientDetailFull(ClientDetail):
    """
    Returned by GET /api/v1/clients/{client_id}/detail.
    Extends ClientDetail with all remaining tables joined:
    daily_contact_log, latest portfolio_snapshot, product_holdings,
    life_events (sorted desc), and household context.
    Interactions cap is raised to 50.
    """
    contact_log:      Optional[ContactLogOut]   = None
    latest_snapshot:  Optional[SnapshotOut]     = None
    product_holdings: list[ProductHoldingOut]   = []
    life_events:      list[LifeEventOut]        = []
    household:        Optional[HouseholdOut]    = None
