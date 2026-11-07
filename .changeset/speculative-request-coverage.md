---
"@usestrider/browser": patch
---

Disable Chromium's PrefetchPrerenderIntegration and Prerender2FallbackPrefetchSpecRules in the automation profile so speculative document requests honor routes and configured headers. Concurrent inherits the change; stock and attached browsers retain their settings. A caller's own `--disable-features` replaces the profile's entire list.
