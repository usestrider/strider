---
"@usestrider/browser": patch
---

Bypass the browser's HTTP cache on Chromium and Firefox while a request or response route is in force for a page, for its documents, frames, and, on Chromium, dedicated workers, so a request the route continues reaches the server. A second fetch of a cacheable URL was routed, then answered from the cache, and the server never saw it. The cache is used again once the last such route is removed. On Chromium, the setting is confirmed before the route's declaration returns, except while a navigation is under way in the page, when the new document has it from its commit. On Firefox, a dedicated worker's requests still use the cache.
