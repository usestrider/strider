---
"@usestrider/browser": patch
---

Preserve WebKit document response bodies across adapter-controlled navigation and reload during response-body collection. Wait only for the responded, committed main document's unfinished load and document retention reads already started on the page; provisional and unfinished iframe loads do not delay dispatch. The wait is interruptible within the existing navigation deadline, without grace, so an indefinitely streaming main document can cause a timeout. Close the collection's owning scope before navigating when that body need not be preserved. Without response-body collection there is no added wait.
