---
"@usestrider/browser": patch
---

Send keyboard events with the fields a real keyboard gives them. On Chromium, a modifier key's events carry its `location`: 1 for Shift, Control, Alt and Meta, and 2 for AltGraph. On every backend, a keydown for a key already held is a repeat (`repeat: true`, on Chromium), and `press` and `type` give a modifier key its own flag on its keydown, as `hold` does, so `press("Meta")`'s keydown reports `metaKey: true`.
