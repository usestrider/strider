---
"@usestrider/browser": patch
---

`Locator.selectOption` now succeeds with the values of the options it selected: the chosen options that are still selected once `input` and `change` have run, in document order. A `<select>` without `multiple` given several choices keeps only the matching option that comes last in the document, so it gives one value; an empty list of choices gives `[]`, as does a `trial`. A choice that matches no option still waits and fails with `NoSuchOption`.
