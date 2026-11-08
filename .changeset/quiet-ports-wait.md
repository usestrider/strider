---
"@usestrider/browser": patch
---

Wait for a complete, valid DevToolsActivePort endpoint before connecting to a Chromium debugging port.

Include an exited browser’s final stderr diagnostics when collection finishes within the remaining launch readiness timeout. If stderr stays open beyond that deadline, report the tail collected so far without extending the launch timeout.
