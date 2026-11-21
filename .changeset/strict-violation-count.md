---
"@usestrider/browser": minor
---

`Locator.StrictViolation` has a required `count`, the total number of matches, which its message states;
`candidates` describes the first ten. Code that constructs a `StrictViolation` must now pass `count`. Its
`.filter({ visible: true })` suggestion now appears only when exactly one of all the matches is visible, not one of
the ten described.
