---
"@usestrider/browser": minor
---

`PageNavigation.next`, `stream` and `history` take a context as well as a page, for the navigations of every page in it, including pages opened after the subscription. Each navigation now names its `page`.

The new `PageLifecycle` module reports frames added and removed, documents reaching `domContentLoaded` and `load`, and pages closing, as events on a page or on every page of a context.

A `next` wait whose event came just before its page or context ended, such as `ConsoleMessage.next` or `Dialog.next` with the page closing right after, now gets the event instead of failing with `TargetGone`.

**Migration:** every `PageNavigation` variant now has a required `page` field, the id of the page the navigation happened in. Code that builds or decodes `PageNavigation` values has to give it; for a page's own navigation it is the same as `frame`.
