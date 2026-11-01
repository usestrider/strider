---
"@usestrider/browser": patch
---

Fix check and uncheck on labels by preferring the label's own checked state when it is an ARIA checkable, and otherwise reading the associated control's checked state while preserving the label as the click target and interpreting position relative to it. Prevented activation fails with StateUnchanged; labels with neither their own checked state nor a checkable control fail with WrongElement.
