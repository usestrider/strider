---
"@usestrider/browser": patch
---

Add Expect.toHaveAccessibleName with retrying string and regular expression matching and an ignoreCase option.

Correct shared accessible-name computation so roles that prohibit naming have empty names in expectations and role locators, while preserving label/content contributions and explicit role overrides.
