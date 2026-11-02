---
"@usestrider/browser": patch
---

Wait for Chromium's original renderer dimensions when releasing the last viewport override, within a fresh cleanup deadline, while preserving viewport-sized screencast frames. Measure outside the page’s main world and keep viewport application working when its original dimensions cannot be read. Warn if the original size is unknown, restoration times out or a CDP declaration release fails unexpectedly, without failing scope cleanup; ended sessions stay quiet and each target is cleaned up independently.
