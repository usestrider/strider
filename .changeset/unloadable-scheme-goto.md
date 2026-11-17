---
"@usestrider/browser": patch
---

A navigation to a URL the browser won't load, such as one whose scheme it has no handler for (`nosuchscheme:x`, or `localhost:8080/`, whose scheme is `localhost:`), now fails at once with `PageError` whose reason is `NavigationFailed`, on Chromium and Firefox.

- On Chromium, a `goto` to such a URL, in a page or a frame, timed out with "The navigation had no outcome before the deadline"; so did `PageNavigation.next` for a navigation the page started to one, or a redirect to one. Such a navigation now ends `Failed` with `net::ERR_ABORTED` once the frame stops loading, as does one stopped before its response, such as by `window.stop()`, which also timed out before. A navigation that became a download still ends as a download.
- On Firefox, a `goto` to such a URL failed as `Unsupported`, as though Firefox didn't implement navigation, and now fails with Firefox's message.
