---
"@usestrider/browser": patch
---

Reject non-string `Locator.pressSequentially` values, including non-string Redacted contents, with `InvalidInput` before contacting the browser, without exposing the supplied value.
