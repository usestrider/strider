---
"@usestrider/browser": patch
---

Fix Firefox evaluations selecting an old document's realm after navigation commits when realm destruction is delayed. Publish replacement main and isolated realms with the committed document while preserving initial realm reuse and history restoration.
