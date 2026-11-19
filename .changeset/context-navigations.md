---
"@usestrider/browser": patch
---

`PageNavigation.next`, `stream` and `history` take a context as well as a page, for the navigations of every page in it, including pages opened after the subscription. Each navigation now names its `page`.

The new `PageLifecycle` module reports frames added and removed, documents reaching `domContentLoaded` and `load`, and pages closing, as events on a page or on every page of a context.
