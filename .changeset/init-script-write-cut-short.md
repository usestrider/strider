---
"@usestrider/browser": patch
---

Keep init scripts and clock calls working on Chromium after one times out. A declaration whose deadline passed while Chromium's reply to an init-script removal was still on its way left that script's identifier recorded, so the page's next declaration, such as a second `page.clock.adjust`, removed it again and failed with "Script not found". A page's init-script write on Chromium now runs to its end apart from the operation that asked for it, which still fails with `Timeout` at its deadline, and records what Chromium did.
