---
"@usestrider/browser": patch
---

Attribute Chromium redirect request and response headers to their own hops when ExtraInfo arrives before or after the main events, preserving request body MIME types in recordings.

Chromium's `NetworkRequest.headersSent` can now wait for response or redirect information to identify the correct hop, even after extra headers arrive. The operation's deadline bounds that wait. Awaiting it before letting the same response proceed reaches the deadline; let the response proceed first, or use the immediate request snapshot with its possible omissions. A request that finishes, fails, is canceled or loses its page settles the wait with the available sent headers, falling back to its request-event headers when none were reported.
