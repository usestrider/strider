---
"@usestrider/browser": patch
---

Let Chromium engine waits follow document navigation when an evaluation is interrupted before realm retirement is reported, within the original operation deadline.

Keep possibly applied engine actions from being replayed when their realm ends before the reply arrives.
