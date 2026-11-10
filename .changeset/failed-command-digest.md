---
"@usestrider/browser": patch
---

Report the events since the last command when a command fails, and don't repeat them in the next one. A failed tool call's `ToolFailure` carries them as `sinceLast`; the CLI prints `since last:` after the failure's message on standard error and includes `sinceLast` in `--json`'s failure object.
