---
"@usestrider/browser": patch
---

Add `timestamp` to `ConsoleMessage`: when the browser logged the message, by the browser's wall clock, as a `DateTime.Utc` to the millisecond, on Chromium, Firefox, and stock WebKit. A message stock WebKit reports as a repeat of the one before it has the time it was logged again. `at`, Strider's monotonic instant of receipt, is unchanged.
