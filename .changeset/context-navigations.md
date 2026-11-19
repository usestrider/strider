---
"@usestrider/browser": patch
---

`PageNavigation.next`, `stream` and `history` take a context as well as a page, for the navigations of every page in it, including pages opened after the subscription. Each navigation now names its `page`.
