---
"@usestrider/browser": patch
"@usestrider/cli": patch
---

Expose roleless password inputs in snapshots as inferred editable controls with password evidence, preserving accessible names and excluding values, including values referenced by another element for its name. Find matches the password designation using its usual case and exact rules. Export named password refs by waiting for their exact computed name in snapshots, preserving naming precedence, supporting a single framed match and leaving duplicate names ambiguous. Unnamed refs retain the password input selector.
