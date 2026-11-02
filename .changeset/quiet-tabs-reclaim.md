---
"@usestrider/browser": minor
---

Add experimental serializable Chromium page and context claims, scoped reclaim with a leftover-state report, and an explicit reclaimable context constructor. Failed or interrupted context recovery preserves surviving targets and unwinds its setup registrations. Claims from disposable contexts and claims of the wrong kind are refused. Ordinary context cleanup remains unchanged; Firefox, stock WebKit and Chromium connections without a browser WebSocket identity report Unsupported. Persistent contexts require host-provided expiry cleanup before adoption.
