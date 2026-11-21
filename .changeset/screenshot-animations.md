---
"@usestrider/browser": patch
---

Add `animations` to `page.screenshot`'s options. With `animations: "disabled"`, the capture finishes the page's finite CSS animations, CSS transitions and Web Animations, firing their `transitionend` and `animationend` events, and cancels the infinite ones, which play again after the capture. It applies in every frame and open shadow root, element captures included, on every backend. The default, `"allow"`, leaves them running.
