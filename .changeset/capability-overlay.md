---
"@usestrider/browser": patch
---

Add `Capability.Overlay`, recording overlays drawn in the page on every backend. `overlay.add` shows HTML over the page until its scope closes or a `duration` passes, `overlay.chapter` shows a title card for a `duration`, `overlay.hide` and `overlay.show` hide and show every overlay, and `overlay.actions` annotates each locator action that sends input with its title, a cursor and optional point and highlight marks, waiting `duration` before the input. Overlays stay across main-frame navigations, appear in screenshots too, and are never matched by locators, included in snapshots or hit by actions. `CapabilityError` has two new reasons: `InvalidInput`, for an invalid duration, position or cursor, and `PromptBlocking`, for a page whose dialog nothing will decide.
