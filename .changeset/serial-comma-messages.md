---
"@usestrider/browser": patch
"@usestrider/vitest": patch
---

Use the serial comma in documentation comments, error messages, hints, and the `strider` CLI's help and output: "a checkbox, a radio, or an ARIA checkable", not "a checkbox, a radio or an ARIA checkable". A test that matches one of these messages word for word needs the comma too. A test exported with `strider export test` lists three or more names as "a, b, and c".
