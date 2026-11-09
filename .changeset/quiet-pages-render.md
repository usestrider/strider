---
"@usestrider/browser": patch
---

Add `Page.setContent` to replace a document's HTML through the browser parser, preserving its URL and history. It defaults to waiting for load, supports parsing-only or no readiness wait, and shares the operation's deadline and interruption handling.
