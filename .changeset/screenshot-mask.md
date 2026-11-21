---
"@usestrider/browser": patch
---

Add `mask` and `maskColor` to `Page.screenshot`, in `Page.ControlScreenshotOptions`: each locator hides every element it matches, in its own frame, behind a box of `maskColor` (`#FF00FF` by default) in viewport, full-page, and element captures. The boxes are removed after the capture, however it ends. `ReadonlyPage.screenshot` doesn't take them, since inspecting a page never changes what it shows.
