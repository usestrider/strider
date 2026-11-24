---
"@usestrider/browser": patch
---

Add `Expect.toHaveJSProperty`, which expects a JavaScript property of a locator's one match, a name or a dotted path, to deeply equal a value. It reads the property in the page's own JavaScript world, so properties a page script set are seen, and compares Dates by time, regular expressions by source and flags, arrays, Maps and Sets by their entries, and plain objects by their own keys. It takes a `Locator`, not a `ReadonlyLocator`, and retries until exactly one element matches and the value holds.
