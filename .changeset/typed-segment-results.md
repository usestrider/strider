---
"@usestrider/browser": minor
---

Require CLI segments to default-export `Segment.make(schema, run)` from `@usestrider/browser/cli`. Migrate a plain Effect export with `Segment.make(Schema.Record(Schema.String, Schema.Never), Effect.fnUntraced(function*() { return yield* effect }))`. Repeated `--arg key=value` flags and `--arg payload=@payload.json` are decoded by the schema before the callback runs.

Print segment return values, page handles and elapsed time with `run --json`, and a bounded value preview in plain mode. Failures include their phase, browser operation when known, and typed error details. Secrets are concealed; strict capture masks arbitrary return data and failure messages while retaining page handles.
