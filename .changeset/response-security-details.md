---
"@usestrider/browser": patch
---

Add `serverAddress` and `securityDetails` to `NetworkResponse`: the IP address and port of the server that
answered, and an HTTPS response's TLS protocol, certificate subject, issuer and validity, each an `Option`.
`securityDetails` is `None` for plain HTTP. Chromium reports both with each response; WebKit reports the
certificate without its issuer, and the address and TLS version only as the response ends; Firefox reports neither.
HAR entries now write `serverIPAddress`, `_serverPort` and `_securityDetails`, leaving out what the browser didn't
report.
