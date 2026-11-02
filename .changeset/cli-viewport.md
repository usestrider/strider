---
"@usestrider/browser": patch
---

Add CLI startup viewport sizing and selected-page resizing, preserving both in exported tests. Confirm stock WebKit viewport dimensions for up to five seconds and report requested/actual sizes with Reason.ViewportMismatch when they do not match; verify restoration and close failed newly created pages.
