---
"@usestrider/browser": patch
---

An evaluation pending when its page closes now fails with `TargetGone` whose reason is the page's, such as `PageClosed` with `by: "command"`, instead of `RealmDestroyed`. A realm whose document went still ends with `RealmDestroyed`.
