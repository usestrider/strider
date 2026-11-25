---
"@usestrider/browser": patch
---

Add `Route.fallthroughWith(change)`, which passes a request, changed as `continueWith`'s change does, to the next matching route. The routes below see the changed URL, method, headers, and body, and are matched against the changed URL; `continue`, and the default when no route is left or a route fails, send every change made. `Route.fromHar` matches the changed request.

On Firefox, a `Route.continueWith` that changes only a request's headers now keeps its body: the request keeps its `Content-Length`, so the server receives the body.
