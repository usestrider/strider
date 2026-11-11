---
"@usestrider/browser": patch
---

Once `Chromium.layer` connects to the browser it launched, closing the layer's scope now asks that browser to close and waits up to five seconds for process exit. If it is still running, Strider sends SIGTERM, then SIGKILL five seconds later if it has not exited. A hung browser can take roughly ten seconds to stop, plus process-group cleanup. If startup fails after spawning the browser, cleanup skips the graceful-close wait and uses signals.

This best-effort shutdown helps preserve recent storage in a supplied `userDataDir`; crashes and forced termination can still lose writes.
