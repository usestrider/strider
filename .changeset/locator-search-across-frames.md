---
"@usestrider/browser": patch
---

Add `page.anyFrame` and a frame locator's `anyFrame`, which search a document and every frame under it, at any
depth, and act in the one frame where a locator's chain matches. A chain matching in more than one frame fails with
`StrictViolation`, `count` and `all` included, with the number of matches across the frames and the first ten
described. When none matches, it is a frame that
isn't there yet: reads fail with `NoMatch`, `count` returns 0, and actions and expectations wait.
`anyFrame.frame(iframe)` enters a frame the search found.
