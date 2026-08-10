"""
contact_signal.py
=================
Signal engine — contact cadence urgency.

Computes a normalised 0→1 score that measures how overdue an advisor is
in reaching out to a client, relative to the expected cadence for that
client's AUM tier.

Formula
-------
    contact_score = min(1.0, days_since_last_contact / expected_cadence)

    0.0  →  contacted today (no urgency)
    0.5  →  halfway through the cadence window (moderate urgency)
    1.0  →  at or beyond the expected cadence (full urgency, cap applied)

AUM tier cadences
-----------------
    High  (AUM > $2 M)          : 30-day cadence
    Mid   (AUM $500 K – $2 M)   : 60-day cadence
    Lower (AUM < $500 K)        : 90-day cadence

These thresholds reflect industry norms: high-AUM clients require more
frequent proactive touchpoints to maintain relationship strength and
reduce attrition risk.

Notes
-----
- The function is deliberately pure (no I/O, no side effects) so it can
  be unit-tested and later composed into the master scoring equation.
- Integer `days_since_last_contact` is expected; fractional values are
  accepted and handled correctly.
- A negative `days_since_last_contact` (data anomaly) is clamped to 0.
"""

from decimal import Decimal
from typing import Union

# ── AUM tier boundaries (USD) ─────────────────────────────────────────────────

AUM_HIGH_THRESHOLD: float = 2_000_000   # above this → High tier
AUM_MID_THRESHOLD:  float =   500_000   # above this, ≤ High → Mid tier
# below AUM_MID_THRESHOLD → Lower tier

# ── Expected contact cadences (calendar days) ─────────────────────────────────

CADENCE_HIGH:  int = 30   # High AUM  (> $2M)
CADENCE_MID:   int = 60   # Mid AUM   ($500K – $2M)
CADENCE_LOWER: int = 90   # Lower AUM (< $500K)


def aum_tier_cadence(aum: Union[float, Decimal, int]) -> tuple[str, int]:
    """
    Classify a client by AUM tier and return the expected cadence.

    Parameters
    ----------
    aum : float | Decimal | int
        Client AUM in USD.

    Returns
    -------
    (tier_label, expected_cadence_days)
        tier_label        — human-readable tier name for reporting.
        expected_cadence  — calendar days between expected contacts.
    """
    aum_f = float(aum)
    if aum_f > AUM_HIGH_THRESHOLD:
        return "High (>$2M)",        CADENCE_HIGH
    if aum_f >= AUM_MID_THRESHOLD:
        return "Mid ($500K–$2M)",    CADENCE_MID
    return     "Lower (<$500K)",     CADENCE_LOWER


def contact_signal(
    days_since_last_contact: Union[int, float],
    aum: Union[float, Decimal, int],
) -> float:
    """
    Compute the contact urgency score for a single client.

    Parameters
    ----------
    days_since_last_contact : int | float
        Calendar days elapsed since the last advisor–client touchpoint.
        Negative values (data anomaly) are treated as 0.
    aum : float | Decimal | int
        Client's assets under management in USD.

    Returns
    -------
    float
        contact_score in [0.0, 1.0]
        0.0 = contacted today, 1.0 = at or beyond expected cadence.
    """
    days  = max(0, float(days_since_last_contact))
    _, cadence = aum_tier_cadence(aum)
    return min(1.0, days / cadence)
