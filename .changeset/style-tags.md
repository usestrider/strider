---
"@usestrider/browser": patch
---

Add `page.addStyleTag` and `FrameLocator.addStyleTag`, which add a stylesheet from CSS source, a URL, or a file (`StyleTag.Source`) to the page's or an iframe's current document and return a scoped handle to its element once it has loaded. A stylesheet the page's Content Security Policy refuses fails with `RefusedByPolicy`, and a URL that doesn't load with `ResourceFailed`.
