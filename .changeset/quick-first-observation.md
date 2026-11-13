---
"@usestrider/browser": patch
---

Return the first locator expectation and action readiness observation immediately, so a later browser stall does not discard initial failure evidence. Replies received after the deadline still cannot change returned errors.
