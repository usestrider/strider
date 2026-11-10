---
"@usestrider/browser": patch
---

Launching stock WebKit skips reading the child's `/proc/<pid>/fd` while no listener appears on the inspector port in the TCP table. A `PermissionDenied` read was seen on the first read after a spawn. If no listener appears, the table stays readable, and no child exit is observed before the deadline, launch ends as a readiness timeout.
