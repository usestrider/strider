---
"@usestrider/browser": patch
---

Answer a script-routed WebSocket's calls on Chromium when they arrive while a new frame or page is still being set up. A call made before Strider had recorded its frame's script context was set aside, and was retried only when another call or context event followed, so a cross-site iframe whose sockets all opened during its setup could wait for an answer that never came.
