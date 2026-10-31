---
"@usestrider/browser": patch
---

Let trial check and uncheck succeed after actionability checks without requiring the checked state to change. Trial actions still dispatch no click, and real actions still fail with StateUnchanged when the click does not produce the requested state.
