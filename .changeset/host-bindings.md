---
"@usestrider/browser": patch
---

Add `exposeBinding` on pages and contexts: a host function that page scripts call as `window[name](...)`. The handler returns an Effect, receives the calling page and frame, and has its arguments and result decoded and encoded by schemas; values cross by value as `evaluateInMainWorld`'s do. A context binding reaches every frame of its pages and popups before their own scripts (on WebKit, a new popup gets it as soon as possible instead), and both kinds reach documents already open. Removing a binding deletes it and rejects the calls still waiting. A context that exposes no binding gets nothing installed.
