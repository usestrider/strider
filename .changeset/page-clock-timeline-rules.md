---
"@usestrider/browser": minor
---

Make a controlled page clock follow Playwright's clock. `adjust` and a forward `setTime` let the page's queued tasks run between the timers they fire, so a timer set from a message a timer posted fires within the same call, and a timer set then with no delay waits 1 ms. A timer that throws is still reported to the page, and the other timers still run, but the operation now fails with `PageClockError` whose reason is the new `EvaluationThrown`. `adjust` rounds a fractional duration up to a whole millisecond and rejects negative, infinite, and NaN durations with `InvalidInput`; an `offset` clock's `by` is a whole millisecond, and one that isn't finite is rejected. On a controlled clock, `performance.now()` counts from 0 where the clock reaches a document, `performance.timeOrigin` is the clock's time then, and after `resume` `performance.now()` carries on from where it was.
