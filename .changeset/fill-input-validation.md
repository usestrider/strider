---
"@usestrider/browser": patch
---

Reject non-string fill values locally with InvalidInput, including values wrapped in Redacted. Reject invalid number-input text before focus, selection or mutation while preserving empty clearing and finite HTML floating-point strings. Rejected values are not included in error messages.
