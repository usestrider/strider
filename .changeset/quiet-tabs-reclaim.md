---
"@usestrider/browser": minor
---

Add experimental serializable Chromium page and context claims, scoped reclaim with a leftover-state report, and an explicit reclaimable context constructor. Ordinary context cleanup remains unchanged; Firefox, stock WebKit and Chromium connections without a browser WebSocket identity report Unsupported. An open Chromium dialog currently blocks inspector discovery and causes reclaim to fail at its deadline. Persistent contexts require host-provided expiry cleanup before adoption.
