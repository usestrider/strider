---
"@usestrider/browser": patch
---

On stock WebKit, a key that `page.keyboard` refuses before sending it, such as one WebKit's Automation can't type, no longer leaves a release behind that makes the next key press fail.
