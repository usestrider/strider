---
"@usestrider/browser": patch
---

Add `Expect.toHaveAccessibleDescription` and `Expect.toHaveAccessibleErrorMessage`, which retry until the one
match's accessible description or error message matches a string or regular expression. Both take `ignoreCase`, as
`toHaveAccessibleName` does, and `not`, which negates the comparison while still requiring exactly one match. The
description reads the first of `aria-describedby`, `aria-description`, a table's caption or a button input's value
when that isn't the name, a `summary`'s content when `aria-label` or `aria-labelledby` gave the name, and a `title`
that isn't the name. The error message reads `aria-errormessage` while `aria-invalid` is anything but blank or
`false`, or the field fails native validation.
