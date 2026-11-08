---
"@usestrider/browser": patch
---

End pending Firefox evaluations when their realm is destroyed, allowing safe locator checks to continue in the new document after navigation without waiting for a protocol reply.
