---
"@usestrider/browser": patch
---

Let WebKit engine waits follow document replacement within the original operation deadline by interrupting evaluations when their realm ends. Keep possibly applied engine actions from being replayed when their reply is lost.
