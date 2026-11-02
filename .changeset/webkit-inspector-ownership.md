---
"@usestrider/browser": patch
---

Verify the spawned WebKit process owns its inspector listener before starting an Automation session. Launch requires Linux with readable child procfs and a MiniBrowser executable or wrapper that execs it; unverifiable ownership refuses with attach guidance. Procfs read failures stop ownership attempts and may delay refusal until the existing launch deadline while awaiting a child exit event, retaining the original access error if none arrives. An observed exit preserves the exit code when available and stderr collected within that deadline. Ordinary readiness timeouts retain the handshake stage.
