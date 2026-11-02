---
"@usestrider/browser": patch
---

Verify the spawned WebKit process owns its inspector listener before starting an Automation session. Launch now requires Linux with readable child procfs and a MiniBrowser executable or wrapper that execs it; refuse unverifiable ownership with attach guidance instead of risking a session on another browser.
