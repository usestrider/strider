---
"@usestrider/browser": minor
---

`Expect.toMatchAria` also takes a page, matched from its `document` node, and a `{ not: true }` option that waits until the subject doesn't match. `AriaPattern.anywhere(children)` matches a node at any depth beneath the subject whose children match. `AriaPattern.node` takes trailing options for a node's `level` and its `checked`, `pressed`, `expanded`, `selected`, `disabled`, `invalid` and `focused` states.

Snapshot nodes carry a `level` (rendered `[level=2]`), a `checked=mixed` state for an indeterminate checkbox or `aria-checked="mixed"`, in place of `checked`, and a `pressed=mixed` state for `aria-pressed="mixed"`, in place of `pressed`. Text renders each as it is named, such as `[checked=mixed]`.

**Migrating:** `Snapshot.State` has two new members, `"checked=mixed"` and `"pressed=mixed"`, so handle them wherever you switch over every state. An indeterminate checkbox that is also checked now has `checked=mixed` instead of `checked`. Snapshot text shows `[level=N]` after a heading's name, and after the name of any list item, row or tree item with `aria-level`, so update any text you compare against.
