---
"@usestrider/browser": minor
---

A context or page still held when its browser's scope closes now ends with `BrowserClosed`: its `closed` resolves instead of waiting forever, and pages and contexts the browser reports gone as it shuts down end with `BrowserClosed` rather than `PageClosed` or `ConnectionLost`.

To migrate, code that matched `PageClosed` or `ConnectionLost` to notice its browser closing should match `BrowserClosed`.
