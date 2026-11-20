---
"@usestrider/browser": patch
---

An action in a frame named by position, such as `page.frame(page.locator("iframe").nth(1))`, no longer sends its
input through another iframe's position and coverage when a sibling before it is removed just before the input; it
checks again in the frame its locator now leads to.
