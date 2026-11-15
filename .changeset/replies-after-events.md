---
"@usestrider/browser": patch
---

An operation now returns only after the events the browser sent before its reply have been folded, so a history read right after it, such as `ConsoleMessage.history` after an evaluation that logged, holds what the browser reported. Before, the last console message, request, or dialog could still be on its way into the history.
