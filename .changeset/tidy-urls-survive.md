---
"@usestrider/browser": patch
---

Keep browser connections alive when a browser reports a malformed URL. Use about:blank for that URL and preserve the original string in a warning log and an event on its own short-lived span unless tracing is suppressed.
