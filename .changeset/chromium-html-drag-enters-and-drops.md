---
"@usestrider/browser": patch
---

**An HTML drag on Chromium enters and drops its target.** A drag whose button was released right after one move to the target, as `dragTo` with its default steps and a hover with the button held make, dropped nothing: the release could go out before Chromium had reported the drag, and the move that started the drag fired no `dragenter` or `dragover`. The move that starts a drag now waits for it and enters the drag at its own point, so the target sees `dragenter` and `dragover` while the button is held and `drop` at the release. Each mouse move with a button held costs one more round trip on Chromium.
