---
"@usestrider/browser": minor
---

Pointer actions reach an element in a shadow root over content slotted into it, such as a link that wraps a `<slot>`, instead of failing as covered. Snapshots no longer infer a pointer cursor on slotted content that inherits it from its slot.

A new capability, `hitTest.shadowHostBoxes`, says whether the pointer check sees a shadow host's own boxes, such as a `::before`, drawn over its shadow content. It is `partial` on Firefox, whose hit test inside a shadow root leaves them out: a trial click on content under such a cover counts as ready there, while a real click is still stopped.

**Breaking:** slotted content now inherits `aria-hidden` and `aria-disabled` from the shadow elements it is slotted into, as the accessibility tree does. Role queries leave out slotted content under an `aria-hidden` shadow element, and an action on slotted content under an `aria-disabled` one waits for it to be enabled instead of acting. To find hidden content, pass `includeHidden: true` to `getByRole`; to act on content the page marks disabled, remove `aria-disabled` or pass `checks: { enabled: false }`.
