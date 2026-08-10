"""
GET /api/v1/clients/{id}/interactions  — paginated interaction history
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Interaction
from ..schemas import InteractionOut

router = APIRouter(prefix="/clients", tags=["interactions"])


@router.get("/{client_id}/interactions", response_model=list[InteractionOut])
async def get_interactions(
    client_id: str,
    limit: int  = Query(default=25, le=200),
    offset: int = Query(default=0,  ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Interaction)
        .where(Interaction.client_id == client_id)
        .order_by(Interaction.date.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
