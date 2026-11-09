---
"@usestrider/browser": minor
"@usestrider/vitest": patch
---

Options a caller writes no longer take `_tag`. A screenshot's area is `"viewport"`, `"fullPage"`, `{ clip }` or
`{ element }`, and its format `"png"`, or `"jpeg"` with `quality` beside it: `page.screenshot({ format: "jpeg",
quality: 80 })`. A cookie's scope is `{ url }` or `{ domain, path }`, and `TestRun.attach` takes `{ trace }`, `{ har }`
or `{ screenshot }`, each a path.

Breaking: replace `{ _tag: "FullPage" }` with `"fullPage"`, `{ _tag: "Clip", rect }` with `{ clip: rect }`,
`{ _tag: "Element", locator }` with `{ element: locator }`, `format: { _tag: "Jpeg", quality }` with
`format: "jpeg", quality`, drop `_tag` from a cookie's `scope`, and replace `attach({ _tag: "Trace", path })` with
`attach({ trace: path })`. The screenshot span's `browser.screenshot.area` and `browser.screenshot.format` attributes
are now the same lowercase names.
