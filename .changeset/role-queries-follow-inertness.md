---
"@usestrider/browser": minor
---

Role locators, accessible names, and snapshots now leave out inert elements as the accessibility tree does: an element with the `inert` attribute or inside an inert subtree, and, while a modal dialog opened with `showModal()` is open, everything outside the topmost one. `includeHidden: true` still matches them. Readiness follows the same rule, so a modal dialog opened inside an inert subtree escapes it, and only the topmost of several open modal dialogs blocks the rest. A role locator that matched an inert element before, such as a button behind an open modal dialog, now matches nothing unless `includeHidden` is set.
