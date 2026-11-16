---
"@usestrider/browser": patch
---

A `Deadline.Timeout` whose operation has nothing observed or sent to explain it now keeps the hint of the call the browser left unanswered at the deadline, such as "The browser didn't answer the call into the page before the deadline". A locator action whose call into the page got no reply, and an evaluation that sent nothing yet, used to report no hint.
