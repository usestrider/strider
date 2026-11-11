---
"@usestrider/browser": patch
---

Keep browser connections alive when a browser reports a malformed URL. Use about:blank for that URL and show the reported string according to the diagnostics preset in a warning log and an event on its own short-lived span unless tracing is suppressed. Strict, the default preset, shows REDACTED; local shows the exact browser string. The diagnostic uses the span naming and suppression settings, while its warning remains visible.
