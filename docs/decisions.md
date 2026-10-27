# Decisions and their reasons

The layer documents (README.md, API.md, CONCEPTS.md, PROTOCOL.md, CLI.md) state the design's contracts. This file
keeps what they leave out: why a decision went the way it did, the alternatives rejected and why, and the evidence
it rests on, so that a settled question stays settled unless the evidence changes. Each entry names the review that
decided it; [reviews.md](reviews.md) says what each review was, and where its text is.

## Scope and principles

**The design is checked as compiled code, not argued in prose** (review 4). By draft 4, CONCEPTS.md had grown from
about 9,000 words (draft 1) to 19,500, with twelve acceptance scenarios and no code. Each review made the contracts
more honest and added hedges, and the cost fell on the reader of the API, the person ergonomics is for. Review 4 made
draft 4 the L1 baseline and turned the scenarios into TypeScript, checked against stub interfaces, before the prose
changed again, since a compiler checks what prose can't:

- whether an ordinary verb's error channel stays small;
- whether a caller's `E` and `R` survive the combinators;
- whether ordinary call sites stay free of `Scope` and platform services;
- whether attached code has to say "control" where it's obvious.

A scenario that needs protocol knowledge or repeated ceremony is a defect in L1, and rationale and prior art moved
out of the contracts. Revision 5 (`cc1f717`) condensed CONCEPTS.md from 19.5k to 4.4k words; the type-checked sketch
became `packages/browser`.

**L2 is built a feature at a time** (reviews 12 and 13). After the protocol layer, the maintainer agreed to build L2
one feature at a time, each a slice through L1 and L2 run on every backend through the public API, and each shared
L1 mechanism built once, in full, the first time a feature needs it. Review 12's slice was the README's program.
Review 13 built the subscription mechanism against `Popup` and `Dialog` because they use it differently: a popup
reveals a resource someone owns, and a dialog must be decided. Both ran on the mechanism unchanged, so the other
event modules mostly mapped facts onto it (review 14).

**Each feature shared with Playwright is there for a principle of ours** (review 5). Each was checked against "would
our principles produce this if Playwright didn't exist?":

- lazy locators, resolved again on every attempt: correctness under change (principles 2 and 3); a held element goes
  stale, a query doesn't;
- strictness, an action needing exactly one match: rule 23; ambiguity fails at once instead of picking one;
- actionability waiting: rule 23 applied; the checks are named, adjustable per call and reported in errors;
- retrying expectations (`Expect.to*`): waiting is asked for in code, and retries have a name (principle 18);
- contexts and storage state: isolation per user context is a spec concept (principle 1), and export is deliberate
  (principle 11);
- `route` and its decisions: an obligation gets exactly one decision (principle 6);
- init scripts: declarations with stated timing (principle 9);
- snapshot text with refs: agents already read the format, and ours is one rendering of a structured, evidence-tagged
  tree;
- downloads deleted with their context: seeing an event acquires nothing, and the context owns its directory;
- `Browser.newPage`: a convenience at the dominant call site, documented as its expansion (principle 22);
- launch flags: a visible `LaunchProfile` value (rule 23), where Playwright adds them silently.

**Strider drives stock browsers only, and needs nothing of Playwright's** (review 23). The maintainer's words: "I
don't want to use the playwright builds at all, I want my own versions of everything, ideally using stock as much as
possible. playwright builds are immediately detected by bot protection", and, asked whether that changed direction:
"How does that not align with my goal of no dependencies from the start?" It doesn't. Strider loaded none of
Playwright's code, but its WebKit backend depended on a browser Microsoft patches, builds and ships: its protocol
changed whenever they rolled it, users could get it only through Playwright's installer, and its patches are a
fingerprint. That contradicts "no dependency but Effect" as much as a package would. Rejected: keeping Playwright's
build as an option, and a patched WebKit of our own, a browser to maintain and a fingerprint of its own. The
comparison with Playwright runs on stock Chrome only, which Playwright drives; it drives Firefox and WebKit only
through its own builds.

## Browsers: launching, connecting and the test machine

**The library installs no browser, not even on request** (review 10). The maintainer decided the library shouldn't
install anything for the user, because that fails explicit over implicit (rule 23): "I don't think I want the
library to automatically install anything for the user." Chrome for Testing, which the library was to download as
the launch default, went with the default itself, and so did the browser-download command API.md had kept "if
needed". An explicit install command, `strider install chromium` as `npx playwright install` is, was rejected too:
the tools that already install browsers remain, an operating system's packages, a vendor's installer, Nix.

**A launch never picks a browser nobody named** (reviews 10 and 11). Rejected:

- defaulting to the installed stable channel, which picks a browser nobody named, at whatever version the machine
  has (review 10);
- searching `PATH`, which the integration tests had stopped doing in `2377f06` (review 10);
- resolving a bare command name on `PATH` at launch: the same options would launch different programs from a
  terminal, an editor's test runner and CI, whose `PATH`s differ (review 11).

**Channels went from every backend, not only on Linux** (review 11). Told that a channel is a fixed list of install
paths, the maintainer said: "I think that will fall apart on various flavors of linux, like NixOS", then: "requiring
executable path is also fine, and we just give users a way to easily look up the path if they don't want to ask an
agent".

- Refusing channels on Linux only, the maintainer's first thought, was rejected: the same options would compile
  everywhere and fail on one system. Firefox's channels can't be told apart on macOS and Windows either: `beta`
  searched `stable`'s paths (`/usr/bin/firefox`, `Firefox.app`, `Mozilla Firefox\`), as Playwright 1.61's table
  does.
- Keeping channels with corrected tables was rejected: NixOS, Snap, Flatpak, Guix and the open-source Chromium stay
  out of any table's reach.

**Finding a browser is a command for a person, not a library function** (review 11). A function that finds browsers
was rejected: a program would call it at launch, which is the search review 10 removed. `strider browsers` is run
once, by a person or an agent, to copy a path from. On NixOS it lists the profile's link
(`/etc/profiles/per-user/<user>/bin/chromium`), not the `/nix/store/…` path it resolves to, because the link
survives updates and the store path doesn't. It reports what it finds and doesn't claim it works: a Snap or Flatpak
browser's sandbox may refuse a profile in the temporary directory, or the debugging pipe, which hasn't been checked.

**A launch accepts any Chromium or Firefox version** (review 11). Refusing a version other than the one tested was
rejected: their protocols change slowly and compatibly, and `Browser.Info` says what connected, filled from the
browser (CDP's `Browser.getVersion`, BiDi's `session.new`). Only Playwright's patched WebKit build was refused at
another build, its adapter being generated from that build's `protocol.json`, and review 23 removed it. The
integration tests still pin their browsers (PROTOCOL.md, Tests and pinned browsers).

**How stock WebKit is reached, and where** (review 23). Strider speaks Automation over the inspector server's socket
with a client of its own. Besides the routes QUIRKS.md's Q204 and Q208 rule out, two were rejected:
`WebKitWebDriver`'s classic WebDriver as a go-between, one more process with no events and nothing the socket can't
do; and starting Xvfb inside the library, which would run a display server the program didn't ask for. A program
that wants no visible window provides a display, as the integration tests do (Q202). Stock WebKit with an automation
mode reachable this way is WebKitGTK and WPE, on Linux. On macOS WebKit is Safari, reached through `safaridriver`
(classic WebDriver, not built) or Safari Technology Preview's experimental WebDriver BiDi (`Bidi.layerConnect`);
Windows has no stock WebKit browser.

**Downloads and `FileInput.local` paths stay `Unsupported` on a browser that shares no file system with the program**
(review 22). No protocol carries a download's bytes, so there is nothing to build. A remote browser gets files
through `FileInput.bytes`, which is made in the page (review 20).

## The protocol layer (L0)

**How the CDP adapter decides a navigation's outcome** (review 8). A navigation is correlated by the loader id in
`Page.frameStartedNavigating` or `Page.navigate`'s reply, a same-document one by frame and order; outcomes come only
from evidence (`src/internal/cdpAdapter.ts`):

| Evidence | Outcome |
|---|---|
| `frameNavigated` with the navigation's loader id | `Committed`, with the document request's response hop when one was seen |
| `frameNavigated{type: BackForwardCacheRestore}` under the restored document's old loader id | `Restored` (PROTOCOL.md, History and restores) |
| `navigatedWithinDocument` | `SameDocument{via}` |
| `Page.navigate` replied `isDownload: true`, or `Browser.downloadWillBegin` for the frame and the navigation's URL while it is in flight | `Download` |
| the document response was 204 or 205 and its request failed | `NoContent` |
| a new cross-document `frameStartedNavigating` on the same frame (the old one's request fails `ERR_ABORTED` just before, probe 4) | `Superseded{by}` |
| the document request failed with anything but `ERR_ABORTED`, or a routed request aborted | `Failed{errorDocument: None}`; an error page (`chrome-error://chromewebdata/`) that then commits under its loader id is that navigation's document (`createdBy: ErrorPage`), never a navigation of its own (review 12), and one that commits first makes it `Failed{errorDocument: Some}` |
| `ERR_ABORTED` and nothing else | pending until a download, a new navigation or an error page says what it was; at L1 it times out with `Timeout{postcondition}` |

**A target's initialization gate never waits on another target** (review 8). A paused popup blocks its opener: with
browser-wide pause-on-start, `window.open` from a same-origin page didn't return until the popup was resumed, and the
opener's `Runtime.evaluate` got no reply for 30 seconds, failing with `NoReply`. Waiting on an opener, or any other
target, deadlocks until a timeout. Targets Strider doesn't control that attach paused are resumed at once.

**`PageAdded` comes before `PageReady`** (review 8). Publishing a page only once its gate finished, holding its facts
until then, was rejected: L1 needs the page's id while the gate runs, for declarations scoped to the page and for its
opener's `Popup` event.

**Popups can't be paused per opener on CDP** (review 8, probe 22). Discovering targets with
`Target.setDiscoverTargets` and attaching on `targetCreated` was rejected: by then the popup is running, and only
auto-attach pauses a target before its scripts. So popups are paused only browser-wide, and only in a launched
browser.

**Firefox's unhandled rejections are exceptions of an unknown kind** (review 14, P10). Firefox reports an unhandled
rejection exactly as it reports a throw, with no `Uncaught (in promise)` marker and no stack (QUIRKS.md, Q36), so
its exceptions are `kind: "unknown"` and `exceptions.kind` is `partial` on BiDi. Guessing that an exception without
a stack is a rejection was rejected: a throw can lack a stack too, so the guess would call some throws rejections.

**Chromium's "Not attached to an active page" refusals are sent again at once, and nothing waits for the swap's end**
(review 21, P7; QUIRKS.md, Q6). Over raw CDP on Chromium 155, `Page.reload` sent as a navigation's `frameNavigated`
arrived was refused in 9 of 30 rounds; sent again as the refusal arrived, 0.2 ms later, it was accepted every time.
No event marks the end of the swap, so there is nothing to wait for instead, and the refusal covers only the swap's
moment: the earlier cadence, 50 ms for up to a second, was a delay with nothing to wait out.

**What stock WebKitGTK 2.54.1 does in automation mode, beyond QUIRKS.md** (review 23, probed with the MiniBrowser
under Xvfb):

- A page sees `navigator.webdriver` as `true` in automation mode, as WebDriver requires; attached without it
  (`WebKit.layerAttach`), it isn't set.
- The user agent is WebKitGTK's own: `… AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15` on
  X11.
- The viewport is the window less a 38-pixel toolbar, at a device pixel ratio of 1.
- On the inspector, `Page.setEmulatedMedia`, `Page.overrideUserPreference` (after which `prefers-color-scheme: dark`
  matches) and `Page.overrideSetting(ScriptEnabled)` work; Q209 records what doesn't.
- `window.open` from a page's script returns `null`: the popup is blocked. With `forceUserGesture` on Automation's
  evaluation it opens as a new browsing context and a new `WebPage` target. Nothing announces a new browsing context;
  the server pushes the target list when it changes.
- File choosers can be answered: `setFilesToSelectForFileUpload`, then a click on a file input, gives
  `fileChooserDismissed` naming the files, and the input has them. The build sets a file input's files with
  `setFilesForInputFileUpload` instead and reports `fileChooser` as `unsupported`, so this is the route if file
  choosers are reconsidered.

## The browser model (L1)

**Init scripts are ordered, not overridden** (review 3). The precedence that orders settings and handlers (scope,
then priority, then recency) doesn't order scripts. Draft 3 put scripts on it, a higher-precedence script running
last to override earlier ones; review 3 rejected that, because a later script only wins a last-write-wins
assignment: it can't undo an earlier script's event listeners, requests, captured references, non-configurable
properties or clock. Scripts are an explicitly ordered bundle per world and document. Removing one affects future
documents only, recomputing the bundle never reruns a script that ran, and nothing that ran is rolled back.

**Backend failures are typed reasons, not defects** (review 3). Draft 3 made unclassified protocol failures defects,
to keep each verb's error channel near three tags; review 3 reversed it. A reply outside the supported schema is an
external compatibility failure, not a broken invariant of the caller's program, and a long-running service must be
able to catch, report and isolate it without losing its other jobs, and without `catchCause`. Fewer tags don't
change which of Effect's two error categories a condition is in; the channel stays small because the failure is a
reason, `BackendFailure{Rejected | IncompatibleResponse}`, inside the module's error. The same review limited what
dispatch evidence claims: `Acknowledged` covers both success and a definite rejection; a gesture of several commands
can succeed at mouse-down and be rejected at mouse-up, so progress is recorded per step; and even a fully
acknowledged gesture doesn't show the application acted on it. Evidence supports recovery; it never proves the
business action happened.

**`servedBy` is the response's, from its own evidence** (review 9). Keeping it on the request, with a fact updating
it when the response arrives, was rejected: every request snapshot would be provisional until then, and the field
would mean nothing on a request that fails. Firefox 158's `fromCache` is true for a cache hit and for a response a
service worker made or fetched, so it reads `cacheOrServiceWorker`; asking the page
(`navigator.serviceWorker.controller`) to tell them apart was rejected, because the question races the response and
runs in the page. How a worker produced its response isn't exposed: CDP's `serviceWorkerResponseSource` gives it
(`fallback-code` for `new Response(…)`, `network` for one fetched), but only CDP does, so it can come later as an
`Option`.

**The query engine is ours, with no library in the page** (review 12). Playwright's injected script is evidence for
the engine's role table, not a template. Testing Library's `dom-accessibility-api` was rejected for roles and names:
a dependency in the page would need a bundler. The engine is one self-contained function in our source, whose text
crosses into the page.

**The page clock isn't Chromium's virtual time** (review 17). `Emulation.setVirtualTimePolicy` exists only on
Chromium, and it stops rendering, which actionability's frame-based checks depend on. The clock is a main-world shim
on every backend, and the engine's isolated world keeps the real timers and frames on all three (P16). CONCEPTS.md
§7 lists a `virtual` mode, which `PageClock.Mode` doesn't have.

**A storage state is restored through routed pages of the new context, not init scripts** (review 18, P5 and P8).
Seeding each origin's storage with an init script on its first document was rejected: the script carries the state
into the page, where its own scripts could see it, and writes nothing until a page of that origin loads. A routed
page writes every origin before the context is returned. Two probes on Chromium 155, Firefox 158 and Playwright's
WebKit 2359 support it: a cookie set for another site before any page of that site exists is sent by its first page,
so cookies are set directly and first; and another origin's `localStorage`, written from a temporary page whose
document a route fulfills, is there when a real page of that origin reads it.

**Every frame is resolved by its own document's engine, same-origin frames too** (review 18, P3). Letting the parent
document's engine reach into a same-origin iframe was rejected: it works only for same-origin frames, and a
cross-site frame needs the per-document route anyway, so one path for both keeps locating independent of what a
page's script can reach. The adapter names an iframe's frame from the element (`contentFrame`); a `contentWindow`
returned by handle carries no frame id on any backend. CDP's `DOM.describeNode` (`frameId`), WebKit's
`contentFrameId`, and on BiDi a window proxy returned by value, whose `context` is the frame, do.

**Snapshots don't infer interactivity from click listeners** (review 18). CDP's `DOMDebugger.getEventListeners` costs
a command per element and exists only on CDP; BiDi has nothing like it. So `snapshot.clickListeners` is unsupported
on every backend. PROBES.md's probe 23, what listing listeners would cost on large pages, is still open.

**On launched stock WebKit, each context is a browser process** (review 23, P9). An Automation session has one
profile, an ephemeral one, so `Browser.newContext`, and `Browser.newPage`, which opens a page in a context of its
own, launch another browser with its own socket and profile; the first browser is the default context. Sharing one
browser between contexts was rejected: two `Browser.newPage()` calls would share cookies without saying so. On
WebKitGTK 2.54.1's MiniBrowser under Xvfb, a second browser's session is ready 0.6 s after launch, and each browser
is about 0.8 GB resident across its five processes, shared pages counted in each. The maintainer accepted the cost
("sure") and asked for the resident size measured without shared pages counted twice, which hasn't been done yet.

**A partition's top-level origin is an optional key beside its site, and the partition key doesn't change**
(review 24). Rejected: one origin entry per top-level origin on every backend, which on Chromium and Firefox, keyed
by site, would export and restore the same partition twice; the port in `topLevelSite`, since a site has no port, by
its definition and Chromium's; and leaving Q232's limitation, under which a restore at another port reports success
and writes where no page will look. `CookieJar.PartitionKey` stays as it is: a cookie's partition is the top-level
site on every backend that reports one (Chromium). An origin is still read once per top-level site; where two
top-level origins of a site show it, the first page's is recorded, and on stock WebKit the other's partition isn't
read.

## The public API (L2)

**`toMatchAria` takes a typed `AriaPattern`, not Playwright's YAML template** (review 5, decided in revision 5.21).
The template is a string DSL with its own partial-matching and regex rules, which Strider would have to specify and
parse. Snapshots are structured, evidence-tagged data, so a pattern built from functions matches that model, is
type-checked and states how children match every time (`exactly`, `including`, `unchecked`). For the template: the
text form is readable, and agents already write it. Parsing the text into the typed pattern wasn't taken.

**The page clock isn't Playwright's clock surface** (review 5). Playwright's overlaps itself: `setFixedTime` repeats
`install({ mode: "fixed" })`, and `pauseAt` repeats controlled mode with `at` (principle 22). `runFor` and
`fastForward` became `TestClock`'s `adjust` and `setTime`, and the modes stay data in `install(mode)`. The replay log
exists because page time must survive navigation.

**A dialog's decisions belong to the handler's argument** (review 13). Module-level decisions, as `Route.continue`
is, were rejected for dialogs: a handler could return a decision its dialog doesn't offer, such as dismissing an
alert. A handler gets `Dialog.Pending`, whose shapes carry only the decisions valid for them; events carry the
`Dialog` data alone.

**A route's decisions are values typed by phase** (review 17). They are module-level constructors, `Decision<in P>`,
not members of a pending object as `Dialog.Pending` and `FileChooser.Pending` are: contravariance gives the same
guarantee, a decision the phase doesn't allow being a type error, and keeps `Route.continue`, `Route.fulfill` and
the rest plain values a handler returns. A decision valid at more phases is accepted where fewer are asked for.

**`Intercepted.fetch` and `fetchWith` were removed, not built** (review 17). Built through the response phase inside
one handler, they would have paused every matching response on BiDi and WebKit in case a handler asked, and only CDP
can read a paused response's body (QUIRKS.md, Q94). A response-phase route (`{ phase: "response" }`) says the same
explicitly. Sending the request from the program, as Playwright's `route.fetch` does, is API.md's "No second HTTP
client".

**`PageNavigation.next` settles as `goto` would** (review 14). A navigation that ends somewhere latches its
`PageNavigation`; one that fails fails the wait with the `PageError` `goto` gives (`NavigationFailed`,
`NavigationCanceled`, `NavigationSuperseded`…), matched by the URL it was going to, so recovery reads the same
whether the navigation came from `goto` or was awaited. `stream` and `history` report only navigations that
succeeded: a failure is an error, not a `PageNavigation`.

**`fill` and `clear` select from the utility world, not with Control + A** (review 16). The shortcut is Meta + A on
macOS, and a page can rebind it; selecting from the utility world is the same everywhere. Control + A then inserted
text did replace the value on all three browsers on Linux (P2), so the choice is about portability.

**HAR timings come from the library's clock** (review 20, P2). Each backend times a response on its own base:
Chromium as millisecond offsets (`sendStart`, `receiveHeadersEnd`) from `requestTime`, itself seconds since an
arbitrary origin; Firefox as absolute milliseconds (`requestStart`, `responseStart`, `responseEnd`), with DNS and
connect where they happened; WebKit relative to the resource's `startTime`, with sizes in `loadingFinished.metrics`.
Recording each backend's own was rejected, since one HAR would mean three things: `send` is 0, `wait` and `receive`
are measured on the library's monotonic clock, and `blocked`, `dns`, `connect` and `ssl` are -1 (QUIRKS.md, Q163).

**Contexts don't emulate focus by default, and the library doesn't activate a page before acting** (review 21, P1
and P2).

- `UserContext.Options.focus` defaults to `"system"`. Emulating focus by default, as Playwright does, was rejected:
  every page would report focus and visibility it doesn't have, which a page that pauses while hidden, or a test of
  focus handling, would observe. Emulation is one option away, and the `NoRenderingOpportunity` hint names it beside
  `page.activate`.
- Activating a page before each action, library-wide, was rejected: it changes which page is in front without the
  caller asking. The toolkit activates before acting only because its tools have no `activate`, which its tool
  descriptions say (QUIRKS.md, Q167); the CLI's sessions emulate focus on Chromium and WebKit.
- The evidence, `requestAnimationFrame` callbacks in 1.5 s over raw CDP and WebDriver BiDi on Chromium 155 and
  Firefox 158:

  | Browser | Situation | Callbacks and state |
  |---|---|---|
  | Chromium | page in its own window | 92, visible, focused |
  | Chromium | opener, after its script opened a popup | 0, hidden, unfocused |
  | Chromium | tab behind a later tab | 0, hidden |
  | Chromium | opener, with `Emulation.setFocusEmulationEnabled({ enabled: true })` | 91, visible, focused |
  | Firefox | opener, popup opened as a tab | 2, hidden |
  | Firefox | tab behind a later tab | 0 |
  | Firefox | pages created as windows; the popup still opened as a tab over its opener | 2, hidden |
  | Firefox | with `browser.link.open_newwindow: 2`; the popup opened as a window | 92 or 93, visible, unfocused |
  | Firefox | with `layout.throttled_frame_rate: 60` | 8 |

- On Chromium the `concurrent` profile's switches changed neither the popup nor the background tab, and nothing opens
  popups as windows; on Firefox `browser.link.open_newwindow: 2` does, so `LaunchProfile.automation` sets it and
  Firefox needs no focus emulation (QUIRKS.md, Q19, Q70, Q71).

**A trace's DOM capture is ours, never Playwright's** (review 22, P1). The maintainer: "I want everything to be
effect native otherwise", with no dependency but `effect`. Playwright's snapshotter is read only to learn what the
viewer expects, never copied, vendored or shipped. Rejected:

- vendoring Playwright's capture script: a dependency, and it needs the page's main world, where it hooks CSSOM
  methods such as `insertRule` to learn which sheets changed;
- hooking CSSOM methods ourselves: the hooks would be in the page's world, where the page can see and break them.
  Reading every sheet's `cssRules` on each capture, an unchanged sheet as a back-reference, needs none;
- a trace viewer of our own: the format is the viewer's, trace.playwright.dev runs anywhere, and a viewer would be a
  second product.

On Chromium 155, Firefox 158 and Playwright's WebKit 2359, a script in Strider's isolated world read everything a
capture needs: each sheet's `cssRules`, rules added with `insertRule` to a `<style>` and to a linked sheet included;
constructed sheets adopted by the document and by a shadow root, and the shadow root's HTML; `value`, `checked`,
`selectedIndex` and `scrollTop`; `canvas.toDataURL()`; and a same-origin iframe's document. Firefox reads these
through Xrays; only `customElements` differed (Q191). Stock WebKit, which can make no world, runs the capture in the
page's world (Q194).

**Only Firefox records a video file** (review 22). Chromium and WebKit send frames, and turning frames into a video
file needs an encoder, which would be a dependency, so `Capability.Video` is `Unsupported` there and their traces
keep streamed or polled frames.

**The library never wraps a page's dialog functions to learn a dialog's kind** (review 23). Stock WebKit's Automation
reports that a dialog is open and its message, not its kind or a prompt's default value (Q206). Three ways to learn
them were weighed: symbolic breakpoints with the debugger attached, which Q207 measured; a wrapper in the bootstrap
script recording kind, message and default before calling the browser's own, exact but visible to the page, which
can tell `alert` isn't the browser's, as bot detection looks for; and `Dialog.Unknown`, honest and cheap, a case in
every exhaustive handler. The maintainer agreed to measure the breakpoints and otherwise use `Dialog.Unknown`:
"Never a wrapper in the page." The measurement chose `Dialog.Unknown` (Q207).

## The CLI and agents

**No settling window after a tool acts** (review 5). The first toolkit had `ActionReport.observed` (the navigations,
popups, downloads and DOM changes an action caused) and `dom: Changed | Unchanged | NotObserved`. Both went: to
attribute effects to an action, something must decide how long to keep watching after it, a settling window, which
rule 23 forbids (Playwright's MCP server waits 500 ms; Chrome DevTools MCP waits for a navigation, then for the DOM
to stay quiet), and `observed` would be a second answer to "what happened?" beside the digest (principle 22). The
digest's boundaries are calls, not time, and it claims no causation; whether the DOM changed is an explicit
`snapshot.diff`.

**Page-provided tools (WebMCP) are designed, and built once a browser ships the API** (review 22, P5). In the draft
API a page registers tools with `navigator.modelContext.registerTool`, and only the browser lists them. On
2026-10-26 no pinned browser shipped it: in Chromium 155, `navigator.modelContext` was absent under
`--enable-experimental-web-platform-features`, `--enable-features=WebMCPTesting` and `--enable-features=WebMCP`, and
CDP has no domain for it. The design: an init script in the page's main world wraps `registerTool` and
`unregisterTool` before the page's scripts run and keeps the tools on a symbol, as the page clock keeps its controls
(Q108); `Page.modelTools` is a watchable of their names, descriptions and input schemas; `BrowserToolkit` gains
`pageTools`, which lists them, and `callPageTool`, which calls one with the model's arguments checked against its
input schema, every result marked as the page's, untrusted input. It is `@stability experimental`, tested against a
fixture page implementing the draft API itself, as pages using a polyfill do. The maintainer, after asking what it
was, chose design only.

## Tooling, tests and release

**`Browser.layerTest` emulates no DOM** (review 22). A fake browser with a DOM would be a second engine to keep
honest, and real browsers are cheap to launch.
