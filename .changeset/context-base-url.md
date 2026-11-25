---
"@usestrider/browser": patch
---

Add `UserContext.Options.baseURL`, a base URL that relative input resolves against, in every way a context is made:
`Browser.newContext`, `Browser.newPage`, and a launch's `defaultContext`. `Page.goto` and `Frame.goto` resolve a
URL that isn't absolute against it, as a link would. A URL pattern given to `route`, `routeWebSocket`, a HAR
recording's `url`, or an event filter resolves against it unless it starts with `*` or a scheme, keeping its `*`,
`**`, and `:name` parts; a WebSocket route's pattern takes `ws:` or `wss:` for the base's `http:` or `https:`. A base
that isn't an absolute URL fails with `InvalidInput`. Without one, a relative `goto` still fails with `InvalidInput`,
now with a hint that a `baseURL` would resolve it.
