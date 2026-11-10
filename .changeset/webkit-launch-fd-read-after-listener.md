---
"@usestrider/browser": patch
---

Launching stock WebKit no longer fails now and then with `PermissionDenied` reading `/proc/<pid>/fd`. The launcher reads a child's descriptors only once a listener exists on the inspector port, so it no longer reads them while the child is still replacing the exec wrapper.
