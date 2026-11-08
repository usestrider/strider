---
"@usestrider/browser": patch
---

Confirm every newly established stock WebKit child-frame pairing with a temporary window mark, so inconsistent time-origin reads cannot omit a child frame or select its sibling. Page scripts can briefly observe the mark, including when document fingerprints would have matched uniquely.
