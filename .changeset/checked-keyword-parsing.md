---
"@usestrider/browser": minor
---

Recognize aria-checked keywords ASCII case-insensitively without trimming across reads, expectations, role filters, check/uncheck and snapshots. TRUE now reads true and emits checked in snapshots. MIXED is mixed for checkbox/menuitemcheckbox/option/treeitem filters, but false for radio/menuitemradio/switch filters; mixed still reads false for boolean reads and actions.

Option/treeitem now reject malformed, whitespace-only, padded and uppercase undefined values with WrongElement before check/uncheck input; they match neither checked filter. Migrate these elements to explicit valid true, false or mixed tokens (any ASCII case), without padding, when checking should be supported. Invalid values still default to false on the other five roles. This fallback is Strider policy, not a promise to mirror browser accessibility handling of malformed ARIA. Native checked/indeterminate precedence, selection and the snapshot format are unchanged.
