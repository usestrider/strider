---
"@usestrider/browser": patch
---

Detect Chromium and stock WebKit HTTP endpoints when starting an attached CLI session. Reuse Chromium discovery, report the selected backend, keep the supplied endpoint in exported tests, provide their WebSocket services, and reject unsupported servers with bounded diagnostics. Attached WebKit lists explicitly controlled tabs until release and includes only their events in the digest; release and stop leave the original tabs open.
