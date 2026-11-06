---
"@usestrider/browser": minor
---

Preserve source frame times in Chromium and polled WebKit video without fixed-rate idle copies. VideoWriter frames now carry nanoseconds relative to recording start, and the final frame marks stop time. Chromium streams anchor browser time to local receipt time, supporting different browser/client host clocks; frame times never decrease. The ffmpeg writer preserves variable-rate timing in VP8 WebM to millisecond precision.
