---
"@usestrider/browser": patch
---

An action in a frame named by position, such as `page.frame(page.locator("iframe").nth(1))`, now checks that the
iframe still holds the frame it entered when it reads the frame's position and coverage, and checks again in the
frame its locator now leads to if it doesn't, as when a sibling before it was removed. A page that moves its iframes
after that check, before the input arrives, can still have the input land in another frame.

`Locator.StrictViolation` has a `count` of every match, which its message states; `candidates` describes the first
ten. Its `.filter({ visible: true })` suggestion now appears only when exactly one of all the matches is visible,
not one of the ten described.
