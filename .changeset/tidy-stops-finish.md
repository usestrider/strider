---
"@usestrider/browser": patch
"@usestrider/cli": patch
---

Wait for browser, session-directory and ledger cleanup before `strider stop` returns success. Report cleanup failures and complete shutdown even when a stop caller disconnects. Concurrent callers share cleanup; the first stop chooses whether to keep the directory.
