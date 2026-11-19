---
"@usestrider/browser": patch
---

`page.mouse`, touch and wheel input at a point inside a cross-site frame now reaches the frame's content: on Chromium even before the frame has drawn, where it reached the page's `iframe` element, and on Firefox at all, where it never did. While a button is held, mouse and touch input goes to the frame that got the press, so a release outside the frame still reaches it, until that frame goes away; the wheel goes by its point. Finding the frame takes extra commands only on a page holding a cross-site frame, on Chromium, or a frame of another origin than its parent, on Firefox: one read of the frames' boxes in each action, and a hit test only at a point inside a frame (up to three commands for each level of frame on Chromium, one on Firefox). Other pages send none.
