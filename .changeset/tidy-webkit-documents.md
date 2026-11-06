---
"@usestrider/browser": patch
---

Preserve WebKit document response bodies across consecutive adapter-controlled navigations during body collection. Navigation and reload wait for document retention within their existing interruptible deadline; navigation without body collection has no added wait.
