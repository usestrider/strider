---
"@usestrider/browser": patch
---

`page.addScriptTag` and `FrameLocator.addScriptTag` fail with `RefusedByPolicy`, not `ResourceFailed`, when the page's Content Security Policy refuses a script URL that has a fragment, a username, or a password. The violation the browser reports names the URL without them, and the call now compares it the same way.
