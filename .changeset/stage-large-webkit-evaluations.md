---
"@usestrider/browser": patch
---

Send a function declaration too large for one stock WebKit inspector message in parts, compiled in the page, so a large declaration, such as the page engine's install, no longer closes an attached WebKit inspector's socket for exceeding its 128 KiB message limit. On a page that replaced `eval` before Strider's helper was installed, such a function fails with an error saying so. An evaluation's arguments are not split, and still count toward the limit.
