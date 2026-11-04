---
"@usestrider/browser": minor
"@usestrider/cli": minor
---

Make strict CLI and MCP find search only redacted snapshot content, preserving label searches and role filters.
Mask semantic and plaintext-only editable content and all page-supplied exception details under strict capture,
retaining exception occurrence time. Mask field content copied into other nodes' accessible or inferred names, preserving public labels.
Add optional snapshot editability and name provenance;
older snapshot data remains decodable. Local capture keeps its existing content and search behavior.

Strict capture remains bounded: assertions such as `expect --text` and action selectors still operate on original
page content and can confirm guesses at masked values.
