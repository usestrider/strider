---
"@usestrider/browser": patch
---

`Locator.selectOption` waits while a chosen option, or its `<optgroup>`, is disabled, and a timeout reports the disabled option, instead of selecting it. A `SelectOption` that names more than one of `value`, `label` and `index` no longer compiles; before, only the first was used.
