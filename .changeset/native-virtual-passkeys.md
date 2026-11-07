---
"@usestrider/browser": patch
---

Add scoped native Chromium virtual authenticators for page passkey tests, with redacted credential export/import, management and verification/presence controls. Firefox and WebKit return Unsupported; copies on another page or popup keep independent signature counters.

The experimental CDP WebAuthn credential codec now treats private keys as Redacted values in decoded data and command input.
