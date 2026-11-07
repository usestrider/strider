---
"@usestrider/browser": minor
---

Support headless launched Chromium prerender activation with document, realm and frame identity transfer into the existing tab. Preserve surviving realm operations and access grants; dispose replaced-session resources and end only the speculative page with `Target.PrerenderActivated`.

Migration: exhaustive `Target.CloseReason` handlers must handle `PrerenderActivated`. Keep using the surviving tab; speculative-page controls do not become tab controls. Declare settings and handlers on the activating tab or context, not on a speculative page. Retained handles require their original live grant. Native recordings on the replaced session end rather than restart. Start recordings on the active tab; speculative-page recordings are unsupported.

Automation and concurrent profiles disable `PrefetchPrerenderIntegration` and `Prerender2FallbackPrefetchSpecRules` so speculative requests honor routes and configured headers. A user's `--disable-features` replaces the whole profile list: include both names to retain transfer support. Stock profiles and attached browsers are unchanged and have no supported transfer path; Firefox and WebKit also report it unsupported.
