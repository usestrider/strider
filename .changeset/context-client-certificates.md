---
"@usestrider/browser": patch
---

Add `clientCertificates` to `UserContext.Options`: TLS client certificates per origin, presented by a loopback proxy that only that context uses, on Chromium and launched Firefox. Chromium now supports `acceptInsecureCerts` per context instead of refusing it. Launched Firefox profiles let a context's proxy carry loopback, and contexts with `proxy` keep loopback direct.
