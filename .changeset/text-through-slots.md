---
"@usestrider/browser": patch
---

`getByText` no longer matches a `<slot>`. Text slotted into a shadow root, or a slot's fallback text, matched both the slot and the element around it, so a strict action or read failed with two matches; it now matches the element around the slot alone.
