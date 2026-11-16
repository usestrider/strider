---
"@usestrider/browser": patch
---

`page.mouse`, touch and wheel input at a point inside a cross-site frame now reaches the frame's content: on Chromium even before the frame has drawn, where it reached the page's `iframe` element, and on Firefox at all, where it never did. While a button is held, mouse and touch input goes to the frame that got the press, so a release outside the frame still reaches it, until that frame goes away; the wheel goes by its point. Finding the frame takes extra commands only on a page with an out-of-process frame on Chromium (up to three for each level of frame the point crosses), and only in a frame tree holding a frame of another origin than its parent on Firefox (one per level); other pages send none.
