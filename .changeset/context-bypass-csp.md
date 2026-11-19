---
"@usestrider/browser": patch
---

Add `bypassCSP` to `UserContext.Options`, for `Browser.newContext` and `Browser.newPage`: `true` lets the context's pages run the inline scripts, `eval`, and added scripts their Content Security Policy forbids, in every frame, for the context's life. Chromium supports it; Firefox, which doesn't implement `browsingContext.setBypassCSP`, and WebKit refuse it with `Unsupported` before the context is created. The capability tables gain `bypassCSP`.
