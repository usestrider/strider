---
"@usestrider/browser": patch
---

Fail Chromium screenshots with `Page.CaptureInvalidated` when their main document is replaced before the native capture reply, including during geometry preparation. Report both document identities without retrying or repairing Chromium's outstanding capture.
