---
"@usestrider/browser": patch
---

**An HTML drag on Chromium enters and drops its target.** A drag whose button was released right after one move to the target, as `dragTo` with its default steps and a hover with the button held make, dropped nothing: the release could go out before Chromium had reported the drag, and the move that started the drag fired no `dragenter`. The move that starts a drag now waits for it and enters the drag at its own point, and the release no longer fires a second `dragover`, so the target sees `dragenter`, `dragover` and `drop` once each. Escape pressed during a drag cancels it: the page sees `dragend` and no `drop`, and no key event. Each mouse move with a button held costs one more round trip on Chromium until a drag starts.
