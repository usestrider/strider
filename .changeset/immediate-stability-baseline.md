---
"@usestrider/browser": patch
---

Reduce locator action latency by sampling the initial rectangle immediately when checking stability. Clicks also reuse a completed stability observation when they acquire the input lock without queuing, before the next rendering update, and the target and rectangle still match. Actions still require the configured native rendering updates and repeat their other checks after acquiring the input lock.
