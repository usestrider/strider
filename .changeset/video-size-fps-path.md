---
"@usestrider/browser": minor
---

Add options to `Capability.Video`: `page.capability(Capability.Video, { size, fps, path, overwrite })`. `size` sets the file's width and height, `fps` makes it constant-rate (`VideoWriter.Destination` gains an optional `fps`, which `layerFfmpeg` encodes at), and `path` names the file, so recording no longer needs the context's downloads directory. With `overwrite: false`, an existing file fails acquisition, and a file that appears while recording is never replaced. Invalid options fail with `CapabilityError{InvalidInput}`. `Capability` gains an options type parameter, `never` for the other capabilities.

The default size changes: a file is now the page's viewport in CSS pixels, scaled down to fit 800 by 800 (a 1280 by 720 viewport gives 800 by 450), where it was the first image's size in device pixels. Firefox keeps the page's aspect ratio inside the size, without padding.
