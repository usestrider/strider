---
"@usestrider/browser": minor
---

`Expect.toMatchAria` also takes a page, matched from its `document` node, and a `{ not: true }` option that waits until the subject doesn't match. `AriaPattern.anywhere(children)` matches a node at any depth beneath the subject whose children match. `AriaPattern.node` takes trailing options for a node's `level` and its `checked`, `pressed`, `expanded`, `selected`, `disabled`, `invalid` and `focused` states.

Snapshot nodes carry a `level` (rendered `[level=2]`) and a `mixed` state for an indeterminate checkbox or a mixed toggle button (rendered `[checked=mixed]` or `[pressed=mixed]`), in place of `checked` or `pressed`.

**Migrating:** `Snapshot.State` has a new member, `"mixed"`, so handle it wherever you switch over every state. An indeterminate checkbox that is also checked now has `mixed` instead of `checked`. Snapshot text shows `[level=N]` after a heading's name, and after the name of any list item, row or tree item with `aria-level`, so update any text you compare against.
