---
"@usestrider/browser": patch
---

Add `context.setStorageState(state)` for contexts created with `storageStateTracking: true`. Replace saved storage while preserving live pages, with explicit pre-mutation refusals and partial-failure semantics.
