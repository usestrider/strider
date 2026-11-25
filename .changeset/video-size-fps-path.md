---
"@usestrider/browser": minor
---

Add options to `Capability.Video`: `page.capability(Capability.Video, { size, fps, path, overwrite })`. `size` sets the file's width and height, `fps` sets its frame rate, constant on Chromium and WebKit (`VideoWriter.Destination` gains an optional `fps`, which `layerFfmpeg` encodes at) and a ceiling on Firefox, and `path` names the file, so recording no longer needs the context's downloads directory. With `overwrite: false`, an existing file fails acquisition, and a file that appears while recording is never replaced. Invalid options fail with `CapabilityError{InvalidInput}`. `Capability` gains an options type parameter, `never` for the other capabilities.

The default size changes: a file is now the page's viewport in CSS pixels (on WebKit without an emulated viewport, its first picture's size), scaled down to fit 800 by 800 (a 1280 by 720 viewport gives 800 by 450), where it was the first image's size in device pixels. On Chromium and WebKit the file is exactly `size`, padded black; Firefox fits the page inside it as a box, keeping its shape, without padding.
