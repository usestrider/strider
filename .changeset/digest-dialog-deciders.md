---
"@usestrider/browser": patch
---

The `strider` digest (`since last:`) and the agent toolkit's `sinceLast` now report each dialog in one line that names what decided it: `dialog confirm "Sure?" on shop accepted by r1` for a `strider dialog handle` registration, `… by a handler` for a handler a segment or program registered, and `… dismissed by policy` for the context's policy. Before, a handler's decision was not reported at all, and a dialog the policy decided was reported twice, once as it opened and once with its decision. A dialog still open when a command reads the digest is reported as `…, open`, and its decision follows in a later command's digest. A handler's decision is reported as `accepted`, `answered` (accepted with text), or `dismissed`.
