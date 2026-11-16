---
"@usestrider/browser": patch
---

`page.mouse`, touch and wheel input at a point inside a cross-site frame now reaches the frame's content: on Chromium even before the frame has drawn, where it reached the page's `iframe` element, and on Firefox at all, where it never did. While a button is held, input goes to the frame that got the press, so a release outside the frame still reaches it. Finding the frame takes extra commands only on a page with an out-of-process frame on Chromium (two or three per event), and only in a frame tree holding a frame of another origin than its parent on Firefox (one per level); other pages send none.
