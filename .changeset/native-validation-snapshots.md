---
"@usestrider/browser": minor
---

Expose native constraint invalidity in snapshot node states and the browser's message in validationMessage (an Option). Text snapshots show [invalid] and a JSON-quoted [validationMessage="…"]; diffs include message changes and clearing. Inspection respects willValidate and reads properties without triggering validation or changing focus. Current invalidity does not establish that a submission was attempted.
