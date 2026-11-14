---
"@usestrider/browser": minor
---

On Chromium, an action in a cross-site frame that has just loaded no longer sends its click to the parent's iframe element. Pointer input aimed into a frame that is out of process, or inside one, now waits under the action's deadline, before anything is sent, until the frame or a frame inside it reports its first paint, the signal Strider takes that Chromium has drawn it and can route input there. An action into a frame where nothing paints, which was sent before, now times out unsent, and its error names the frame, whatever `checks.rendered` says.
