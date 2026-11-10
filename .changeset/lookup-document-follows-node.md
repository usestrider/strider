---
"@usestrider/browser": patch
---

Fix `Locator.evaluate`, `Locator.evaluateAll`, a synthetic `dragTo` and `storageState` choosing the previous document's realm when a frame commits a new document while an element is being found. They now use the document the found element belongs to.
