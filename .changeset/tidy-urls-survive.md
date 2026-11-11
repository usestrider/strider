---
"@usestrider/browser": patch
---

Keep browser connections alive when a browser reports a malformed URL. Use about:blank for that URL and preserve the original string in a warning log and a span event when a parent span exists.
