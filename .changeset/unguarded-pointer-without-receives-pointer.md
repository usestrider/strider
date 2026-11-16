---
"@usestrider/browser": patch
---

A pointer action whose `checks` disable `receivesPointer` no longer arms the guard that stops a gesture landing outside the element. A `click`, `dblclick`, `tap`, `check`, `uncheck`, or `dragTo` with `checks: { receivesPointer: false }` on a covered element now lands on whatever covers it, instead of being stopped as covered and retried until it timed out.
