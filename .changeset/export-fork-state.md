---
"@usestrider/browser": patch
---

Add `strider export test <test-path> --state <state-path>` to replay the initial state of a forked session. Write credentials only on request, restrict new and existing state files to mode 0600, and warn when Git could commit them. Preserve empty-start exports without the flag and explicitly identify unsupported profile replay.
