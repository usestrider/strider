---
"@usestrider/browser": patch
---

`Expect.toBeInViewport` reports an element's ratio as soon as the browser measures it. When the first check
answered before the browser's first measurement, with the match count alone, the ratio used to wait in the page
until the next check's time ran out, so a short timeout could end the expectation without it.
