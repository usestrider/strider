---
"@usestrider/browser": minor
---

Return `Deadline.Timeout` when storage export's cookie or page read exceeds its deadline, preserving the original timeout instead of wrapping it as a rejected backend failure. `UserContext.exportStorageState`'s public error union now includes `Deadline.Timeout`. To migrate, handle `Timeout` separately or widen explicitly annotated `Effect` error unions to include `Deadline.Timeout`.
