---
"@usestrider/browser": minor
---

Stock WebKit refuses `emulation: { javaScript: "disabled" }` with `Unsupported`, under the new capability `emulation.javaScript.disabled`. With scripts off, stock WebKit gives a page no script context, so Strider couldn't read or act on it. Until now the setting was never sent to a page, so its scripts ran anyway. `javaScript: "enabled"` is still accepted, under `emulation.javaScript`, and is now applied to each page as it is set up, including after a process swap. Chromium supports both capabilities. Firefox refuses both, as before.

To migrate, check for `emulation.javaScript.disabled` in the browser's `capabilities` before disabling JavaScript, or run those cases on Chromium. Code that tested `emulation.javaScript` to decide whether it could disable scripts should test `emulation.javaScript.disabled` instead.
