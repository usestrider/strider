---
"@usestrider/browser": patch
---

Read Chromium renderer layout metrics before screencast acquisition to order it after tracked navigation processing. This shares screenshots' readiness read and adds renderer/layout work within the existing acquisition deadline; metrics errors can surface before start. It does not guarantee activation across another navigation.
