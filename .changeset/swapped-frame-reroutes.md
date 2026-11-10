---
"@usestrider/browser": patch
---

Recover replay-safe engine rounds on Chromium when a nested frame moves to its own target mid-call: a call rejected with "Execution context was destroyed." first handles the browser events that arrived before the rejection, and when that ended the context, the round reports it gone and runs again on the frame's new context. Without such an event the rejection is reported at once, and actions already applied are not replayed.
