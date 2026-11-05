---
"@usestrider/browser": patch
---

Share Chromium screencasts between consumers on the same session so closing one scope or cleaning up an abandoned start cannot stop another consumer's stream. Register ownership before acquisition, interrupt unfinished acquisition when its scope closes, release abandoned reservations and trigger uncertain-start cleanup immediately without waiting for a reply, and bound both stop writing and confirmation with a fresh cleanup budget.
