---
"@usestrider/browser": patch
---

An exact URL pattern is now compared with the URL as the browser writes it, in routes, WebSocket routes, event filters, and HAR replay. `routeWebSocket("ws://localhost:8080")` and `page.route("http://example.com")` never matched before, since the browser reports those URLs as `ws://localhost:8080/` and `http://example.com/`; an uppercase host, a default port, or an unescaped character in the pattern didn't match either. A pattern that isn't an absolute URL is still compared as written.
