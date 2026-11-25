---
"@usestrider/browser": patch
---

On Firefox, a page you create reuses the window of a page that closed in the same context, rather than building a new window each time. The page is still alone in its window and keeps rendering. A context keeps at most two idle windows, and they close with it. Creating and closing pages is faster, and the commands sent to a new page no longer wait behind Firefox building its window.
