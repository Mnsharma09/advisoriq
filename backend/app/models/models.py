"""
SQLAlchemy ORM models — one class per table.
All 9 core tables are defined here.
"""

from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import (
    Boolean, Column, Date, DateTime, Integer, Numeric,
    String, Text, ForeignKey, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from ..database import Base


class Client(Base):
    __tablename__ = "clients"

    client_id                   = Column(String(10), primary_key=True)
    advisor_id                  = Column(String(10), nullable=False)
    full_name                   = Column(String(255), nullable=False)
    first_name                  = Column(String(100))
    last_name                   = Column(String(100))
    gender                      = Column(String(1))
    age                         = Column(Integer)
    age_band                    = Column(String(20))
    life_stage                  = Column(String(50))
    life_stage_change_date      = Column(Date)
    aum                         = Column(Numeric(15, 2))
    aum_tier                    = Column(String(50))
    tenure_years                = Column(Numeric(5, 2))
    risk_tolerance              = Column(String(20))
    risk_score_target           = Column(Numeric(4, 2))
    risk_score_current          = Column(Numeric(4, 2))
    estate_docs_complete        = Column(Boolean)
    insurance_adequate          = Column(Boolean)
    last_review_date            = Column(Date)
    next_review_date            = Column(Date)
    review_overdue_flag         = Column(Boolean)
    tax_year_end_flag           = Column(Boolean)
    household_id                = Column(String(10))
    is_primary_in_household     = Column(Boolean)
    referral_source             = Column(String(100))
    segment_tag                 = Column(String(50))
    city                        = Column(String(100))
    days_since_last_contact     = Column(Integer)
    latest_portfolio_drift_pct  = Column(Numeric(5, 2))
    open_commitment_count       = Column(Integer)
    product_gap_count           = Column(Integer)
    unactioned_life_event_flag  = Column(Boolean)
    off_track_goal_count        = Column(Integer)
    nba_scenario_id             = Column(String(20))
    nba_expected_rank           = Column(String(20))
    created_at                  = Column(DateTime, server_default=func.now())
    updated_at                  = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    contact_log     = relationship("DailyContactLog", back_populates="client", uselist=False)
    score           = relationship("ClientScore",      back_populates="client", uselist=False)
    goals           = relationship("Goal",             back_populates="client", order_by="Goal.priority_rank")
    interactions    = relationship("Interaction",      back_populates="client", order_by="Interaction.date.desc()")
    life_events     = relationship("LifeEvent",        back_populates="client")
    snapshots       = relationship("PortfolioSnapshot",back_populates="client", order_by="PortfolioSnapshot.snapshot_date.desc()")
    holdings        = relationship("ProductHolding",   back_populates="client")


class Household(Base):
    __tablename__ = "households"

    household_id        = Column(String(10), primary_key=True)
    primary_client_id   = Column(String(10), ForeignKey("clients.client_id"))
    member_ids          = Column(Text)
    member_count        = Column(Integer)
    total_household_aum = Column(Numeric(15, 2))
    engagement_score    = Column(Numeric(5, 2))
    wealth_transfer_flag= Column(Boolean)
    next_gen_engaged    = Column(Boolean)
    member_last_contact = Column(JSONB)


class Interaction(Base):
    __tablename__ = "interactions"

    interaction_id       = Column(String(10), primary_key=True)
    client_id            = Column(String(10), ForeignKey("clients.client_id"))
    advisor_id           = Column(String(10))
    date                 = Column(Date)
    type                 = Column(String(50))
    initiated_by         = Column(String(20))
    duration_minutes     = Column(Integer)
    outcome              = Column(String(100))
    sentiment            = Column(String(20))
    topics_discussed     = Column(Text)
    commitment_made      = Column(Boolean)
    commitment_fulfilled = Column(Boolean)
    follow_up_created    = Column(Boolean)
    follow_up_due_date   = Column(Date)

    client = relationship("Client", back_populates="interactions")


class Goal(Base):
    __tablename__ = "goals"

    goal_id              = Column(String(10), primary_key=True)
    client_id            = Column(String(10), ForeignKey("clients.client_id"))
    goal_type            = Column(String(50))
    target_amount        = Column(Numeric(15, 2))
    current_progress_pct = Column(Numeric(5, 2))
    target_date          = Column(Date)
    on_track             = Column(Boolean)
    last_reviewed_date   = Column(Date)
    priority_rank        = Column(Integer)
    years_to_target      = Column(Numeric(5, 2))

    client = relationship("Client", back_populates="goals")


class LifeEvent(Base):
    __tablename__ = "life_events"

    event_id         = Column(String(10), primary_key=True)
    client_id        = Column(String(10), ForeignKey("clients.client_id"))
    event_type       = Column(String(50))
    event_date       = Column(Date)
    urgency_level    = Column(String(20))
    advisor_aware    = Column(Boolean)
    action_taken     = Column(Boolean)
    days_since_event = Column(Integer)

    client = relationship("Client", back_populates="life_events")


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    snapshot_id                  = Column(String(10), primary_key=True)
    client_id                    = Column(String(10), ForeignKey("clients.client_id"))
    snapshot_date                = Column(Date)
    aum_value                    = Column(Numeric(15, 2))
    target_allocation_equity     = Column(Numeric(5, 4))
    target_allocation_bonds      = Column(Numeric(5, 4))
    target_allocation_cash       = Column(Numeric(5, 4))
    actual_allocation_equity     = Column(Numeric(5, 4))
    actual_allocation_bonds      = Column(Numeric(5, 4))
    actual_allocation_cash       = Column(Numeric(5, 4))
    drift_pct                    = Column(Numeric(5, 2))
    goal_progress_pct            = Column(Numeric(5, 2))
    ytd_return                   = Column(Numeric(8, 4))
    benchmark_return             = Column(Numeric(8, 4))
    risk_score                   = Column(Numeric(4, 2))

    client = relationship("Client", back_populates="snapshots")


class ProductHolding(Base):
    __tablename__ = "product_holdings"

    holding_id      = Column(String(10), primary_key=True)
    client_id       = Column(String(10), ForeignKey("clients.client_id"))
    product_type    = Column(String(50))
    held            = Column(Boolean)
    start_date      = Column(Date)
    review_due_date = Column(Date)
    flagged_as_gap  = Column(Boolean)

    client = relationship("Client", back_populates="holdings")


class ClientScore(Base):
    __tablename__ = "client_scores"

    client_id                  = Column(String(10), ForeignKey("clients.client_id"), primary_key=True)
    advisor_id                 = Column(String(10))
    score_date                 = Column(Date)
    relationship_score         = Column(Numeric(5, 2))
    portfolio_score            = Column(Numeric(5, 2))
    household_score            = Column(Numeric(5, 2))
    book_score                 = Column(Numeric(5, 2))
    advisor_performance_score  = Column(Numeric(5, 2))
    days_since_contact         = Column(Integer)
    portfolio_drift_pct        = Column(Numeric(5, 2))
    goal_progress_pct          = Column(Numeric(5, 2))
    product_gap_count          = Column(Integer)
    life_event_urgency         = Column(String(20))
    interaction_multiplier     = Column(Numeric(4, 2))
    aum_multiplier             = Column(Numeric(4, 2))
    nba_score                  = Column(Numeric(5, 2))
    nba_rank                   = Column(Integer)
    primary_urgency_reason     = Column(Text)
    recommended_action         = Column(Text)
    nba_scenario_id            = Column(String(20))   # raw S001-S005 identifier
    nba_expected_rank          = Column(String(20))   # "top_5" / "top_10" / etc.
    score_validated            = Column(Boolean)
    # ── Signal engine outputs (populated independently of the NBA score) ──────
    contact_score              = Column(Numeric(5, 4))  # 0.0000–1.0000
    goals_score                = Column(Numeric(5, 4))  # 0.0000–1.0000

    client = relationship("Client", back_populates="score")


class DailyContactLog(Base):
    __tablename__ = "daily_contact_log"

    client_id                 = Column(String(10), ForeignKey("clients.client_id"), primary_key=True)
    advisor_id                = Column(String(10))
    last_contact_date         = Column(Date)
    days_since_last_contact   = Column(Integer)
    first_contact_date        = Column(Date)
    total_interactions_18m    = Column(Integer)
    advisor_initiated_count   = Column(Integer)
    client_initiated_count    = Column(Integer)
    response_rate             = Column(Numeric(4, 2))
    avg_sentiment_score       = Column(Numeric(4, 2))
    contacts_last_30_days     = Column(Integer)
    contacts_last_60_days     = Column(Integer)
    contacts_last_90_days     = Column(Integer)
    open_overdue_commitments  = Column(Integer)
    avg_days_between_contacts = Column(Numeric(6, 2))
    last_updated              = Column(Date)

    client = relationship("Client", back_populates="contact_log")
