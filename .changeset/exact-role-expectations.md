---
"@usestrider/browser": patch
---

Add Expect.toHaveRole to retry exact computed ARIA role assertions with role and match-count failure evidence.

Correct shared ARIA role computation for presentation conflicts and required structural children, affecting role locators, snapshots and role assertions. Preserve HTML-AAM generic roles for plain elements.
