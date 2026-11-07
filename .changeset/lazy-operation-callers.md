---
"@usestrider/browser": patch
---

Capture fewer operation caller frames and defer stack formatting until trace source export or failure rendering, reducing the cost of unrecorded operations while preserving construction-time caller locations. When capture is enabled but no user caller is available, failures now retain an additional frame naming the operation without a location; source exports omit unavailable locations.
