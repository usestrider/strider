---
"@usestrider/browser": patch
---

A design-mode fill interrupted while a navigation destroyed its page's script context no longer leaves the page's input blocked. When the guard's removal finds the context destroyed, the cleanup now waits, within its own deadline, for the document to end, which takes the guard's listeners with it, and then reopens input. A document still live at that deadline, and an engine that is missing from a live document, still keep input blocked with the same warning.
