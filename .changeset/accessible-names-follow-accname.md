---
"@usestrider/browser": minor
---

Compute accessible names by accname's traversal rules, as Chromium and Firefox do. An `aria-labelledby` target's hidden descendants count only when the target itself is hidden, and a hidden `<label>` still names its control. A whitespace-only child keeps its space, and children that aren't `display: inline`, and `<br>`, are separated by spaces. Name from content skips descendants whose role doesn't give its text, such as a nested tree item's group or an `alert` in a heading. An embedded ARIA combobox or listbox contributes its selected options, and a `menu` nothing. CSS `content` is read for its alternative text, `attr()`, and content set on the element itself, and a hidden pseudo-element contributes nothing. Names drop soft hyphens and zero-width spaces and keep non-breaking spaces, which still match a space. With `includeHidden`, hidden descendants count in names too.

Some names change. If an exact `name`, a `toHaveAccessibleName` expectation, or a saved snapshot relied on the old name, update it to the name the browser reports.
