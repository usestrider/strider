---
"@usestrider/browser": patch
---

Launching stock WebKit reads the child's `/proc/<pid>/fd` only once a listener exists on the inspector port, not on the first poll right after the spawn, where a `PermissionDenied` read was seen. A child that never listens now ends as a readiness timeout.
