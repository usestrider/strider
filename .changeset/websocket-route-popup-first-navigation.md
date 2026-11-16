---
"@usestrider/browser": patch
---

On Chromium, a context with a script `routeWebSocket` now configures a popup that opens with no URL, such as one a `target="_blank"` link or `window.open(url)` opens, before the popup starts loading. Its first navigation is answered by the context's HTTP routes and carries its extra headers, user agent and other overrides. Before, the popup was resumed before request interception and the rest of its configuration were sent, so its first navigation could go to the network unrouted.
