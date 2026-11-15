---
"@usestrider/browser": patch
---

Bypass the browser's HTTP cache on Chromium and Firefox while a request or response route is in force for a page, so a request the route continues reaches the server. A second fetch of a cacheable URL was routed, then answered from the cache, and the server never saw it. The cache is used again once the last such route is removed.
