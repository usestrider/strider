---
"@usestrider/browser": patch
---

Send keyboard events with the fields a real keyboard gives them. On Chromium, a modifier key's events carry its `location`: 1 for Shift, Control, Alt, and Meta, and 2 for AltGraph; a keydown for a key already held reports `repeat: true`. `press` gives a modifier key its own flag on its keydown, as `hold` does, so `press("Meta")`'s keydown reports `metaKey: true`. Releasing one of two holds of the same modifier keeps its flag on the keyup, since the other hold still has it down.
