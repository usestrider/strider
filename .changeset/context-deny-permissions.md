---
"@usestrider/browser": patch
---

Add `UserContext.deny`, which denies the permissions it names while its registration lives, for one origin or every origin, with the same limits as `grant`. For each permission and origin, the latest grant or denial in force that covers it wins, whether it names that origin or every origin, and removing a denial restores what the others say, or `prompt`.
