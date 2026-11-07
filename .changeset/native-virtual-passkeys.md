---
"@usestrider/browser": minor
---

Add scoped native Chromium virtual authenticators for page passkey tests, with redacted credential export/import, management and verification/presence controls. Firefox and WebKit return Unsupported; copies on another page or popup keep independent signature counters.

`isCapability` now narrows to inspect or control capabilities; before passing its result to `ReadonlyPage.capability`, check `capability.access === "inspect"`.

The experimental CDP WebAuthn credential codec now treats private keys as Redacted values in decoded data and command input.
