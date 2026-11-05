---
"@usestrider/browser": minor
"@usestrider/cli": minor
---

Enable Chromium's CDPScreenshotNewSurface in the default automation and concurrent launch profiles, changing the capture rendering path for headed and headless launches. Captures can drive rendering observable to the page; no capture non-observability guarantee applies. This changes the previous unstable default/contract, including CLI launches.

Stock, attached browsers and independently constructed custom profiles are unchanged. Caller switches remain verbatim: a later --enable-features list replaces the preset list, so include CDPScreenshotNewSurface in it to retain the new path, or use --disable-features=CDPScreenshotNewSurface to opt out. Validated on Chromium 155.0.8059.79; other Chrome and Edge versions remain unverified.
