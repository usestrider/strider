---
"@usestrider/browser": patch
---

On Chromium, an evaluation in a dedicated worker that has just started now waits until that worker's script has loaded, or until its init scripts have run, before it is sent. Sent earlier, it could crash the page's renderer or go unanswered. If that worker ends first, the evaluation fails with its end; the wait counts against the evaluation's deadline.
