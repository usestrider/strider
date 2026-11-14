---
"@usestrider/browser": patch
---

On Chromium, an evaluation in a dedicated worker that has just started now waits until the worker's script has loaded, or until its init scripts have run, before it is sent. Sent earlier, it could crash the page's renderer or go unanswered. If the worker ends first, the evaluation fails with the worker's end; the wait counts against the evaluation's deadline.
