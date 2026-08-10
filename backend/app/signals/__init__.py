"""
signals — individual signal functions for the AdvisorIQ scoring engine.

Each module in this package computes one normalised 0→1 score from raw
client data.  Signals are intentionally pure (no I/O) so they can be
unit-tested and composed into the master equation independently.

Current signals
---------------
contact_signal  — contact cadence urgency (0 = just contacted, 1 = overdue)
"""
