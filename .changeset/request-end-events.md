---
"@usestrider/browser": patch
---

Add `NetworkRequestEnd`, the events for a request's end on a page or a context, through `next`, `stream`, and `history`. Each is a `NetworkRequest.End`: `NetworkRequest.Finished`, whatever the HTTP status, or `NetworkRequest.Failed` with the browser's error text. `NetworkRequest.end` retains one observed request in a scope and waits for its end. Both come from what the browser already reports, with no new protocol subscription.
