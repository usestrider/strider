---
"@usestrider/browser": minor
---

A `Timeout`'s message now ends with its hint, so a timed-out action says what it last waited on in the CLI, the toolkit and the library alike. An inert target's hint names the element with the `inert` attribute and any open modal dialog, native or `aria-modal`. A failed `Expect.that` keeps the last value its read returned as `last`, instead of the check cut off at the deadline. A pointer action on an element whose `pointer-events` is `none`, or inside an iframe whose is, now waits on a new `NoPointerEvents` reason that says so, instead of calling whatever is beneath it a cover. An `aria-modal` dialog is named as open only when it's rendered, and dialogs in open shadow roots are found. Element descriptions in errors leave out field content, such as a textarea's text or an editable element's, under every capture policy: a field, or an element inside one, is described without its text.
