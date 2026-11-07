---
"@usestrider/browser": patch
---

Apply URL and title redaction to trace observations from direct `Expect.that(page.url, condition)` and `Expect.that(page.title, condition)` failures, including rethrows of the same failure. User transformations and reconstructed failures do not inherit source classification; generic condition descriptions remain unchanged.
