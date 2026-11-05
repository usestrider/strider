---
"@usestrider/browser": patch
---

Interrupt pending event waits when their acquiring scope closes immediately after subscription. Release completed event subscriptions, buffered entries and internal scope finalizers while preserving their latched results.
