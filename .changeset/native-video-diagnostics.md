---
"@usestrider/browser": patch
---

Keep native video acquisition, stop and file-read failures visible in the trace viewer's Console tab while allowing trace export to succeed. Diagnostics include the page, failure stage and underlying error and remain available in later exports.

If video acquisition is still pending when export begins, the Console tab explains that state without waiting or inventing a browser error. Later exports reflect the acquisition outcome.
