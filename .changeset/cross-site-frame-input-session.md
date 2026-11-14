---
"@usestrider/browser": patch
---

**Pointer input into a cross-site frame goes to that frame on Chromium.** A click, hover, wheel or tap aimed into an out-of-process frame is sent on the frame's own session, which Chromium routes to the frame even before it has been drawn. It no longer waits for the frame's first paint, which Chromium can report before the frame is in its hit-test data, so a click just after it could still reach the parent page's `iframe` element. An action into a frame where nothing paints no longer times out. With `checks: { receivesPointer: false }`, a click into a cross-site frame reaches its element even where an element of the parent covers it.
