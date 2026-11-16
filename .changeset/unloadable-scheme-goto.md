---
"@usestrider/browser": patch
---

On Firefox, a `goto` to a URL the browser won't load, such as one whose scheme it has no handler for (`nosuchscheme:x`, or `localhost:8080/`, whose scheme is `localhost:`), now fails at once with `PageError` whose reason is `NavigationFailed`, carrying Firefox's message. Before, it failed as `Unsupported`, as though Firefox didn't implement navigation.
