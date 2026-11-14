---
"@usestrider/browser": patch
---

On Chromium, an action in a cross-site frame that has just loaded no longer sends its click to the parent's iframe element. Pointer input aimed into an out-of-process frame now waits, under the action's deadline, until the frame has drawn its first frame, since Chromium routes input into it only from then.
