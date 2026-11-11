# @usestrider/browser

## 0.8.3

### Performance

- On Chromium, a context created with `focus: "emulated"` now opens its pages as tabs instead of windows of their own. Creating twenty pages in one context, using them, and closing the context takes 44% less time. The default, `focus: "system"`, still opens a window per page (#281).
- Closing a context on Chromium is about 27 ms faster. When a scope that created a context ends, Strider removes the context in one protocol command, which closes its pages, instead of closing each page first. A page closed on its own, or in a context that stays open, closes as before, and a context the browser refuses to remove still has its pages closed one by one (#271, #285).

### Fixed

- `Locator.evaluate`, `Locator.evaluateAll`, a synthetic `dragTo`, and `storageState` no longer use the previous document's realm when a frame commits a new document while an element is being found. They use the document the element belongs to (#280).
- A design-mode fill interrupted while a navigation destroys its page's script context no longer leaves the page's input blocked (#269).
- Closing a page now ends its frames' documents as well as its own, so a wait on a frame's document finishes at once instead of running to its deadline (#269).
- Response body subscriptions (`NetworkResponse.next` and `stream` with `body`) now end, and cancel any body read in progress, when borrowed inspect access is released. A subscription started with an expired grant fails with `TargetGone` (#272).
- Launching stock WebKit no longer fails intermittently with `PermissionDenied` reading `/proc/<pid>/fd`: the child's descriptors are read only once a listener exists on the inspector port (#283).

### Changed

- Documentation comments, error messages, hints, and the `strider` CLI's help and output use the serial comma. A test that matches one of these messages word for word needs the comma too, and a test exported with `strider export test` lists three or more names as "a, b, and c" (#277).

## 0.8.2

### Added

- **`context.routeWebSocket`** (#258): mock WebSocket connections, or proxy them to the real server, and watch or change their messages. It works by replacing the page's `WebSocket` constructor with a script, so it requires `implementation: "script"`, and page scripts can see and interfere with that replacement. A handler that returns without calling `open` or `connectToServer` fails the connection as an unreachable server does, and its deadline covers only that decision. Unrouted sockets in a routed context stay `instanceof WebSocket`. On WebKit it requires explicit best-effort timing, and Firefox refuses worker routing.
- **`context.setStorageState(state)`** (#243): replace a live context's cookies and origin storage, keeping its pages, for contexts created with `storageStateTracking: true`. It refuses before changing anything when it can't, and reports a partial failure as `StorageState.PartiallyApplied`.
- **`NetworkRequest.sizes`** (#244): the browser's own byte counts for a request's transfer and its encoded and decoded body, for contexts created with `requestSizes: true`. A count the browser doesn't give is `None`, never estimated.

### Fixed

**Pages, frames and navigation**

- Chromium popups opened with `rel="noopener"` no longer stay at `about:blank` (#250).
- Firefox `page.back()` and `page.forward()` through a `history.pushState` entry no longer time out (#254).
- On Chromium, a call into a nested frame that moved to its own process mid-call runs again on the frame's new context instead of failing with "Execution context was destroyed." (#264).

**Input**

- A click, drag or key press that fails or is cut short after it may have pressed a button or key now has that input released before the next gesture. A release whose outcome is unknown is sent again, which can deliver one extra `mouseup` or `keyup` (#262).
- A fill that runs out of time before its text is typed reports that nothing was sent, instead of that the input was sent and confirmed (#241).

**Evaluation**

- `Map`, `Set`, `Date` and `RegExp` arguments, and special numbers inside arrays and objects, keep their types on Chromium instead of arriving as plain objects (#242, #249).

**Network**

- On Firefox, reading the body of a 301, 302, 303, 307 or 308 response without a `Location` header fails at once with `Unsupported` (capability `network.responseBody.terminalRedirect`) instead of hanging until the deadline, because Firefox doesn't answer for it. A pending body read no longer returns a later redirect hop's bytes (#248).

**Screenshots**

- Chromium element and clip screenshots that fit the viewport keep its scrollbar layout, so wrapped text is no longer cut off (#252).

**CLI and toolkit**

- A failed command reports what happened since the last one along with its error, instead of leaving those events for the next command (#255).
- A command's own navigation, from `page new`, `goto` or `back`, is no longer reported again as "since last" on the next command (#246, #256).

**Firefox init scripts**

- Init scripts added and removed at the same time no longer interfere, and removing them shares one five-second budget instead of five seconds per script (#258).

### Performance

- Creating a page on Chromium is 13–15% faster (#250).
- Reading a page's title on Chromium and Firefox no longer installs Strider's in-page query engine first; `goto` followed by a title read is about 21% faster on Chromium (#253).

## 0.8.1

### Added

**Locators and pages**

- **`Locator.boundingBox`** (#221): the element's box in the top-level viewport's CSS pixels, from the browser's own measurements and carried through frames, or `None` for an element without a layout box.
- **`page.viewportSize`** (#214): the page's configured viewport, or `None` when none is set.

**Assertions**

- **`Expect.toHaveRole`** (#220) and **`Expect.toHaveAccessibleName`** (#218), with a regular-expression form and `ignoreCase`.
- **`Expect.toHaveCSS`** (#217): a computed style, as a string or a regular expression, including pseudo-elements.
- **`Expect.toBeAttached`** and **`Expect.toBeDetached`** (#225), independent of visibility.
- **`Expect.toBeEmpty`** (#223): an empty field value, or element text that's empty once trimmed.
- **`Expect.toBeInViewport`** (#226), with an optional minimum ratio.
- **`Expect.toHaveValues`** (#224): a multiple select's selected values, in order.

**Network details**, each opt-in and costing nothing when unused:

- **Request bodies** (#229): decoders on `NetworkRequest.next` and `stream` read what a request sent: text, JSON, forms or bytes.
- **The response a request got** (#231), with a bounded wait.
- **`NetworkRequest.failure`** (#227): why a request failed, read at once.
- **`NetworkRequest.timing`** (#234): the browser's timing phases, for contexts created with `requestTiming: true`.
- **`NetworkRequest.redirects`** (#235): a request's predecessor and successor in a redirect chain. Where a browser can't tell whether a successor is coming, it says so with a typed outcome instead of guessing.

**Contexts**

- **`UserContext.Options.httpCredentials`** (#233): website authentication for a context on Chromium and Firefox, with a `Redacted` password and an optional origin.
- **`UserContext.Options.acceptInsecureCerts`** (#228): accept HTTPS certificate errors in one context, on Firefox and launched stock WebKit. Chromium refuses it, because its setting would apply to the whole browser.

### Fixed

- **Role and accessible-name computation** (#220, #218): presentation-role conflicts, required structural parents, and roles that prohibit a name now match the ARIA rules. This affects `getByRole` and snapshots.
- **Waits interrupted by a navigation** (#230 Chromium, #232 WebKit): a wait that a navigation cut off now follows the new document within its deadline, instead of failing or hanging. An action that may already have happened is never run twice.

## 0.8.0

### Breaking changes

- **Options you write take no `_tag`** (#210). A screenshot's `area` is `"viewport"`, `"fullPage"`, `{ clip }` or `{ element }`, and its format `"png"` or `"jpeg"` with `quality` beside it: `page.screenshot({ area: "fullPage", format: "jpeg", quality: 80 })`. A cookie's `scope` is `{ url }` or `{ domain, path }`, and `TestRun.attach` takes `{ trace }`, `{ har }` or `{ screenshot }`. To migrate, replace `{ _tag: "FullPage" }` with `"fullPage"`, `{ _tag: "Clip", rect }` with `{ clip: rect }`, `{ _tag: "Element", locator }` with `{ element: locator }`, `format: { _tag: "Jpeg", quality }` with `format: "jpeg", quality`, drop `_tag` from a cookie's `scope`, and replace `attach({ _tag: "Trace", path })` with `attach({ trace: path })`. The screenshot span's `browser.screenshot.area` and `browser.screenshot.format` attributes use the same lowercase names.
- **Only pointer actions wait for a drawn frame** (#213). A new per-action check, `checks.rendered`, is on by default for click, double-click, tap, hover, drag, check and uncheck, and off for fill, focus, press, type, select, file inputs and scrolling. Those now check the element's current layout at once and wait only while it isn't ready. If your app hydrates late and resets an early fill, wait for an app-defined readiness condition, or pass `checks: { rendered: true }` for that call. Actions with `rendered` off no longer give the "rendered no frame" hint.

### Performance

- **Fill-heavy sessions run about twice as fast** (#213). On Chromium, a 300-action session takes 5.3 s instead of 10.2 s, level with Playwright, and four parallel tests sharing a browser take 29% less time. Firefox sessions are about half as long as before.

### Added

- **`Locator.blur`** (#200): removes focus from the one matched element, without keyboard or pointer input.
- **`Locator.dispatchEvent`** (#204): dispatches an untrusted DOM event. You choose the event class (`Event` by default) and pass its initialization data.
- **`Locator.isEditable`** (#205): reads whether the element is editable, by the same rules fill and `toBeEditable` use. Unsupported kinds of element read `false`.
- **`Locator.selectText`** (#206): selects an input's value or an element's contents, following labels, with trial mode and frames.
- **`Locator.evaluateAll`** (#211): evaluates a function over all current matches at once, including none.
- **`Page.setContent`** (#209): replaces a document's HTML through the browser's parser, keeping its URL and history. It waits for `load` by default.
- **`Expect.toHaveClass`** (#215): a retrying assertion on an element's class, as a whole string, a regular expression or an ordered list.
- **Extra request headers** (#212): set headers on every request from a page or a context, through emulation. A page's headers override its context's.

### Fixed

- **Fill re-checks its target after focus** (#198): if a focus or selection handler hides the field or makes it inert, fill waits instead of typing into it.
- **Fill in design-mode documents** (#213): a focus change between selecting and inserting no longer sends text to the wrong place, and partly inserted text is never typed again.
- **A Chromium click whose mousedown opens a dialog** (#216) now delivers its mouseup and click. It was finishing without them. Clicks are no slower.

## 0.7.0

### Breaking changes

- **Requires Effect 4.1.2** (#188): `effect` and `@effect/platform-node` `^4.1.2`. A program on Effect 4.0 upgrades both, to the same version.

### Added

- **`strider export test --state <path>` for forked sessions** (#182): writes the state the session started from to `<path>`, with mode `0600`, and the exported test loads it. Without the flag, a forked session's test still starts empty. Sessions started with `--user-data-dir` can't be exported this way.
- **A warning when Git could commit saved credentials** (#177): `strider state save` and `export test --state` warn on stderr when the file is in a Git work tree and not ignored. Saving still succeeds.
- **Unknown secret placeholders are reported** (#174): a `%name%` that names no configured secret is reported in toolkit results, CLI output and exported tests, with a suggestion when it's a near miss of a configured name. The text is still sent as written.

### Fixed

- **Firefox locator checks after a navigation** (#180): a check that was waiting in a page the navigation replaced now continues in the new page, instead of waiting until its timeout.
- **Chromium download settings and closing contexts** (#181): restoring a context's download settings no longer races the context closing, and restores only the contexts it affects.
- **Stock WebKit opens a page after another closed** (#135): a new page in a launched context whose previous page had closed waited until its deadline.

### Documentation

- A route applies to requests that start after it's declared (#175). On Chromium, a request already underway may miss a response route declared later.

## 0.6.0

### Breaking changes

- **Snapshot `pressed`, `expanded` and `selected` markers match role filters** (#165). Keywords are case-insensitive (`TRUE` now adds the marker), markers appear only for `true` on roles that support them, and a native `<option>`'s selection and a `<details>` element's open state take precedence over ARIA. Stored snapshot expectations may need updating.
- **`isCapability` narrows to inspect or control capabilities** (#157). Check `capability.access === "inspect"` before passing its result to `ReadonlyPage.capability`.

### Added

- **Virtual passkeys** (#157): `page.capability(Capability.VirtualAuthenticator)` gives a page a native Chromium WebAuthn authenticator, for testing passkey registration and sign-in, with credential management, redacted export and import, and user-verification and presence controls. `Unsupported` on Firefox and WebKit. A second page or a popup gets its own copy of a credential.
- **Proxies** (#158): `UserContext.Options.proxy` routes a context's HTTP and HTTPS traffic through an HTTP proxy, with bypass hosts and credentials with a `Redacted` password, on Chromium and launched Firefox. Launched WebKit supports proxies without credentials.

### Fixed

- **Chromium port launches wait for the complete endpoint** (#163) before connecting, instead of connecting to a half-written `DevToolsActivePort`.
- **A browser that exits during launch reports its final stderr** (#163), collected within the launch timeout.
- **WebKit startup reports a lost connection at once** (#161), instead of waiting for the startup deadline.
- **Stock WebKit snapshots keep child-frame content** (#170) when the browser's two clocks read a frame's start time a millisecond apart, and can't pick a sibling frame.
- **`strider export` explains ambiguous password fields** (#164): a named password field matching controls in different frames fails with guidance to narrow the locator, instead of crashing.

### Documentation

- On Chromium, a prefetch sent through a page's `<script type="speculationrules">` skips page and context routes (#168).

## 0.5.0

### Breaking changes

- **`aria-checked` keywords are case-insensitive** (#141). `TRUE` now reads as checked. `mixed` counts as unchecked on `radio`, `menuitemradio` and `switch`. On `option` and `treeitem`, a malformed `aria-checked` refuses `check`/`uncheck` with `WrongElement` before any input; use explicit `true`, `false` or `mixed` tokens to make them checkable.
- **`Target.PrerenderActivated` is removed** (#153). No backend could produce it; it returns when prerender activation is supported.
- **Attached Chromium refuses init-script timing it can't guarantee** (#153). A context-wide script that needs `beforeAuthorScript` timing fails with `TimingUnsupported`, because attached Chromium doesn't pause new popups. Use `timing: "bestEffort"`, or register on an existing page.

### Added

- **Traces link steps to their source and name their test** (#136, #138): steps link to their call sites in the viewer's Source tab, with the source files in the archive, and the trace records the test and retry that produced it. `TestRun.info` gains `repeat`.
- **`strider eval`** (#154): `strider eval <expression>` or `eval --file fn.js` runs JavaScript in a page and prints the serialized result, in an isolated world unless `--main-world`.
- **`strider export` handles unnamed password fields in frames** (#148).

### Fixed

- **Video files start with a picture at time 0** (#137). ffmpeg's end-relative seeks (`-sseof`) returned no frame when the first frame arrived late.
- **`fill` checks the field again after focus** (#132): a focus handler that makes it read-only or disabled now gets the documented wait, and one that makes it non-editable gets `NotEditable`, instead of a false success.
- **Chromium `page.url` keeps the fragment** after navigating and when attaching (#125).
- **Waits on a request's sent headers return** when the request is evicted or loses its frame, worker, context, page or connection, instead of hanging until the deadline (#146).
- **Firefox history traversal completes** when its page realm arrives after the reply (#149).
- **WebKit polled video finishes cleanly** when its page closes mid-capture (#127).
- **`strider stop` waits for its cleanup** (#134): it returns once the browser, session directory and ledger record are gone, and a failed cleanup exits non-zero.
- **Lower overhead on every operation** (#143): caller stacks are captured lazily, about 2 µs instead of 17 µs per call.

### Diagnostics

- A trace whose native video fails says why, in the viewer's Console tab (#131).
- WebKit startup failures name the stage they reached and when (#126).
- Chromium's empty screenshot failure says "Chromium returned an empty image" (#144).
- `Expect.that(page.url, …)` and `Expect.that(page.title, …)` failures are redacted in strict trace exports (#133).

## 0.4.0

### Minor Changes

- 80fd57e: Enable Chromium WebM recording through the optional VideoWriter service and its explicitly configured ffmpeg layer. Pace idle frames at 25fps, preserve the initial output size through viewport changes, and include native video in traces. Coordinate shared screencast acknowledgements so slow consumers backpressure frame delivery. Consumers that stop reading must now close their acquisition scopes so other consumers can continue.
  
  Require writers to fit every output frame to Strider’s fixed dimensions, centred with black padding, and verify this with reusable conformance coverage. End recording input with the source, fail empty recordings promptly, and bound writer finishing even while the caller scope remains open.
- cbfa7f1: Upload `FileInput.local` contents to attached browsers using scoped open-file reads and sequential acknowledged 64 KiB chunks. Bytes share the chunk transport, avoiding whole-file encoded strings. Preserve transferred basenames, inferred MIME (application/octet-stream fallback), and available stat modification times. No library size cap is added; browser storage and resource limits still apply.
  
  Attached Local uploads now require captured Effect FileSystem and Path services and cannot mix with Remote paths; they may mix with Bytes. These compatibility changes require an unstable minor bump. Launched Local uploads retain native paths, previous service requirements and Local/Remote combinations. A container or wrapper launch with separate storage must use Bytes instead. Stock WebKit's existing native-path append limitation remains, and launched stock WebKit supplies upload-time creation timestamps instead of disk modification times.
  
  Validate transferred-file and native locator cardinality before selection changes, and clear empty selections through page-side construction. Transferred chooser selections and empty multiple selections need an identified input. Reads and transfer consume the original handler deadline, including time already spent in the handler; failure or interruption cancels the chooser and releases transfer resources.
  
  Keep failed chooser preparation out of the handled count, while retaining count-before-application ordering for prepared decisions and the user handler’s registration scope.
- db5244d: Preserve source frame times in Chromium and polled WebKit video without fixed-rate idle copies. VideoWriter frames now carry nanoseconds relative to recording start, and the final frame marks stop time. Chromium streams anchor browser time to local receipt time, supporting different browser/client host clocks, and cap mapped times at receipt so forward clock jumps cannot extend the recording; frame times never decrease. The ffmpeg writer preserves variable-rate timing in VP8 WebM to millisecond precision.
- 99745b7: Refuse unchecking checked native radios with `Locator.WrongElement` before sending input, including through labels and their ordinary descendants. Consumers matching `StateUnchanged` for this case must match `WrongElement` instead. Calls with `trial: true` now refuse too, rather than reporting success for an action that cannot succeed. Check another radio in the group instead. Already-unchecked native radios remain successful no-ops, and page-managed ARIA radios can still be unchecked.

### Patch Changes

- 72af3f6: Add explicitly enabled stock WebKit video from PNG polling, with a supplied VideoWriter, polling interval and caller-owned output directory.
- 38678ab: Explain that response and auth route handlers need an explicit phase when it is omitted on a page or user context.
- 34171bc: Make `strider state save` and `strider export test` create the missing directories on the way to the file they write.
- eb9da18: Create the missing directories on the way to a trace or HAR export's path, instead of failing with a file system "not found" that reads as if the file itself were missing.
- c61613b: Make fill wait when a focus handler makes a settable input read-only or disabled, before assigning its value or switching to typing. Honor per-call enabled and editable check overrides after focus.
- 4cfc183: Release BiDi script handles returned after interruption or timeout, including exception handles, in the reply realm.
  
  Reject unsupported extra release-parameter mappings, handle escaped reply pointers consistently, and keep malformed cleanup definitions from stopping the protocol reply reader.
- b4bcf73: Expose roleless password inputs in snapshots as inferred editable controls with password evidence, preserving accessible names and excluding values, including values referenced by another element for its name. Find matches the password designation using its usual case and exact rules. Export named password refs by waiting for their exact computed name in snapshots, preserving naming precedence, supporting a single framed match and leaving duplicate names ambiguous. Unnamed refs retain the password input selector.
- a6c3c98: Preserve both locale and user-agent settings on Chromium when either declaration is installed, replaced or released.
- b282791: Capture a screenshot when a page-associated expectation succeeds or fails with trace screenshots set to "perAction", including after its deadline expires. Give each completion capture its own fixed one-second browser-clock budget; omit failed or timed-out captures while preserving the original operation result. Keep screenshots off by default and DOM snapshots limited to actions and navigation.
- f12f85c: Calculate expectation page-round waits from the time remaining after routing and engine setup, keeping the original overall deadline.
- 19dad83: Blur the previous text control, including one inside open shadow roots, before filling non-input design-mode targets and recheck the target after blur handlers. Retain focus-preparation history when refocusing prevents filling. Document Firefox's top-level design-mode input focus limitation in fill and the capability table.
- 0422966: Record write acknowledgements and operation cleanup outcomes in diagnostic snapshots, preserving uncertainty for unanswered and overlapping writes and pending late creations.
- 21d6bcb: Preserve WebKit document response bodies across adapter-controlled navigation and reload during response-body collection. Wait only for the responded, committed main document's unfinished load and document retention reads already started on the page; provisional and unfinished iframe loads do not delay dispatch. The wait is interruptible within the existing navigation deadline, without grace, so an indefinitely streaming main document can cause a timeout. Close the collection's owning scope before navigating when that body need not be preserved. Without response-body collection there is no added wait.
- ca2eaf1: Include failed expectations' observations, check count, elapsed time, nearest match and suggestions in exported trace error messages so trace viewers display the failure evidence.
  
  Record page URL expectations in their page's trace. Apply the diagnostics preset at each export to expected and observed URLs, hide titles under strict, and strip classified form values under both presets without changing the caller's failure. Preserve the originating expectation's redaction through enclosing operations and caught/rethrown failures.
- 8196abe: Make `Trace.Options` refuse `domSnapshots: true` without `network: true` at compile time. Options are now `CaptureOptions & (NetworkOptions | SnapshotOptions)`; options built from a computed flag choose a branch, as in `flag ? { domSnapshots: true, network: true } : {}`.
- 992aee8: Reject non-string `Locator.pressSequentially` values, including non-string Redacted contents, with `InvalidInput` before contacting the browser, without exposing the supplied value.

## 0.3.0

### Minor Changes

- 2cf324b: Enable Chromium's CDPScreenshotNewSurface in the default automation and concurrent launch profiles, changing the capture rendering path for headed and headless launches. Captures can drive rendering observable to the page; no capture non-observability guarantee applies. This changes the previous unstable default/contract, including CLI launches.
  
  Stock, attached browsers and independently constructed custom profiles are unchanged. Caller switches remain verbatim: a later `--enable-features` list replaces the preset list, so include `CDPScreenshotNewSurface` in it to retain the new path. Chromium also replaces repeated `--disable-features` lists. To opt out while preserving the preset's five existing disabled features, supply `--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication,CDPScreenshotNewSurface` as one combined list. Strider does not merge feature lists. Validated on Chromium 155.0.8059.79; other Chrome and Edge versions remain unverified.
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
