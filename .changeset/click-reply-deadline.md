---
"@usestrider/browser": patch
---

A locator action whose input the browser hasn't answered by the deadline now fails with `Deadline.Timeout`, saying the input may have reached the page, instead of a `LocatorError` with the hint "deadline".
