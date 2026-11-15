---
"@usestrider/browser": patch
---

Find `display: contents` elements by role, and count their text as visible. Such an element has no box, so role queries and accessible names left it out of the accessibility tree, and an element holding only text was never visible. It is now hidden from accessibility only by `aria-hidden`, its own `visibility`, or a hidden ancestor, and its text counts toward visibility when its `visibility` shows it. Snapshots also leave out the text of a `display: contents` element that `visibility: hidden` hides.
