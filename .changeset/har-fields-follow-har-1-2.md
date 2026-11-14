---
"@usestrider/browser": patch
---

HAR exports follow HAR 1.2 in more of their fields. The log's `creator.version` is the package's version, read from
its `package.json`, where it was always `0.1.0`. A request that sent no body has a `bodySize` of 0, not -1. A
`mimeType` keeps its parameters, such as a charset or a multipart boundary. A body whose bytes aren't valid UTF-8 is
written as base64, whatever its MIME type says, where it was decoded with replacement characters. A `Set-Cookie`'s
`Max-Age` gives the cookie's `expires`, and a cookie with no name is listed rather than dropped. That nameless
cookie's value is now redacted in `Cookie` and `Set-Cookie` headers, where it was written even when cookies were
redacted.
