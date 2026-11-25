---
"@usestrider/browser": patch
---

Add `browser.closed`, which waits as long as the connection to the browser lives and then says why it ended (`BrowserClosed` or `ConnectionLost`), `browser.isConnected`, and `browser.close`, which ends the browser itself for every client, whether the layer launched it or connected to it. Closing an attached browser's layer still only disconnects. Stock WebKit has no command that ends the browser, so there `close` fails with `Unsupported`, naming `browser.close`. `BrowserError` has two new reasons, `Unsupported` and `BackendFailure`, for a `close` that fails.
