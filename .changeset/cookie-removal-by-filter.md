---
"@usestrider/browser": patch
---

`CookieJar.remove` removes cookies by filter: `name` is now optional and, like `domain` and `path`, takes a regular
expression as well as a string, and `partitionKey` removes only the cookies in that partition. A match with no field
removes every cookie. A `partitionKey` fails as `Unsupported` on Firefox and WebKit, which don't say which partition a
cookie is in.
