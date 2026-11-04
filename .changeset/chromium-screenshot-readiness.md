---
"@usestrider/browser": patch
---

Synchronize every Chromium screenshot with a renderer layout-metrics read before capture, reusing it for full-page and CSS sizing. This adds renderer responsiveness and layout work within the existing deadline; interruption or document replacement during the read prevents capture dispatch.
