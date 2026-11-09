---
"@usestrider/browser": minor
---

Add per-action `checks.rendered`, enabled by default for pointer actions and disabled for other actions. Ready fills and other non-pointer actions check current layout immediately, including just before input, while stability sampling and retry waits remain frame-based. Wait for application readiness when hydration could reset an early fill, or enable `rendered` for one call. Actions with rendering disabled no longer report the no-frame timeout hint.

Guard native design-mode filling against a focus change between selection and insertion; never replay partially inserted text. Keep later input blocked until guard cleanup is confirmed; if cleanup fails, log a warning and require closing the page.
