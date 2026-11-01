---
"@usestrider/browser": patch
---

Fix checked reads, expectations, check/uncheck and snapshots for ARIA option and treeitem roles to use aria-checked independently of aria-selected. For option/treeitem, absent or empty aria-checked, or the literal value "undefined", now fails checked reads and check/uncheck with WrongElement before input, including on ordinary native options, preserving selection. Explicit false means checkable but unchecked. Native checkbox/radio properties and the other supported roles retain their existing behavior.
