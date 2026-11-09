---
"@usestrider/browser": patch
---

Add `UserContext.Options.httpCredentials` for context-owned website authentication on Chromium and Firefox, with Redacted passwords, optional origin matching and one automatic attempt per request. User auth routes take precedence; proxy authentication stays separate. Stock WebKit explicitly refuses the option.
