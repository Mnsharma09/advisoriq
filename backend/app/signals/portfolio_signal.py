"""
portfolio_signal.py
===================
Signal engine — portfolio allocation drift urgency.

Computes a normalised 0→1 score that measures how far a client's actual
portfolio allocation has drifted from their target, across all tracked
asset classes (equity, bonds, cash).

Formula
-------
    total_drift_pct = (Σ |actual_i - target_i|) / 2  × 100

    Dividing by 2 converts the sum of absolute deviations into the total
    percentage of the portfolio that is misallocated (each over-weight is
    mirrored by an equal under-weight elsewhere, so the raw sum double-counts).

    portfolio_score = min(1.0, total_drift_pct / 30.0)

    0.0  →  perfectly aligned (0 % drift)
    0.5  →  moderate drift (15 % of portfolio misallocated)
    1.0  →  severe drift (≥ 30 % misallocated, cap applied)

Notes
-----
- The function accepts allocation values as proportions (0.0–1.0) as stored
  in the database (NUMERIC 5,4).  It returns drift as a percentage (0–100).
- Deliberately pure (no I/O) so it can be unit-tested and composed into the
  master scoring equation later.
- Only equity, bonds, and cash asset classes are modelled here; if additional
  classes are added to the schema, extend the parameter list accordingly.
"""

from typing import Union

_DRIFT_THRESHOLD: float = 30.0   # % drift that maps to score = 1.0


def portfolio_signal(
    target_equity: Union[float, None],
    actual_equity: Union[float, None],
    target_bonds:  Union[float, None],
    actual_bonds:  Union[float, None],
    target_cash:   Union[float, None],
    actual_cash:   Union[float, None],
) -> tuple[float, float]:
    """
    Compute the portfolio drift urgency score for a single client snapshot.

    Parameters
    ----------
    target_equity, actual_equity : float | None
        Target and actual equity allocation as proportions (0.0–1.0).
    target_bonds, actual_bonds : float | None
        Target and actual bond allocation as proportions (0.0–1.0).
    target_cash, actual_cash : float | None
        Target and actual cash allocation as proportions (0.0–1.0).
        None values are treated as 0 (no position / data not available).

    Returns
    -------
    (total_drift_pct, portfolio_score)
        total_drift_pct — percentage of portfolio that is misallocated (0–100).
        portfolio_score — normalised urgency score in [0.0, 1.0].
    """
    def _diff(actual: Union[float, None], target: Union[float, None]) -> float:
        return abs((actual or 0.0) - (target or 0.0))

    raw_sum = (
        _diff(actual_equity, target_equity)
        + _diff(actual_bonds,  target_bonds)
        + _diff(actual_cash,   target_cash)
    )
    total_drift_pct = (raw_sum / 2.0) * 100.0
    portfolio_score = min(1.0, total_drift_pct / _DRIFT_THRESHOLD)
    return total_drift_pct, portfolio_score
