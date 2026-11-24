---
"@usestrider/browser": patch
---

Moving the pointer between a page and a cross-site frame, or between two cross-site frames, with a locator's `hover`
or `page.mouse`, now fires `mouseout` and `mouseleave` in the frame it leaves and clears that frame's `:hover`, on
Chromium and Firefox. On Firefox, each document above the frame, the page and any frame it is nested in, also sees the pointer
enter and leave the `iframe` element. On Chromium,
the page still sees no leave as the pointer enters a cross-site frame, and the capability table's new
`input.frameBoundaries` entry says so (`partial`).
