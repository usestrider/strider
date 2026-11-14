---
"@usestrider/browser": patch
---

On Chromium, an action in a cross-site frame that has just loaded no longer sends its click to the parent's iframe element. Pointer input aimed into a frame that is out of process, or inside one, now waits under the action's deadline until the frame has been drawn, which a first paint in it or in a frame inside it shows, since Chromium routes input into it only from then. Input into a frame where nothing paints runs out its deadline instead of being sent.
