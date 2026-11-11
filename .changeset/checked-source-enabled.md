---
"@usestrider/browser": patch
---

Check and uncheck now wait for both the selected target and its associated checked-state control to be enabled before sending input. Disabled controls time out without dispatch; already-correct state and the explicit enabled-check override are preserved.
