---
"@usestrider/browser": patch
---

Add `browser.closed`, which waits as long as the connection to the browser lives and then says why it ended (`BrowserClosed` or `ConnectionLost`), `browser.isConnected`, and `browser.close`, which ends the browser itself for every client, whether the layer launched it or connected to it. Closing an attached browser's layer still only disconnects. Stock WebKit has no command that ends the browser, so there `close` fails with `Unsupported`, naming `browser.close`. `BrowserError` has two new reasons, `Unsupported` and `BackendFailure`, for a `close` that fails. `Chromium.layerConnect` and `strider attach` now look up an HTTP endpoint's WebSocket through the proxy `HTTP_PROXY` or `HTTPS_PROXY` names (and their lower-case forms), unless `NO_PROXY` lists the host; the WebSocket is still connected to directly.
