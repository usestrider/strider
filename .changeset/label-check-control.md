---
"@usestrider/browser": patch
---

Fix check and uncheck on labels by reading the associated control's checked state while preserving the label as the click target and interpreting position relative to it. Prevented activation fails with StateUnchanged; labels without a checkable control fail with WrongElement.
