---
"@usestrider/browser": minor
---

Add `timestamp` to `ConsoleMessage`: when the browser logged the message, by the browser's wall clock, as a `DateTime.Utc` to the millisecond, on Chromium, Firefox, and stock WebKit. A message stock WebKit reports as a repeat of the one before it has the time it was logged again. `at`, Strider's monotonic instant of receipt, is unchanged.

`timestamp` is required, so code that constructs a `ConsoleMessage`, as a test fixture might, must now give one, and a console history encoded before this release no longer decodes.
