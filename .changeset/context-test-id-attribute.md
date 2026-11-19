---
"@usestrider/browser": patch
---

Add `UserContext.Options.testIdAttribute`, the attribute `getByTestId` matches on a context's pages, such as `data-qa`. It defaults to `data-testid`, applies only to the context that sets it, and a name that isn't an HTML attribute name fails with `InvalidInput`.
