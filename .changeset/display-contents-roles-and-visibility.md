---
"@usestrider/browser": patch
---

Find `display: contents` elements by role, count their text as visible, and act on them. Such an element has no box, so role queries and accessible names left it out of the accessibility tree, an element holding only text was never visible, and pointer actions such as `click` and `hover` found no point on it and waited until their deadline. It is now hidden from accessibility only by `aria-hidden`, its own `visibility`, or a hidden ancestor; its text counts toward visibility when the element the text sits in shows it; and pointer actions take their point from its children and text, scrolling to them. Snapshots also leave out the text of a `display: contents` element that `visibility: hidden` hides.
