---
"@usestrider/browser": patch
---

Send a context's `httpCredentials` on Chromium when the server's challenge arrives before the request's network events, as it can for a page's fetch or a dedicated worker's. The challenge was canceled, and the request got the server's 401.
