---
"@usestrider/browser": patch
---

Add `context.routeWebSocket`, which mocks WebSocket connections or proxies them to the real server and lets a handler watch and change messages. It replaces the page's `WebSocket` constructor with a script, so it requires `implementation: "script"`, and page scripts can interfere with that replacement. A handler that returns without calling `open` or `connectToServer` fails the connection as an unreachable server does, and its deadline covers only that decision. A close without a code gives the page 1005. Unrouted sockets of a routed context stay `instanceof WebSocket`. `Connection.initiator` names the frame or worker that constructed the socket. WebKit requires explicit best-effort timing, and Firefox refuses worker routing.
