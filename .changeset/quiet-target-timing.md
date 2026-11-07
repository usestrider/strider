---
"@usestrider/browser": minor
---

Reject required init-script timing on attached Chromium scopes covering new pages with `DeclarationError` whose reason is `TimingUnsupported`. Page-scoped timing is unchanged. Use `timing: "bestEffort"` only where it is acceptable for a new target's first author scripts to run before the init script; otherwise use a launched browser or register on an existing page for its later documents.

Remove the unproduced `Target.PrerenderActivated` close reason. Migration: remove `PrerenderActivated` imports and close-reason handlers. Current adapters do not implement prerender activation or document/realm transfer between pages.
