---
"@usestrider/browser": patch
---

Add `NetworkRequestEnd`, the events for a request's end on a page or a context: `Finished`, whatever the HTTP status, or `Failed` with the browser's error text, through `next`, `stream` and `history`. `NetworkRequestEnd.of` retains one observed request in a scope and waits for its end. Both come from what the browser already reports, with no new protocol subscription.
