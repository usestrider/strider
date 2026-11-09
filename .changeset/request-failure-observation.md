---
"@usestrider/browser": patch
---

Add `NetworkRequest.failure` to read a request's reported failure immediately, preserving cancellation uncertainty and refusing unavailable observations without adding request retention or browser instrumentation.
