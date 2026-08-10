"""
AdvisorIQ FastAPI application entry point.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import clients_router, interactions_router, portfolio_router, scores_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connection pool warms up automatically on first query
    yield
    # Shutdown: dispose connection pool
    from .database import engine
    await engine.dispose()


app = FastAPI(
    title="AdvisorIQ API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow all localhost ports so the dev server works regardless of which Vite port
# is assigned (5173, 5174, 5175, …). In production this list would be locked down.
_dev_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://localhost:4173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_dev_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
prefix = settings.api_prefix

app.include_router(clients_router,      prefix=prefix)
app.include_router(interactions_router, prefix=prefix)
app.include_router(portfolio_router,    prefix=prefix)
app.include_router(scores_router,       prefix=prefix)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
