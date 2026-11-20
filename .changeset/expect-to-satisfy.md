---
"@usestrider/browser": patch
---

Add `Expect.toSatisfy`, which waits until a function you pass returns `true` on a locator's one match. The function runs in the page, in Strider's isolated world, with the element first and then the arguments, which cross as they do for `locator.evaluate`; a promise it returns is awaited. It checks again after each change the page makes, waits through no match or several, and fails at once if the function throws. On stock WebKit it fails as `Unsupported`, as `locator.evaluate` does.
