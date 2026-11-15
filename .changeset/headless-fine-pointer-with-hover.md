---
"@usestrider/browser": patch
---

A page of a headless Chromium or Firefox launch now matches `(hover: hover)`, `(any-hover: hover)`, `(pointer: fine)`, and `(any-pointer: fine)`, as it does with a window, instead of `(hover: none)` and `(pointer: none)`. Headless Chromium gets `--blink-settings` for a fine pointer with hover before your `args`, so your own `--blink-settings` wins, and headless Firefox gets `ui.primaryPointerCapabilities` and `ui.allPointerCapabilities` set to 6 unless the launch profile sets them. Chromium's mobile touch emulation still reports `(hover: none)` and `(pointer: coarse)`.
