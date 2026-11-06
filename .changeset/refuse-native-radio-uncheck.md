---
"@usestrider/browser": minor
---

Refuse unchecking checked native radios with `Locator.WrongElement` before sending input, including through labels and their ordinary descendants. Consumers matching `StateUnchanged` for this case must match `WrongElement` instead. Calls with `trial: true` now refuse too, rather than reporting success for an action that cannot succeed. Check another radio in the group instead. Already-unchecked native radios remain successful no-ops, and page-managed ARIA radios can still be unchecked.
