---
"@usestrider/browser": patch
---

Close a context faster on Chromium. When a scope that created a context ends, Strider now removes the context in one step, which closes the pages it holds, instead of closing each page first. This takes about 27 ms less for every scope that creates a context, such as `Browser.newPage`. A page closed on its own, or in a context that stays open, closes as before, and a context the browser refuses to remove still has its pages closed one by one.
