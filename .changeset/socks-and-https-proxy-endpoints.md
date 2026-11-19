---
"@usestrider/browser": patch
---

A context proxy can now be a SOCKS proxy or one reached over TLS. `socks5://` endpoints route HTTP, HTTPS, and WebSocket destinations on Chromium, Firefox, and launched stock WebKit, with the proxy resolving names. `socks4://` resolves names at the proxy on Firefox and launched WebKit; Chromium refuses it (`userContexts.proxy.socks4`). `https://` endpoints work on Chromium, and Firefox and WebKit refuse them (`userContexts.proxy.https`). A leading-dot bypass entry, `.example.com`, now matches that domain's subdomains on Chromium and Firefox; launched WebKit refuses it (`userContexts.proxy.bypassSuffix`). SOCKS endpoints with credentials are refused (`userContexts.proxy.socksCredentials`). Other schemes are still refused as before.
