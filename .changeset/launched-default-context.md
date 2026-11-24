---
"@usestrider/browser": minor
---

Add `defaultContext` to `Browser.LaunchOptions`, so a launched browser's default context takes the options `newContext` takes, such as `httpCredentials`, `bypassCSP`, `downloads`, and `acceptInsecureCerts`. They apply to the startup page and to every page opened in the default context, for as long as the layer lasts; closing the layer releases what they set and never removes the context. `proxy`, `clientCertificates`, `requestTiming`, `requestSizes`, and `storageStateTracking` are refused before the browser starts. Because the default context's setup can fail, the launch layers of Chromium, Firefox, and WebKit now fail with `BrowserError | UserContextError | Deadline.Timeout` instead of `BrowserError` alone, which breaks code that names their error type.
