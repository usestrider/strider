---
"@usestrider/browser": patch
---

A click, hover, or other pointer action on an element with `pointer-events: none` inside a button or link (`button`, `[role=button]`, `a`, or `[role=link]`) now goes through that button or link, which the browser hands the click to, instead of waiting until it times out with `NoPointerEvents`. A form field or editable element must still receive the pointer itself, and a `pointer-events: none` element outside any button or link is still refused.
