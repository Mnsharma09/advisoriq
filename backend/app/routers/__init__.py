from .clients import router as clients_router
from .interactions import router as interactions_router
from .portfolio import router as portfolio_router
from .scores import router as scores_router

__all__ = ["clients_router", "interactions_router", "portfolio_router", "scores_router"]
