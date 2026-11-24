---
"@usestrider/browser": patch
---

`Locator.selectOption` now succeeds with the values of the options it selected: the chosen options that are still selected once `input` and `change` have run, with their values as they are then, in document order. Given several choices, a `<select>` without `multiple` has the action select only the matching option that comes last in the document, so it gives one value; an event handler that selects another option leaves it out, which can leave the list empty. An empty list of choices gives `[]`, as does a `trial`. A choice that matches no option still waits and fails with `NoSuchOption`.
