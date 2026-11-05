---
"@usestrider/browser": patch
---
Preserve Firefox viewport and device scale overrides across nested declarations, release, and user context creation.

Restore remaining Firefox viewports independently when another target rejects cleanup, and skip pages and contexts already closing. Roll back failed or interrupted context viewport setup under a separate cleanup deadline. Rejected or timed-out native cleanup now warns while preserving the original failure and the last known context state. An active operation stops waiting for viewport release at its own deadline while connection-owned cleanup continues under its separate budget.

Reconcile surviving Firefox context and page viewports after failed or interrupted removal or close, preserving the original failure while bounded recovery continues independently of an expired operation.
