---
"@usestrider/browser": patch
---

Scope exported unnamed framed password queries to the recorded snapshot frame prefix and preserve every match within it, including ambiguity. Replay waits when that frame has no unnamed password and excludes candidates in other frames. Frame prefixes identify traversal order among frames included in the snapshot, including nested frames, rather than durable frame identity: insertion, removal, reordering or availability changes require manual locator editing. Top-level unnamed selectors and named exports retain their behavior.
