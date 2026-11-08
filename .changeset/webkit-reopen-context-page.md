---
"@usestrider/browser": patch
---

Open a page in a launched stock WebKit context after another page in it closed. The new page waited until its deadline, because a target list WebKit sends with no pages in it was taken to mean the page had ended.
