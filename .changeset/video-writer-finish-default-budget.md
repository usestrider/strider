---
"@usestrider/browser": patch
---

A `Capability.Video` writer on Chromium or polled WebKit now has `Deadline.DefaultBudget`, 30 seconds by default and read when the capability is acquired, to finish after the recording ends, and the failure names that limit. It had a fixed five seconds, so a recording failed with `BackendFailure` when the encoder was still catching up on a loaded machine. Wrap `page.capability(Capability.Video)` in `Deadline.withDefaultBudget` to give it longer.
