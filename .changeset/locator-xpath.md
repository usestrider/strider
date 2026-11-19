---
"@usestrider/browser": patch
---

Locators accept XPath: `locator(Locator.xpath("//li[@id='three']"))` matches the element nodes an expression selects, in document order, from the document or, when chained, from each match, where an expression starting with `/` searches inside it (only its start: in `//a | //b` the second branch searches the whole document, and `.//a | .//b` keeps both inside). A string passed to `locator` is still CSS. A malformed expression, a namespace prefix, or one that does not select nodes fails with `InvalidInput` as soon as the locator is used, even when the query before it matches nothing.
