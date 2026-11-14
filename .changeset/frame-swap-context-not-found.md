---
"@usestrider/browser": patch
---

On Chromium, an action whose check runs in a frame just as the frame moves into its own process resolves the frame again under its deadline, instead of failing with `Runtime.callFunctionOn rejected: Unrecognized (uniqueContextId not found)`.
