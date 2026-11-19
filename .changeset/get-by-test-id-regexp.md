---
"@usestrider/browser": patch
---

`getByTestId` on pages, frames, and locators now also takes a RegExp, such as `page.getByTestId(/^row-/)`. The pattern is tested against the `data-testid` attribute as written, with its own flags (its `g` flag is ignored), and an element without the attribute never matches. A string still matches the attribute exactly.
