---
"@usestrider/browser": minor
---

`isEnabled`, `Expect.toBeEnabled`, `Expect.toBeDisabled` and the enabled check that actions run now read an element inside a button, or inside an element with the role `button`, `checkbox` or `radio`, on that control. A span inside a disabled button, or inside a button in a disabled fieldset, is disabled. A click on such a span used to dispatch at once and report success, though the browser delivers no click to a disabled button; it now waits until the button is enabled, and times out if it stays disabled. Pass `checks: { enabled: false }` to act without the enabled check.
