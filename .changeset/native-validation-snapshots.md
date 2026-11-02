---
"@usestrider/browser": minor
---

Expose native constraint invalidity in snapshot node states and the browser's message in validationMessage (an Option). Text snapshots show [invalid] and a JSON-quoted [validationMessage="…"]; diffs include message changes and clearing. Inspection respects willValidate and reads properties without triggering validation or changing focus. Current invalidity does not establish that a submission was attempted.

Snapshot.Node now requires validationMessage. Hand-written Node literals must supply it (Option.none() when absent), and older stored Nodes missing the field no longer decode.

Redacted toolkit snapshots mask validation-message contents, including native and custom messages that may repeat field values, while preserving invalid state and refs. Full capture keeps the original messages.
