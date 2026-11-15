---
"@usestrider/browser": patch
---

A context or page still held when its browser's scope closes now ends with `BrowserClosed`: its `closed` resolves instead of waiting forever.
