"""
GET /api/v1/scores  — ranked client scores for the NBA queue
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ClientScore
from ..schemas import ScoreOut

router = APIRouter(prefix="/scores", tags=["scores"])


@router.get("", response_model=list[ScoreOut])
async def list_scores(
    advisor_id: str = Query(default="ADV001"),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ClientScore)
        .where(ClientScore.advisor_id == advisor_id)
        .order_by(
            ClientScore.nba_scenario_flag.desc().nullslast(),
            ClientScore.nba_rank.asc().nullslast(),
        )
    )
    result = await db.execute(stmt)
    return result.scalars().all()
