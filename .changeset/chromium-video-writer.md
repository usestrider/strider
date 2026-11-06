---
"@usestrider/browser": minor
---

Enable Chromium WebM recording through the optional VideoWriter service and its explicitly configured ffmpeg layer. Pace idle frames at 25fps, preserve the initial output size through viewport changes, and include native video in traces. Coordinate shared screencast acknowledgements so slow consumers backpressure frame delivery. Consumers that stop reading must now close their acquisition scopes so other consumers can continue.
