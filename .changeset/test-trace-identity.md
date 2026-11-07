---
"@usestrider/browser": patch
"@usestrider/vitest": patch
---

Capture the running test's identity when a trace starts and preserve it across exports. Add `VitestBrowser.traceFileName(info)` for safe deterministic trace filenames that distinguish projects, tests and retries.
