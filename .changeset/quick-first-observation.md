---
"@usestrider/browser": patch
---

Return the first locator expectation observation and an action's first observed blocker before waiting for changes, including when locator handlers are registered, so a later browser stall does not discard initial failure evidence. Replies received after the deadline still cannot change returned errors. Incomplete stability baselines do not become failure evidence.
