---
"@usestrider/browser": patch
---

A click, drag or key press whose dispatch fails now records the release of the buttons and keys it may have left pressed, and the next gesture sends that release first. Before, only a held button or key's failed release was recorded, so the next gesture went out with the page's input state unknown.
