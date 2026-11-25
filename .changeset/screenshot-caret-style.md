---
"@usestrider/browser": minor
---

`Page.screenshot` hides a focused field's text caret by default, so Chromium captures no longer differ by whether the caret was on; `caret: "initial"` shows it. `style` applies CSS to every frame and open shadow root of the page for the length of the capture.
