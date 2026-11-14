---
"@usestrider/browser": patch
---

A navigation to a `data:` or `blob:` URL, and a reload of one, now commits with `response` `None` on every backend, as documented, instead of a status 200 response. These URLs are no longer reported as requests, and routes no longer see them: Chromium, Firefox, and stock WebKit each reported a `data:` URL as a request, and Chromium and stock WebKit a `blob:` one too.
