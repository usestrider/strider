---
"@usestrider/browser": patch
---

On Chromium, a route handler's request is now the same hop as the request the browser reports, even when the
pause reaches the handler before the browser's request event. `NetworkRequest.headersSent` in such a handler now
waits for the headers sent instead of returning the request event's at once, and `NetworkRequest.response` and
`NetworkRequest.end` acquire the request instead of failing as evicted.
