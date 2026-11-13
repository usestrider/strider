---
"@usestrider/browser": patch
---

Report a WebKit command on an object from a discarded page context as `TargetGone`, not a protocol failure, when WebKit answers before the navigation that discarded it is announced. `Protocol.RejectReason` gains `NoSuchObject`.
