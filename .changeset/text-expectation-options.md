---
"@usestrider/browser": patch
---

Add `ignoreCase` to `Expect.toHaveText`, `Expect.toContainText`, `Expect.toHaveAttribute`, and `Expect.toHaveURL`: a
string compares without case, whatever the browser's locale, and a regular expression's `i` flag is set, or cleared
when `false`. `toHaveAccessibleName`, `toHaveAccessibleDescription`, and `toHaveAccessibleErrorMessage` now fold
case the same way, without regard to the locale. `toHaveText` and
`toContainText` take `useInnerText`, which compares each HTML element's rendered `innerText` instead of its text
content; other elements, such as SVG ones, keep their text content.
`toContainText` takes a list, which passes when its entries are contained in matches in the same order, each in a
later match than the one before; an empty list passes when nothing matches.
