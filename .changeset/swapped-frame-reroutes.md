---
"@usestrider/browser": patch
---

Re-route a Chromium engine call to a frame's new target when the frame swaps targets mid-call: a call rejected with "Execution context was destroyed." now waits for the context's destruction and reports the realm gone, as "Inspected target navigated or closed" does, instead of failing the action.
