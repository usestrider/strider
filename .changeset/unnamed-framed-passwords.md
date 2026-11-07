---
"@usestrider/browser": patch
---

Preserve frame context when exporting unnamed password refs. Replay waits for unnamed password controls inside frames and combines all matches in one frame document, preserving ambiguity. Candidates in multiple frame documents are refused and require manual narrowing. Top-level unnamed selectors and named exports retain their behavior.
