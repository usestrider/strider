---
"@usestrider/vitest": patch
"@usestrider/browser": patch
---

Add VitestBrowser.withTest(context) to capture each callback's test identity and retry attempt and attach artifacts to its task, including with shared browser layers and either per-effect composition order. Preserve backend memoization while resolving each callback's binding separately. Document the unbound layer's sequential-only global lookup.
