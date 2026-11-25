---
"@usestrider/browser": patch
---

Add `times` to `Route.Options`, for `Page.route` and `UserContext.route`: a route with `times: n` runs its handler for its first n requests, whatever it decides for them, `fallthrough` and a failed handler included, then removes itself, so the routes registered before it handle the rest. Requests paused at once never run the handler more than n times. A `times` that isn't a positive integer fails `route` with `RouteError`, reason `InvalidInput`.
