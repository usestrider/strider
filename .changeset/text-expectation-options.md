---
"@usestrider/browser": patch
---

Add `ignoreCase` to `Expect.toHaveText`, `Expect.toContainText`, `Expect.toHaveAttribute`, and `Expect.toHaveURL`: a
string compares without case, and a regular expression's `i` flag is set, or cleared when `false`. `toHaveText` and
`toContainText` take `useInnerText`, which compares each element's rendered `innerText` instead of its text content.
`toContainText` takes a list, which passes when its entries are contained in matches in the same order, each in a
later match than the one before; an empty list passes when nothing matches.
