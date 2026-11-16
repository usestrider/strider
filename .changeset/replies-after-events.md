---
"@usestrider/browser": patch
---

An operation now returns only after the events the browser sent before its reply have been handled, so a history read right after it, such as `ConsoleMessage.history` after an evaluation that logged, holds what the browser reported, as far as the history keeps it. Before, the last console message, request, or dialog could still be on its way into the history. Events of a page whose state is still being read, as when it has just attached, reach the history once that read completes. The command's timeout, or its operation's deadline, covers this wait.
