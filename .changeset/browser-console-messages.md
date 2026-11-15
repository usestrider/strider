---
"@usestrider/browser": patch
---

Report what the browser writes to a page's console itself, such as a Content Security Policy violation, a request blocked by CORS, or a resource that failed to load, as `ConsoleMessage`s on Chromium and stock WebKit. Chromium sent these only through its Log domain, which the CDP adapter never enabled, and the WebKit adapter dropped every message whose source wasn't the page's own console calls. On Firefox these messages still arrive as `UncaughtException`s, as Firefox sends them as script errors; stock WebKit does the same for "Fetch API cannot load … due to access control checks". The backends' `console` capabilities say so.
