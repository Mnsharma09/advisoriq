"""
goals_signal.py
===============
Signal engine — goals urgency score.

Per-goal urgency
----------------
Uses the database's ``on_track`` flag (computed by the seeder's projection
model, which accounts for expected future contributions and growth) together
with ``current_progress_pct`` as the magnitude of how far the goal is from
completion.

    remaining = max(0, 1 - current_progress_pct / 100)

    if on_track:
        goal_urgency = remaining × 0.3
        # On-track goals are low-urgency: max possible = 0.30 (at 0 % progress)

    if not on_track:
        goal_urgency = remaining
        # Off-track goals carry full urgency proportional to remaining work

Client-level aggregation
------------------------
    worst_urgency = max(goal_urgency across all goals)
    goals_score   = min(1.0, worst_urgency)   # already 0–1; cap is a safety net

Urgency bands
-------------
    < 0.30 : healthy (all goals on-track; high-progress off-track edges)
    0.30–0.67 : moderate
    ≥ 0.67 : high — a substantially off-track goal with < 33 % progress

Anomaly threshold
-----------------
A client where every goal is ``on_track=True`` cannot exceed goals_score of
0.30 by construction (0.30 × 1.0 = 0.30, when progress = 0 %).  Any such
client with goals_score > 0.50 therefore indicates a data inconsistency.

Notes
-----
- Pure function (no I/O) — safe to unit-test and compose.
- ``current_progress_pct`` is assumed to be on a 0–100 scale as stored in DB.
"""

from __future__ import annotations

ON_TRACK_DAMPER:   float = 0.3    # on-track goals contribute at most 30 % urgency
ANOMALY_THRESHOLD: float = 0.50   # flag if all-on-track client exceeds this


# ── Per-goal helper ───────────────────────────────────────────────────────────

def goal_urgency(
    current_progress_pct: float,
    on_track: bool,
) -> float:
    """
    Compute urgency for a single goal.

    Parameters
    ----------
    current_progress_pct : float
        Percentage of the target already accumulated (0–100 scale).
    on_track : bool
        Whether the goal's projected trajectory (including future contributions
        and expected investment growth) reaches the target by the deadline.

    Returns
    -------
    float
        Urgency in [0.0, 1.0].
    """
    remaining = max(0.0, 1.0 - float(current_progress_pct) / 100.0)
    if on_track:
        return remaining * ON_TRACK_DAMPER
    return remaining


# ── Client-level aggregation ──────────────────────────────────────────────────

def goals_signal(
    goals: list[dict],
) -> tuple[float, float]:
    """
    Compute the goals urgency score for a client.

    Parameters
    ----------
    goals : list of dict
        Each dict must contain:
          - ``current_progress_pct`` (float): % of target accumulated (0–100).
          - ``on_track`` (bool | None): projection flag from the database.
            ``None`` is treated as ``False`` (conservative).

    Returns
    -------
    (worst_urgency, goals_score)
        worst_urgency — highest per-goal urgency (0–1), for reporting.
        goals_score   — min(1, worst_urgency); normalised signal in [0, 1].
        Both are 0.0 when the client has no goals.
    """
    if not goals:
        return 0.0, 0.0

    urgencies = [
        goal_urgency(
            float(g.get("current_progress_pct") or 0),
            bool(g.get("on_track")),          # None → False (conservative)
        )
        for g in goals
    ]

    worst = max(urgencies)
    score = min(1.0, worst)
    return worst, score
