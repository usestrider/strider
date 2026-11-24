---
"@usestrider/browser": patch
---

On Chromium, a context's routes, network conditions (`"offline"` included), extra headers, user agent, and request
body collection now reach its service and shared workers, which they missed before: a route now sees a worker's
`fetch` and its script imports, and a worker's POST body reads through a body decoder. A new service worker's own
script load is still not reported. The new `network.serviceWorkers` capability says this: `partial` on Chromium,
and `unsupported` on Firefox and stock WebKit, which don't attach service or shared workers.
