---
"@usestrider/browser": patch
---

A `goto` no longer fails with the failure of a navigation it replaced. When the browser announced another URL's
navigation while a `goto`, `reload` or history step was in flight, as Firefox does for a popup's first page if a
`goto` is sent to the popup before that page has started, the other navigation took the command's place. Its
failure on being replaced then failed the command with `NavigationFailed`, although the requested page loaded. A
navigation announced for a different URL than the command's now stands for the command only when the command names
no URL, as a history step doesn't.
