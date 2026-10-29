---
"@usestrider/browser": minor
---

Make negative locator nth indexes out of range, following Effect collection indexing. They now match nothing: count returns zero, strict reads fail with NoMatch, and actions wait until their deadline. Positive indexes past the end behave the same way. first and last remain supported, including on empty lists where they match nothing.

Replace nth(-1) with last. For other positions relative to the end, read the count and use a nonnegative index, accounting for changes to the list between reads. Errors and traces now preserve nth(index), first or last as written, so consumers matching diagnostic strings should update their expectations for nth(0) and nth(-1).
