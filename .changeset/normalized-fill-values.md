---
"@usestrider/browser": patch
---

Accept equivalent browser serialization when filling color, range and datetime-local inputs. Validate settable input values before changing the live input, so malformed values and range values changed by clamping or rounding fail without changing its value or emitting input/change events.
