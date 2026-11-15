---
"@usestrider/browser": patch
---

`CookieJar.listFor` now includes a `Secure` cookie for any URL on a local host, such as plain http: `localhost`, a host under `localhost`, either written with a final dot (`localhost.`), 127.0.0.0/8 or `[::1]`, which browsers treat as secure and send the cookie to. It admitted `Secure` cookies only for `https:` and `wss:` URLs.
