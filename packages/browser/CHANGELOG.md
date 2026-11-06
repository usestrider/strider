# @usestrider/browser

## 0.3.0

### Minor Changes

- 2cf324b: Enable Chromium's CDPScreenshotNewSurface in the default automation and concurrent launch profiles, changing the capture rendering path for headed and headless launches. Captures can drive rendering observable to the page; no capture non-observability guarantee applies. This changes the previous unstable default/contract, including CLI launches.
  
  Stock, attached browsers and independently constructed custom profiles are unchanged. Caller switches remain verbatim: a later --enable-features list replaces the preset list, so include CDPScreenshotNewSurface in it to retain the new path. Chromium also replaces repeated --disable-features lists. To opt out while preserving the preset's five existing disabled features, supply --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication,CDPScreenshotNewSurface as one combined list. Strider does not merge feature lists. Validated on Chromium 155.0.8059.79; other Chrome and Edge versions remain unverified.
- b0c0931: Restrict Page.route and UserContext.route handlers to the phases selected by options, including the request default. Calls that previously inferred response or authentication phases from their handlers must now pass `{ phase: "response" }` or `{ phase: "auth" }` explicitly. Explicit type arguments cannot override the default. When phase options are optional or unions, use a handler compatible with every possible phase (including request when phase can be omitted), or narrow the options before registering a phase-specific handler.
- dabf930: Make strict CLI and MCP find search only redacted snapshot content, preserving label searches and role filters.
  Mask semantic and plaintext-only editable content and all page-supplied exception details under strict capture,
  retaining exception occurrence time. Mask field content copied into other nodes' accessible or inferred names, following native/ARIA field ancestry
  through shadow hosts and assigned slots while preserving explicit public labels. Mixed names are masked whole;
  native select and ARIA listbox option text is masked with the field subtree.
  Add optional snapshot editability and name provenance;
  older snapshot data remains decodable. Local capture keeps its existing content and search behavior.
  
  Strict capture remains bounded: assertions such as `expect --text` and action selectors still operate on original
  page content and can confirm guesses at masked values.
  
  Collect field editability and field-content name provenance only for redacted capture, including custom masking policies. Ordinary library and local snapshots omit this masking metadata and skip its collection.

### Patch Changes

- b3a5611: Reuse fresh stability observations in check and uncheck when input can start immediately, while rechecking actionability and confirming the resulting state.
- 8ec884f: Allow check and uncheck on ordinary label descendants while preserving their pointer target and refusing interactive descendants before input.
- fe41db7: Release BiDi exception handles that evaluation does not expose to the caller.
- f57de19: Make one-shot event waits keep their first terminal outcome. Target end fails unfinished waits with `TargetGone` independently of delivery or predicate progress, including registration against an ended target. Scope closure cancels unfinished waits without draining queued events, completed results remain latched, and completed subscriptions release their buffers and internal finalizers. Acquiring-scope release continues waiting for running delivery and predicate work to exit, even when a terminal result has already been reported.
  
  This is a patch for the unstable event APIs: it restores the documented target-end guarantee and scope lifetime without changing signatures, options, defaults or valid completed results. A late success or timeout after the target ended was outside that guarantee and now becomes `TargetGone`.
- 3b7dad7: Preserve Firefox viewport and device scale overrides across nested declarations, release, and user context creation.
  
  Restore remaining Firefox viewports independently when another target rejects cleanup, and skip pages and contexts already closing. Roll back failed or interrupted context viewport setup under a separate cleanup deadline. Rejected or timed-out native cleanup now warns while preserving the original failure and the last known context state. An active operation stops waiting for viewport release at its own deadline while connection-owned cleanup continues under its separate budget.
  
  Reconcile surviving Firefox context and page viewports after failed or interrupted removal or close, preserving the original failure while bounded recovery continues independently of an expired operation.
- b65bc7b: Share Chromium screencasts between consumers on the same session so closing one scope or cleaning up an abandoned start cannot stop another consumer's stream. Register ownership before acquisition, interrupt unfinished acquisition when its scope closes, release abandoned reservations and trigger uncertain-start cleanup immediately without waiting for a reply, and bound both stop writing and confirmation with a fresh cleanup budget.
- 9728fec: Add level, checked, pressed, expanded, selected and disabled filters to getByRole. Unsupported role/filter combinations fail when the locator is used.
- 8d1ea51: Serialize CDP override application with declaration release so interrupted setup restores surviving pages' locale.
- ddf9e32: Report validation observed during toolkit and CLI clicks, including repeated attempts, with messages governed by capture policy. This temporal feedback does not claim a submission was blocked; observation covers the top document and its existing open shadow roots.
  
  
  Optional validation feedback stays within the click's budget and can be interrupted. Observer release runs separately when collection cannot finish; dialogs, busy pages and document loss may discard feedback. Toolkit and CLI click timeouts now name `Toolkit.click` rather than `Locator.click`; other locator tools retain their existing names.
- 8d10bf7: Allow actions on transparent controls, including fill and controls inside transparent ancestors. Opacity alone does not make an action wait for a fade-in. With `opacity: 0` on the element or any ancestor, `isVisible` returns false, `Expect.toBeVisible` waits, and visibility filters count the element as hidden.

## 0.2.0

### Minor Changes

- 1ffff69: Change default pointer-action coordinates from the padding-box centre to a client-rectangle centre after viewport and parent-frame clipping. With `receivesPointer` enabled, choose the first centre that reaches the target or a descendant and its iframe in every parent document, including a later line when an earlier line is covered. If no centre reaches it locally, retain the first geometric candidate for `Covered`; if all locally reachable centres are blocked by parents, retain the first parent `Covered` result. Produce fresh candidates under the input permit. Disabling `receivesPointer` selects the first geometric centre without coverage probes. This fixes wrapped links, including links in scrollers and cross-origin frames. When no fragment remains, the viewport check scrolls and checks again. Integer-rounded default points stay inside the rectangle when an integer coordinate fits.
  
  A target with no visible fragment now has no default point, even with actionability checks disabled: it waits and fails with `Timeout` if no point becomes available, rather than dispatching an offscreen point.
  
  Migration: callers that depend on the former centre, such as canvas interactions, should supply an explicit `position` (and `targetPosition` for a drag target) measured from the padding-box top left. For the former centre, use half the padding-box width and height. Explicit offsets keep that origin and are not replaced by a clipped default point. For coordinate-based input without locator point selection, use `page.mouse` with viewport coordinates.

### Patch Changes

- 2d18ff6: Synchronize every Chromium screenshot with a renderer layout-metrics read before capture, reusing it for full-page and CSS sizing. This adds renderer responsiveness and layout work within the existing deadline; interruption or document replacement during the read prevents capture dispatch.
- eced824: Mask rich editable fields' descendant names and text-derived editable names under strict capture, including names and paths returned by find. Preserve field labels, element refs, and full capture output.
- 24a7c81: Read Chromium renderer layout metrics before screencast acquisition to order it after tracked navigation processing. This shares screenshots' readiness read and adds renderer/layout work within the existing acquisition deadline; metrics errors can surface before start. It does not guarantee activation across another navigation.
- 1c51f9c: Recheck protocol reply deadlines on the monotonic browser clock so an early timer does not let a resolving Timeout escape an inherited expectation deadline.

## 0.1.2

### Patch Changes

- 9bf0ba8: Add `strider agent instructions` to print a versioned CLI usage guide for agent context, with `--skill` to emit the same guide as a skill.
- c256b0f: Protect CLI session roots with per-user fallback paths and ownership, permission and symlink validation, and allocate startup files in private temporary directories.
  
  Without XDG_RUNTIME_DIR, the fallback moves from `<OS temp directory>/strider` to `strider-<uid>`. Old daemons are
  no longer discovered there: stop them with the older CLI before upgrading and restart sessions. Unsafe existing
  roots are refused without changing their permissions; root/session symlinks are refused while trusted ancestor
  aliases are resolved and checked. Missing session connections keep the NoSession exit code, and refusals print
  to stderr without corrupting MCP stdout. Session names are validated before path use or named cleanup.
  
  Missing-session diagnostics retain the running-session list and exit code 20. Named prune matches whole path
  arguments or long-option path values, including directory boundaries, so similarly named or embedded unrelated
  paths do not select a process. Trusted ancestor aliases keep their validated spelling for socket paths, and the
  internal socket basename is shortened to `sock` to leave room for 32-character session names. Stop older daemons
  with the older CLI before upgrading, including sessions in XDG_RUNTIME_DIR; socket files are not migrated.
  
  If already upgraded with an old daemon still alive, prefer stopping it with the old CLI under its original runtime
  environment. Otherwise stop sending commands and wait for the daemon's configured `--idle` timeout (default:
  `1 hour`; startup overrides apply and further commands reset the timer). Before manually terminating it, independently
  verify that the lock's `pid` still identifies your account's daemon for that session: check ownership, command/session
  arguments and process start time against `startedAt` (Unix epoch milliseconds). Never signal a process solely because
  a stale lock names its PID; if identity is uncertain, use the old CLI or wait. Once the verified daemon and its browser
  have exited, inspect and remove only identified leftovers you own, then restart with the new CLI. Do not copy locks
  or sockets, delete live profiles, or automatically reclaim the old shared fallback.

## 0.1.1

### Patch Changes

- fa12edd: Publish the current build. 0.1.0's `dist` was out of date against its `src`: among other things it lacked the `Operation` module and the `experimental` entry point, so use this version instead.

## 0.1.0

### Minor Changes

- b24968b: Initial release.
