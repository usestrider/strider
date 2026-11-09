---
"@usestrider/browser": patch
---

Add `UserContext.Options.acceptInsecureCerts` for isolated HTTPS certificate-error acceptance in Firefox and launched stock WebKit. Chromium refuses the opt-in because its override is browser-wide; existing contexts refuse explicit values on reclaim. New contexts retain certificate verification by default.
