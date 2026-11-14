---
"@usestrider/browser": patch
---

Recorded videos keep small text legible: `VideoWriter.layerFfmpeg` now gives libvpx constrained quality (CRF 8, quantizer 0 to 50, 4 Mbit/s target) instead of its 256 kbit/s default, and Chromium's screencast asks for JPEG quality 90. Videos, and the screencast frames in Chromium traces, are larger.
