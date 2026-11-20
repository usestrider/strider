---
"@usestrider/browser": patch
---

Add `Expect.toHaveAccessibleDescription` and `Expect.toHaveAccessibleErrorMessage`, which retry until the one
match's accessible description or error message matches a string or regular expression. Both take `ignoreCase`, as
`toHaveAccessibleName` does, and `not`, which negates the comparison while still requiring exactly one match. The
description reads `aria-describedby`, then `aria-description`, then a `title` that isn't the name; the error message
reads `aria-errormessage` while `aria-invalid` is set or the field fails native validation.
