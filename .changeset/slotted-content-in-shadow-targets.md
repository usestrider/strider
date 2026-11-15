---
"@usestrider/browser": patch
---

Click, hover, and the other pointer actions now reach an element in a shadow root whose content is slotted, such as a `<a><slot></slot></a>` link labelled by the light DOM. Strider checked what lies under the pointer by DOM ancestry, where slotted content sits under its host, while the browser hit-tests and dispatches events on the flat tree, where it sits under its slot; such actions failed as `Covered`, naming the slotted element, or on Chromium the host itself. The pointer check, its guard, the inert and modal-dialog checks, and the keyboard guard now follow the flat tree. Role queries also leave out slotted content under an `aria-hidden` element of a shadow root.
