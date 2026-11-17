---
"@usestrider/browser": patch
---

`Expect.toMatchAria` also takes a page, matched from its `document` node, and a `{ not: true }` option that waits until the subject doesn't match. `AriaPattern.anywhere(children)` matches a node at any depth beneath the subject whose children match. `AriaPattern.node` takes trailing options for a node's `level` and its `checked`, `pressed`, `expanded`, `selected`, `disabled`, `invalid` and `focused` states. Snapshot nodes carry a `level` (rendered `[level=2]`) and a `mixed` state for an indeterminate checkbox or a mixed toggle button (rendered `[checked=mixed]` or `[pressed=mixed]`, in place of `checked` or `pressed`).
