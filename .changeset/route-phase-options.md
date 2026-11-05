---
"@usestrider/browser": minor
---

Restrict Page.route and UserContext.route handlers to the phases selected by options, including the request default. Calls that previously inferred response or authentication phases from their handlers must now pass `{ phase: "response" }` or `{ phase: "auth" }` explicitly. Explicit type arguments cannot override the default. When phase options are optional or unions, use a handler compatible with every possible phase (including request when phase can be omitted), or narrow the options before registering a phase-specific handler.
