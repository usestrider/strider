---
"@usestrider/browser": minor
---

Add `Expect.withChecks`, which sets when `Expect.that` checks a subject that isn't a `Watchable` again, and when `toHaveJSProperty` reads its property again: `Expect.Checks.animationFrame(page)` after each of the page's animation frames, `Expect.Checks.mutation(page)` after each DOM mutation of the page and only then, or `Expect.Checks.interval(duration)`, every 100 ms unless set. An interval that isn't positive and finite now fails with `ExpectError` and `InvalidInput` when the expectation runs; before, zero re-checked back to back and a negative interval was treated as zero. Every strategy ends at the expectation's deadline, including on a page that renders no frames.

This removes `Expect.withCheckInterval` and `Expect.CheckInterval`. Replace `Expect.withCheckInterval("250 millis")` with `Expect.withChecks(Expect.Checks.interval("250 millis"))`. Nothing replaces reading or providing `Expect.CheckInterval`: `withChecks` is the one way to set the cadence.
