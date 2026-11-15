---
"@usestrider/browser": patch
---

Closing a context on Chromium while one of its downloads was finishing no longer fails with a defect from removing its temporary downloads directory (`rmdir` failing with `ENOTEMPTY`). Chromium answers the context's disposal before it cancels the context's downloads, and could still be writing a file into the directory as it was removed. The context's downloads are now denied before it is disposed, and its removal waits for each download it began to end, including one Chromium reports after the frame that started it has gone, before the directory is removed. As before, the removal stops waiting at its time budget or when the connection is lost.
