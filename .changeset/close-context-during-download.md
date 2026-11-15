---
"@usestrider/browser": patch
---

Closing a context on Chromium while one of its downloads was finishing no longer fails with a defect from removing its temporary downloads directory (`rmdir` failing with `ENOTEMPTY`). Chromium answers the context's disposal before it cancels the context's downloads, and could still be writing a file into the directory as it was removed. The context's downloads are now denied before it is disposed, and it ends only once each of its downloads has ended, before its directory is removed.
