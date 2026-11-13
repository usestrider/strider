---
"@usestrider/browser": patch
---

Uploading in-memory files that total 64 KiB or less now takes one call in the page instead of a chunked transfer, so `setInputFiles` and `FileChooser` finish sooner. Larger and local files transfer as before.
