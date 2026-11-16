---
"@usestrider/browser": patch
---

Pointer actions reach an element in a shadow root over content slotted into it, such as a link that wraps a `<slot>`, instead of failing as covered. Slotted content is now hidden from role queries under an `aria-hidden` element of a shadow root, and disabled under an `aria-disabled` one. Snapshots no longer infer a pointer cursor on slotted content that inherits it from its slot.

A new capability, `hitTest.shadowHostBoxes`, says whether the pointer check sees a shadow host's own boxes, such as a `::before`, drawn over its shadow content. It is `partial` on Firefox, whose hit test inside a shadow root leaves them out: a trial click on content under such a cover counts as ready there, while a real click is still stopped.
