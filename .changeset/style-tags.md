---
"@usestrider/browser": patch
---

Add `page.addStyleTag` and `FrameLocator.addStyleTag`, which add a stylesheet from CSS source, a URL, or a file to the page's or an iframe's current document and return once it applies. A stylesheet the page's Content Security Policy refuses fails with the new shared reason `RefusedByPolicy`, and a URL that doesn't load with `ResourceFailed`.
