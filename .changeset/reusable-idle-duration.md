---
"@usestrider/browser": patch
---

Print the validated --idle duration in start and sessions so it can be passed back to --idle in quotes. For example, a session started with --idle "15 minutes" now prints "15 minutes" instead of the rejected shorthand "15m". The default prints "1 hour". Duration parsing, invalid-input guidance and idle timeout behavior are unchanged.
