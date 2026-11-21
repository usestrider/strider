---
"@usestrider/browser": patch
---

Add `UserContext.deny`, which denies the permissions it names while its registration lives, for one origin or every origin, with the same limits as `grant`. Grants and denials apply in the order they were made, so the latest one in force wins for each permission and origin, and removing a denial restores what the others say, or `prompt`.
