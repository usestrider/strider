---
"@usestrider/browser": patch
---

Add `NetworkRequest.sizes` snapshots with context-creation `requestSizes` opt-in. Native byte counts distinguish transferred, encoded and decoded bodies; unavailable or ambiguous counts remain `None`, with documented per-browser limits and bounded live-request ownership.
