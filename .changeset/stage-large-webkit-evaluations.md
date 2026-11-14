---
"@usestrider/browser": patch
---

Send a stock WebKit function declaration that takes over 96 KiB once encoded in parts, compiled in the page, so a large declaration, such as the page engine's install, no longer closes an attached WebKit inspector's socket for exceeding its 128 KiB message limit. The parts are compiled with the page's `eval` as it was when Strider's helper was installed: a page's wrapper that passes the text on to the browser's `eval` works, and a replacement that compiles different text fails the evaluation with an error saying so, but one that returns a function with the same source isn't detected. An evaluation's arguments are not split, and still count toward the limit.
