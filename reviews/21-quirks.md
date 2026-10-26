# Design review: the quirks

*2026-10-25. Review of commit `7c28926` (agents and the CLI built, after review 20) on QUIRKS.md: all 176 entries, of which one (Q46) is resolved. The maintainer started the list "so we can go back and reconsider them when we're done"; batch 5 finished the five batches, and the maintainer agreed to this walk as the first of four pieces of work: "Yeah we can go in order, sure". The other three follow it: getting ready to release, the declared pieces still unbuilt, and scenarios written in both Playwright and Strider. This commit records the review only.*

Each entry ends in one of five outcomes:

- **Fix.** Strider changes, and the entry is marked **Resolved** with the commit.
- **Change the API.** A fix that changes a public shape, made now because a first release would lock it in.
- **Report.** A browser, a protocol or Effect does something wrong. A draft report goes into `upstream/`, and nothing is sent until the maintainer says so.
- **Keep.** What Strider does now is the decision. The entry is marked **Kept**, with the reason.
- **Watch.** Deciding needs evidence this environment doesn't have yet: a browser roll, a check against Playwright's own client, or measurements from real sites. The entry stays open.

Most entries are kept: they record what a browser does and what Strider does about it, and the probes below change nothing about them. Twenty-six change Strider, eight become reports, and seven wait for evidence.

The fixes are built in four steps, each committed and pushed when its tests pass on every backend:

1. lifetimes and flakes, with Q69 and Q149 first, as agreed;
2. pages that render in the background;
3. network headers and bodies on Chromium;
4. the API before a release.

The drafts in `upstream/` are a fifth step.

## What the browsers do

Probed over raw CDP and WebDriver BiDi, on the pinned builds, with a local server (throwaway scripts, not kept).

| Probe | Chromium 155 | Firefox 158 |
|---|---|---|
| **P1.** A page in its own window, before and after its script opens a popup (requestAnimationFrame callbacks in 1.5 s, `visibilityState`, `hasFocus()`) | 92, visible, focused; after the popup: 0, hidden, unfocused. A tab behind a later tab: 0, hidden. The `concurrent` switches change neither. With `Emulation.setFocusEmulationEnabled({ enabled: true })` on the opener: 91, visible, focused | — |
| **P2.** The same in Firefox, with pages as tabs or as windows, and with `browser.link.open_newwindow: 2` (new windows instead of tabs) | — | Tabs: 2 after the popup, hidden; 0 behind a later tab. Windows: navigation and traversal work (review 16's probe saw navigation break), but the popup still opens as a tab over its opener: 2, hidden. With the preference, the popup opens as a window and the opener keeps rendering: 92 or 93, visible, unfocused, as tabs or windows. `layout.throttled_frame_rate: 60`: 8 |
| **P3.** A JSON response in Firefox, with the JSON viewer on (the default) and with `devtools.jsonview.enabled: false` | — | On: the document's only realm is `resource://devtools`, and the text a script reads, in an isolated world too, is the viewer's interface ("JSON / Raw Data / Headers / Save / Copy…"), not the JSON. Off: the realm is the page's origin and the text is the JSON as served, as in Chromium; going back and forward from it is an ordinary restore |
| **P4.** `input.showPicker()` from a click, with `unhandledPromptBehavior.file: "dismiss"` | — | Opens a chooser, reported by `input.fileDialogOpened` with the input; the page sees `cancel`; a second click opens another |
| **P5.** `Network.getResponseBody` for the document a page left, after it commits the next one | "No resource with given identifier found", same-site and cross-site. With `Network.configureDurableMessages` (buffer sizes given), the body comes back in both | — |
| **P6.** Which responses get `responseReceivedExtraInfo` | Every one whose `responseReceived` says `hasExtraInfo: true`: the document, fetches, an image, both hops of a redirect, a 404 favicon. It comes before `responseReceived` or after it, for an image and the favicon after `loadingFinished`. Cache hits say `hasExtraInfo: false` and get none. `Set-Cookie` is only in `ExtraInfo`. `requestWillBeSent` has no such flag | — |
| **P7.** A `Page.reload` sent as a navigation's `frameNavigated` arrives | Refused, "Not attached to an active page", in 9 of 30 rounds; sent again as the refusal's reply arrives (0.2 ms), accepted every time. No event marks the end: the refusal covers the moment of the swap | — |

Read from the code and the records, not probed:

- **Q12:** readiness already never goes backwards. When WebKit reports `load` first, the adapter reports `interactive` and then `complete`, and ignores the `DOMContentLoaded` after.
- **Q24:** the crash in probe 25 was the second client's own `Page.crash`, sent to show that the first client sees it: clients share pages, and nothing failed.
- **Q45:** the vendored WebDriver BiDi spec has no `userContexts` on `network.addIntercept`.
- **Q60:** one `NotBuilt` remains, `Trace.record`'s `domSnapshots`, which is declared and documented. The erased stubs the entry describes are gone.

## Fixes

### 1. Lifetimes and flakes

**Q69 and Q15: the JSON viewer.** `LaunchProfile.automation` turns Firefox's JSON viewer off (`devtools.jsonview.enabled: false`). With it on, a JSON page's document is a devtools page, and a test reading its text reads the viewer's buttons (P3). With it off, the document is the JSON as served, as on Chromium and WebKit, and a traversal from it is a restore like any other. `stock` keeps the viewer, and so does an attached Firefox, so the adapter's handling of it stays.

Q69 was only ever seen leaving the viewer. With the viewer off, the history test runs repeatedly under synthetic load: each backend's history test, many at once, alongside a busy loop. If Q69 survives as a restore problem, the trace says where, and that is fixed. If it doesn't reproduce, the entry is resolved by the profile and the stress run is recorded.

**Q149: a close Chromium didn't report.** The same harness runs Chromium's `closePage` test. If a `Target.targetDestroyed` or `detachedFromTarget` is lost, or comes for a target the adapter stopped tracking, the trace shows which, and the adapter takes the other as evidence too. If it doesn't reproduce, the entry stays open, watched, with the stress run recorded.

**Q135 and Q119: a page released by its scope.** The page's finalizer waits for the close, under `Deadline.DefaultBudget`, so a page created right after its scope closes can't meet Firefox's refusal (Q119). The storage state's own wait (Q119's fix) becomes the general rule.

**Q6: Chromium's refusals during a swap.** A command refused with "Not attached to an active page" is sent again at once, at most three times, without the 50 ms spacing (P7). No fixed delay is left.

**Q152: a chooser answered with made files.** The handler is counted before its files are set, so the page's `change` can't come first.

**Q88: an intercepted drag.** A drag Chromium intercepted that the release didn't end is cleared at the release, so the next gesture doesn't think a drag is in progress.

**Q84: a failed release.** Instead of refusing every later gesture, the next gesture first releases every key and button the page could hold. If that succeeds, the input state is known again and the gesture runs; if it fails, the gesture fails as it does now (CONCEPTS.md §5, Compensation).

**Q39: a redirect hop's body.** The adapters' hop tables know redirect hops, so asking for one's body answers `BodyUnavailable{redirect}` from the adapter, not `Foreign`.

**Q40: an event stream's body.** A response whose content type is `text/event-stream` is `BodyUnavailable{streaming}` as soon as its body is asked for, instead of after the deadline.

**Q114: Firefox's clip beyond the root element.** A clip inside the viewport is captured with BiDi's `viewport` origin, offset by the scroll position, so a clip over the viewport's empty part of a short page works.

### 2. Pages that render in the background

**Q71: Firefox.** Pages the library creates on Firefox open as windows (`browsingContext.create({ type: "window" })`), as Chromium's have since Q70. `automation` adds `browser.link.open_newwindow: 2`, so a popup, or a link that opens a new page, opens as a window. Every page then keeps rendering whichever page was created or opened last (P2), and an action on a page behind another works without `activate`. The preference is in the profile's value, where a program can read it.

**Q19: Chromium.** No switch keeps an opener rendering once its popup opens as a tab over it (P1), and Chromium has no preference to open popups as windows. `newContext({ focus: "emulated" })`, already in the API, does keep it rendering (P1). The `NoRenderingOpportunity` hint names both remedies: `page.activate` for one page, and `focus: "emulated"` for contexts where many pages act at once. The default stays `focus: "system"` (Considered and not adopted, below).

**Q167: the toolkit and the CLI.** The CLI's daemon creates its session's context with `focus: "emulated"` on Chromium and WebKit, and its spec line says so. Firefox needs nothing after Q71's change. The toolkit is given its context, so it keeps activating the page before each action, which now matters only on a Chromium context without focus emulation.

### 3. Network headers and bodies on Chromium

**Q158: cookies in Chromium's response headers.** The CDP adapter holds a response whose `responseReceived` says `hasExtraInfo: true` until its `ExtraInfo` arrives, then reports it with the network's headers, and the hop's end after it (P6). A response that will get no `ExtraInfo` says so, so the hold is never a guess. A request that fails, or a target that goes, releases what was held. `NetworkResponse.headers` then carries `Set-Cookie` on every backend.

Requests keep the headers their main event gives: `requestWillBeSent` has no flag saying an `ExtraInfo` will follow. Recordings keep using the hop's sent headers, as now.

**Q160: a document's body after the page moves on.** The CDP adapter configures durable messages for each page it attaches (`Network.configureDurableMessages`), bounded as `Network.enable`'s buffers are. A recording can then read the body of a document the page has left (P5).

### 4. The API before a release

**Q143 and Q131: `TargetGone` and `Timeout` everywhere they can happen.** Target.ts says every operation on a page, frame, document, realm, context or browser can fail with `TargetGone`, but six signatures don't declare it:

- `route`
- `addInitScript`
- `emulate`
- `newPage`
- the cookie jar
- storage state

Origin storage doesn't declare `Timeout` either. Those signatures gain them. A released grant then fails each of them with `TargetGone{AccessReleased}`, like every other member, instead of `NotPermitted`. The clock keeps `NotInstalled` for a clock never installed, and a clock that went with its grant is `TargetGone` too. A context that ended is `TargetGone`, not a cookie jar's `BackendFailure`.

**Q126: a capture's locator.** `PageError` gains Locator's `NoMatch` and `StrictViolation`, so an element screenshot of no element, or of several, says so instead of `InvalidInput{area}`.

**Q62: a wait on a value that's final.** `Watchable.waitFor` gains `Watchable.Ended`, which carries the final value. A watchable that has emitted its terminal value fails a wait the value can't satisfy with `Ended`, at once. A download's `status.waitFor` no longer fails with a `Timeout` that isn't one. Watchables of targets keep `TargetGone`, since their end is their target's.

**Q63 and Q105: the policy an automatic decision names.** `AutoResolution.policy` becomes a union:

- `Option{ name, value }` for a context option that exists, such as `dialogs: "dismiss"`;
- `Default{ decision }` for the library's one fixed rule, such as a file chooser canceled or a request continued when nothing decides.

No setting that doesn't exist is named.

**Q64: a body that isn't JSON.** `ResponseError` gains `MalformedBody{ expected: "json", message }`, which `CapturedResponse.json` fails with instead of `BackendFailure`.

**Q85: `Condition` is `Pipeable`**, like the handles, so `condition.pipe(Condition.because("…"))` compiles.

**Q33: console text.** `ConsoleMessage.text` is formatted by the library from the call's arguments, following the Console Standard's formatter (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, `%c`), with one rendering of values that aren't primitives on every backend: `Object`, `Array(2)`, or an element's class name. The same call then reads the same in all three browsers. Levels stay the browser's (`console.count` is `debug` on WebKit).

**Q60** is resolved by the builds: the only `NotBuilt` left is `domSnapshots`, which is declared and documented.

### 5. Reports, drafted in `upstream/`

Each draft names the build, the steps, what happened and what was expected. It is not sent until the maintainer says so. Before sending, the tracker is searched for an existing report.

- **Firefox (Bugzilla, Remote Protocol):**
  - **Q92:** `network.continueRequest` with `url` aborts the request; with a new `body`, the old `Content-Length` is kept and the body arrives cut.
  - **Q111:** page coordinates over a cross-site iframe reach nothing in it, though the hit test is the iframe.
  - **Q137:** a session started over a WebSocket outlives the socket, so every later client is refused until the browser restarts. The draft quotes the spec's steps for a closed connection.
- **WebDriver BiDi (the spec's repository):**
  - **Q4 and Q5:** a back/forward-cache restore has no `navigationCommitted` or `load`, and `traverseHistory` can reply before the restored document's realm exists, so a client can only infer a restore. The draft asks for a restore event, after searching for an existing issue.
- **Chromium:**
  - **Q159:** a favicon request cut off by a navigation gets neither `loadingFinished` nor `loadingFailed`.
- **Playwright (its WebKit patches):**
  - **Q22:** `Playwright.navigate` with a frame id the page doesn't have, and `Dialog.handleJavaScriptDialog` with no dialog open, crash the browser instead of failing.
- **Effect:**
  - **Q55:** passing options (`maxPayload`) through to `ws` when `@effect/platform-node` makes a WebSocket, so a client can raise Node's 100 MiB limit.

Q69 joins Q4's draft if step 1 traces it to Firefox.

## Every entry

**Already resolved (1):** Q46, in `e7821c1`.

**Fix (18):** Q6, Q15, Q19, Q33, Q39, Q40, Q60, Q69, Q71, Q84, Q88, Q114, Q119, Q135, Q149, Q152, Q158, Q160. Q149 may end watched instead, if the stress run never reproduces it.

**Change the API (8):** Q62, Q63, Q64, Q85, Q105, Q126, Q131, Q143.

**Report (8):** Q4, Q5, Q22, Q55, Q92, Q111, Q137, Q159.

**Watch (7):**

- **Q2.** Whether `about:certerror` carries the `u` parameter too: this environment has no TLS fixture.
- **Q14.** Firefox's `reload` with `ignoreCache`: until Firefox supports it.
- **Q72.** WebKit's mouse modifiers: Playwright clicks with modifiers on its WebKit, so our adapter may be at fault. Checked against Playwright's own client, which the scenario work installs, before anything is reported.
- **Q82, Q103, Q106 and Q132.** Costs the library accepted: an evaluation per animation frame while expectations wait, Chromium's interceptor always installed, a `URLPattern` route pausing every request, handles released one at a time. They are measured on real sites, in the scenario work.

**Keep:** every other entry, with its current *We* line as the decision. Where the probes or this review answered an entry's *Reconsider*, its **Kept** line says how:

- **Navigation and documents:**
  - Q1, Q3, Q7, Q8, Q9, Q10, Q11, Q13.
  - Q12: readiness already never goes backwards.
- **Dialogs, popups and input:**
  - Q16, Q17, Q18, Q20, Q21, Q23, Q73, Q74, Q77, Q78, Q79, Q150.
  - Q24: probe 25's crash was the second client's own `Page.crash`.
  - Q70: P1 found what makes background tabs render, and step 2 uses it.
  - Q75: the spec has no command to insert text.
  - Q76: Firefox starts drags it never drops; Strider refuses up front.
- **Downloads and choosers:**
  - Q25, Q26, Q27, Q28, Q29, Q30, Q32.
  - Q31: Firefox opens a chooser for `showPicker()` (P4); only WebKit doesn't.
- **Console and workers:**
  - Q34, Q35, Q36, Q37, Q38, Q121.
- **Network:**
  - Q41, Q42, Q43, Q44, Q89, Q90, Q91, Q94, Q95, Q96, Q97, Q98, Q161, Q166.
  - Q45: the spec has no per-context intercept yet.
  - Q93: a response-phase decision that changes headers only is among the declared pieces still unbuilt.
- **Emulation:**
  - Q47, Q48, Q49, Q50, Q51, Q52, Q99, Q100, Q101.
- **Frames, captures and storage:**
  - Q110, Q112, Q113, Q115, Q116, Q117, Q118.
- **Attaching:**
  - Q136, Q138, Q139, Q140.
- **Protocols:**
  - Q53, Q54, Q56, Q57, Q102, Q120, Q151.
- **Ours:**
  - Q58, Q59, Q61, Q65, Q66, Q67, Q68, Q80, Q81, Q83, Q87, Q104, Q107, Q108, Q109, Q122, Q123, Q124, Q125, Q127, Q128, Q129, Q130, Q133, Q134, Q141, Q142, Q145, Q146, Q147, Q148, Q153, Q154, Q155, Q156, Q157, Q162, Q163, Q165, Q168, Q170, Q171, Q172, Q174, Q175, Q176.
  - Q144: the refusing context's message names `page.context.control`.
  - Q167: the toolkit's activation now matters only on Chromium without focus emulation.
  - Q86, Q164, Q169, Q173: declared pieces still unbuilt, built when a use needs them.

**QUIRKS.md's markers.** Entries are still never removed. Besides **Resolved** with its commit, an entry can be marked:

- **Kept** with the review that kept it and the reason;
- **Reported** with its draft in `upstream/`, and the report's link once one is sent.

An entry with no marker is open. Step 1 marks the kept entries, each fix step its resolved ones, and step 5 the reported ones.

## Considered and not adopted

- **Focus emulated by default, as Playwright does.** Every page would report focus and visibility it doesn't have, which a page that pauses while hidden, or a test of focus handling, would observe. It is one context option away, and the hint names it.
- **Activating a page before each action, library-wide.** It changes which page is in front without the caller asking. The toolkit does it because its tools have no `activate`, and says so in their descriptions.
- **Holding request events until `requestWillBeSentExtraInfo`.** Nothing says whether one will come (P6), so the hold would be a guess.
- **Turning the JSON viewer off in `stock`.** `stock` is the browser's own defaults.
- **Failing closed when a backend can't apply an abort's reason (Q104).** That would apply a decision nobody made. The handler's failure says which reasons the backend has, and `Route.abort()` with none works everywhere.
- **A delay before the stress runs' assertions, to make Q69 and Q149 pass.** It would hide them, not explain them.

## Decision

Adopted, 2026-10-25, under the maintainer's direction to walk the list first. The fixes follow this commit in four steps, and the drafts in a fifth. Each records where the build differs.
