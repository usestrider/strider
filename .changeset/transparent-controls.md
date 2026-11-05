---
"@usestrider/browser": patch
---

Allow actions on transparent controls, including fill and controls inside transparent ancestors. Opacity alone does not make an action wait for a fade-in. With `opacity: 0` on the element or any ancestor, `isVisible` returns false, `Expect.toBeVisible` waits, and visibility filters count the element as hidden.
