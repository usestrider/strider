---
"@usestrider/browser": patch
---

On Firefox, a second same-document `page.back()` or `page.forward()` in one document no longer times out. A traversal that ended through its own same-document event was treated as cancelled, which made every later traversal in that document give up its claim on the navigation it waited for.
