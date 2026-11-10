---
"@usestrider/browser": patch
---

Close a context with fewer commands on Chromium. When a scope that created a context ends and removes it, Strider no longer first turns off the context's file chooser interception and authentication challenge handling, which the removal makes pointless. A context that stays open still has them turned off, and one the browser refuses to remove has them set as they were.
