---
"@usestrider/browser": patch
---

Add `page.anyFrame` and a frame locator's `anyFrame`, which search a document and every frame under it, at any
depth, and act in the one frame where a locator's chain matches. A chain matching in more than one frame fails with
`StrictViolation`, `count` and `all` included; none matching is waited for, like a frame that isn't there yet.
`anyFrame.frame(iframe)` enters a frame the search found.
