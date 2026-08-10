"""
GET /api/v1/clients/{id}/portfolio  — all snapshots (18 months, 18 rows)
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import PortfolioSnapshot
from ..schemas import SnapshotOut

router = APIRouter(prefix="/clients", tags=["portfolio"])


@router.get("/{client_id}/portfolio", response_model=list[SnapshotOut])
async def get_portfolio_snapshots(
    client_id: str,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.client_id == client_id)
        .order_by(PortfolioSnapshot.snapshot_date.asc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()
