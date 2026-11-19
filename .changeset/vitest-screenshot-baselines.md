---
"@usestrider/vitest": patch
---

Add `ScreenshotBaseline.toMatch`, which compares a page's screenshot, or one element's through `area: { element }`, with a PNG baseline keyed by test file, name, browser engine, and platform. It captures until a capture matches or two in a row agree, ignores anti-aliasing, and takes `threshold`, `maxDiffPixels`, and `maxDiffPixelRatio`. Baselines follow Vitest's snapshot update state: a local run writes a missing baseline and still fails, `vitest -u` rewrites differing ones, and CI writes none. A failure writes and attaches the actual, expected, and diff images. `CurrentSettings` overrides the update mode, the baseline path, and the output directory. The browser package is unchanged.
