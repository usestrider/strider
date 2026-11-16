---
"@usestrider/browser": patch
---

`page.mouse`, touch and wheel input at a point inside a cross-site frame now reaches the frame's content: on Chromium even before the frame has drawn, where it reached the page's `iframe` element, and on Firefox at all, where it never did. While a button is held, input goes to the frame that got the press, so a release outside the frame still reaches it. Pages without cross-site frames send no extra commands.
