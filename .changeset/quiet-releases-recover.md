---
"@usestrider/browser": patch
---

A click, drag or key press that fails, or is cut short, after it may have pressed a button or key now has that input released again before the next gesture when the browser didn't confirm its release, as a held input's failed release already was. A release whose outcome is unknown is sent again, which can deliver one extra `mouseup` or `keyup` to a page that already got the first, instead of leaving the button or key held. Chromium's single-click cleanup now runs apart from the failed click, so the click returns its own error without waiting for it, and the next gesture waits for it under its own deadline.
