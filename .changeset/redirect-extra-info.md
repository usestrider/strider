---
"@usestrider/browser": patch
---

Settle `NetworkRequest.headersSent` promptly when its page goes away, returning the available sent headers or the request-event headers when none were reported.

Document Chromium's sent-header waiting behavior: response or redirect information may be needed to identify the correct hop, even after extra headers arrive. The operation's deadline bounds that wait. Awaiting it before letting the same response proceed reaches the deadline; let the response proceed first, or use the immediate request snapshot with its possible omissions. Request completion, failure and cancellation also settle the wait with the available headers or the request-event fallback.
