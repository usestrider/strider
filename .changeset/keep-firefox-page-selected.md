---
"@usestrider/browser": patch
---

Keep a Firefox page visible when the browser adds a tab of the default user context to its window, as macOS sometimes does. The tab is no longer reported as a page of the default context, and the page is selected again, so its timers and rendering stay at full rate.
