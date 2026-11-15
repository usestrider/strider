---
"@usestrider/browser": minor
---

An evaluation pending when its page closes now fails with `TargetGone` whose reason is the page's, such as `PageClosed` with `by: "command"`, instead of `RealmDestroyed`. A realm whose document went still ends with `RealmDestroyed`.

To migrate, code that matched `RealmDestroyed` to notice a call cut short by its page closing should match `PageClosed` as well.
