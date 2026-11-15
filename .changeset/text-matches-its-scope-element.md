---
"@usestrider/browser": minor
---

`getByText` chained from a locator now matches the locator's own element, as well as the elements inside it: `page.locator(".badge").getByText("Resolved")` finds the badge that says "Resolved" instead of nothing. A chained `getByText` can now count more matches, and a `filter` whose `has` or `hasNot` is built on `getByText` counts the element being tested, so `has` keeps it and `hasNot` drops it where both ignored it before. The other `getBy*` queries still search only inside the locator's element.
