---
"@usestrider/browser": patch
---

Fix concurrent Firefox init-script additions and removals, and clean up partially installed preloads without retaining removed declarations.

Treat evaluations in destroyed Firefox realms as target loss and honor the WebSocket route budget while fetching incoming messages.

Removing Firefox init scripts, for every context and not only those that route WebSockets, now shares one five-second budget across all the preloads it removes, instead of five seconds for each.
