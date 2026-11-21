---
"@usestrider/browser": patch
---

Add `Frame`, a handle on one frame of a page, from `page.frameById(id)` or `frameLocator.resolve`. It keeps to its frame through the frame's own navigations, reports `Attached` or `Detached` in its `status`, a page's top frame included while the page is still opening, navigates the frame with `goto`, and evaluates in it with `evaluate`, `evaluateInMainWorld` and `evaluateHandle`. Its operations fail with `Frame.FrameError`, and with `TargetGone` once the frame is removed. On stock WebKit, a child frame's `goto` can only wait for `"commit"`.

On Chromium, a navigation that moves a frame between processes, such as an out-of-process frame navigated back to its parent's site, no longer fails with `Rejected`.
