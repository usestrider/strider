---
"@usestrider/browser": patch
---

Return `Deadline.Timeout` when storage export's cookie or page read exceeds its deadline, preserving the original timeout instead of wrapping it as a rejected backend failure. Include the timeout in `UserContext.exportStorageState`'s declared error type.
