---
"@usestrider/browser": patch
---

The `strider press` command and the agent toolkit's `press` tool accept a `Modifier+Key` chord, such as `Meta+k` or `Control+Shift+P`, and hold its modifiers (`Alt`, `Control`, `Meta`, or `Shift`) for the key, where they read `Meta+k` as one unknown key before. An unknown modifier fails as `InvalidInput`, naming the four, and an exported test presses the chord's key with the library's `modifiers`.
