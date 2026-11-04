---
"@usestrider/browser": minor
---

Change default pointer-action coordinates from the padding-box centre to a client-rectangle centre after viewport and parent-frame clipping. With `receivesPointer` enabled, choose the first centre that reaches the target or a descendant and its iframe in every parent document, including a later line when an earlier line is covered. If no centre reaches it locally, retain the first geometric candidate for `Covered`; if all locally reachable centres are blocked by parents, retain the first parent `Covered` result. Produce fresh candidates under the input permit. Validate framed lists with multiple candidates after parent probes, discarding changed geometry or replaced targets before sending a gesture. Disabling `receivesPointer` selects the first geometric centre without coverage probes. This fixes wrapped links, including links in scrollers and cross-origin frames. When no fragment remains, the viewport check scrolls and checks again. Integer-rounded default points stay inside the rectangle when an integer coordinate fits.

A target with no visible fragment now has no default point, even with actionability checks disabled: it waits and fails with `Timeout` if no point becomes available, rather than dispatching an offscreen point.

Migration: callers that depend on the former centre, such as canvas interactions, should supply an explicit `position` (and `targetPosition` for a drag target) measured from the padding-box top left. For the former centre, use half the padding-box width and height. Explicit offsets keep that origin and are not replaced by a clipped default point. For coordinate-based input without locator point selection, use `page.mouse` with viewport coordinates.
