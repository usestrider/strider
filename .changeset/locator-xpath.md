---
"@usestrider/browser": patch
---

Locators accept XPath: `locator(Locator.xpath("//li[@id='three']"))` matches the element nodes an expression selects, in document order, from the document or, when chained, from each match, where a `/` that begins the first step, after optional whitespace, searches inside it (`//li` reads as `.//li`). A bare `/`, alone or before `|`, is left as written, and only the very start is rewritten: in `//a | //b` the second branch searches the whole document (`.//a | .//b` keeps both inside), and `(//a)[1]` stays document-relative. A string passed to `locator` is still CSS. A malformed expression, a namespace prefix, or one that does not select nodes fails with `InvalidInput` as soon as the locator is used, even when the query before it matches nothing.
