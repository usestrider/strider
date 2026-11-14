---
"@usestrider/browser": minor
---

HAR exports follow HAR 1.2 in more of their fields. The log's `creator.version` is the version of
`@usestrider/browser` that wrote it, where it was always `0.1.0`. A request that sent no body has a `bodySize` of 0,
not -1. A `mimeType` keeps its parameters, such as a charset or a multipart boundary. An embedded body whose bytes
aren't valid UTF-8 is written as base64, whatever its MIME type says, where it was decoded with replacement
characters, and a text body keeps a leading byte order mark. A `Set-Cookie`'s `Max-Age` gives the cookie's `expires`,
and a cookie with no name is listed rather than dropped. That nameless cookie's value is now redacted in `Cookie` and
`Set-Cookie` headers, where it was written even when cookies were redacted.

A response's `bodySize` is its body's bytes as transferred, where it was the whole response's on Chromium and Firefox,
and `_transferSize` the whole response's, where it was only the body's on WebKit; each is -1 where the browser
doesn't count it, as Chromium doesn't count the body. Responses from a cache, a service worker or a route, and
revalidated ones, have no counts of their own and are written as -1. `content.compression` is written where the
body's count is known.

`BodyLimit` no longer counts a response's headers as part of its body. On Firefox and WebKit it compares the body as
transferred; on Chromium, which doesn't count the body, it compares the body as read, decoded.

**Breaking.** On Chromium, a compressed response whose transfer was under `BodyLimit` but whose decoded body is over
it now fails with `BodyUnavailable`, `why: "overLimit"`. A HAR's `mimeType` and response `bodySize` change meaning.

**Migrating.**

- On Chromium, raise `BodyLimit` (`NetworkResponse.withBodyLimit`) to the decoded size of the compressed bodies you
  collect.
- Compare a HAR's `mimeType` by the part before its `;`, as `mimeType.split(";")[0].trim()`, where you compared the
  bare type.
- Read a response's whole transfer from `_transferSize`, not `bodySize`.
