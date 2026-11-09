---
"@usestrider/browser": patch
---

Preserve Map, Set, Date and RegExp evaluation arguments recursively on Chromium, including non-string Map keys and nested special primitive values.

Keep evaluated callbacks' free identifiers and arrow `arguments` in the page realm on Chromium and WebKit. Preserve own `__proto__` argument keys as data on Chromium and WebKit; Firefox still drops this key.
