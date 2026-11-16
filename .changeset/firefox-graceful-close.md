---
"@usestrider/browser": patch
---

Closing a `Firefox.layer` scope now asks the browser it launched to close with WebDriver BiDi's `browser.close` and waits up to five seconds for it to exit before signaling it, as `Chromium.layer` does. Firefox writes cookies and localStorage to the profile as it quits, so a `userDataDir` now keeps them for the next launch, where before a persistent cookie and a localStorage item written just before the scope closed were lost. A Firefox that does not exit in time is stopped with SIGTERM, then SIGKILL, as before.
