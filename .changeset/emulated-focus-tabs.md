---
"@usestrider/browser": patch
---

On Chromium, a context with `focus: "emulated"` now opens its pages as tabs instead of windows of their own, which makes creating pages and closing the context faster. The default, `focus: "system"`, still opens a window per page.
