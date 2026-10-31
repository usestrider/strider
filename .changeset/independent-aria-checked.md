---
"@usestrider/browser": patch
---

Fix checked reads, expectations, check/uncheck and snapshots for ARIA option and treeitem roles to use aria-checked independently of aria-selected. Missing aria-checked means unchecked, consistently with the other supported ARIA checkable roles.
