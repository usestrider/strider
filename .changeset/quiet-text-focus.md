---
"@usestrider/browser": patch
---

Make text fill recheck the target after focus: wait when it becomes read-only or disabled, and refuse a target whose kind no longer accepts text. Respect the enabled and editable check overrides.
