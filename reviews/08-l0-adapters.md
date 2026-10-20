# Design review — finishing L0: the backend adapter and its boundary with L1

*2026-10-20. Review of commit `32b8919` (revision 5.25, with CDP code generation, both transports and the whole protocol client built) against what finishing L0 takes: the backend adapters for CDP, BiDi and WebKit, their launchers, and their code generation. Evidence: probes run that day against Chromium 155.0.8059.79 over the pipe, recording every message both ways, and the CDP 0.0.1696802 spec. This commit records the review only.*

PROTOCOL.md sketches the adapter as five methods (`initialize`, `apply`, `resolve`, `dispatchInput`, `evaluate`) plus a `ModelSink` that "feeds the L1 fold". Building it means deciding what that sink receives, which ids it carries, how a new target is configured before its scripts run, and what else L1 needs from a backend: nothing in the sketch navigates, closes a page, takes a screenshot or reads a cookie. L1 isn't built, so the boundary is drawn from CONCEPTS.md's models and API.md's surface, and the probes below decide the parts the specs leave open.

## Probe results (Chromium 155)

| Probe | Question | Answer |
|---|---|---|
| 22 | Can new targets be paused per context, per opener, or only browser-wide? | Frames and workers: per page, through `setAutoAttach` on the page's session (an out-of-process iframe attached with `waitingForDebugger: true`). Popups: **browser-wide only**. A popup opened with a user gesture is created (`targetCreated` with `openerId`), but neither `autoAttachRelated` on its opener nor `setAutoAttach` on the opener's session attaches it, and `TargetFilter` filters by type only, with no context |
| — | Does a paused popup block anything? | **Its opener.** With browser-wide pause-on-start, `window.open` from a same-origin page didn't return until the popup was resumed: the opener's `Runtime.evaluate` got no reply for 30 seconds (`NoReply`) |
| 1 | Realm before or after commit? | After: `executionContextsCleared`, lifecycle `init`, `frameNavigated`, then `executionContextCreated` |
| 2 | Does the first same-origin navigation from the initial `about:blank` keep the realm? | Yes. A popup opened with `window.open('/two')` commits its initial `about:blank`, then `/two`, with no new `executionContextCreated`: the same context, same `uniqueId`, now hosts the second document |
| 8 | Is a detach sent for the child frames of a document that navigated away? | No. Navigating the top frame from a page with two iframes sent no `frameDetached` for the remaining child; an iframe removed by script sent `frameDetached{reason: remove}` |
| 17 | Is `document.open()` visible? | Yes: `Page.documentOpened`, then lifecycle `init`, `DOMContentLoaded` and `load` again under the same loader id |
| 15 | Navigations that keep the old document | A 204 replies to `Page.navigate` with `errorText: net::ERR_ABORTED`, then `responseReceived` 204 and `loadingFailed` (canceled), and no commit. A download replies with `isDownload: true` and fires `Page.downloadWillBegin` for the frame |
| 4 (partly) | Superseded navigations | The pending navigation's request fails with `ERR_ABORTED` (canceled) immediately before the new navigation's `frameStartedNavigating` on the same frame; its `Page.navigate` replies `ERR_ABORTED` |
| — | Failed navigations | A refused connection (`ERR_UNSAFE_PORT`) fails the request, then commits `chrome-error://chromewebdata/` under the navigation's own loader id |
| — | Execution context ids | They restart after a process swap (`id: 1` again after the error page), within the same target session. `uniqueId` doesn't |
| — | Navigation ids | `Page.frameStartedNavigating` carries the loader id at the start, with `navigationType` (`differentDocument`, `historyDifferentDocument`, `reload`); same-document navigations have `navigatedWithinDocument{navigationType: fragment | historyApi}` and no loader id |
| — | Browser-wide auto-attach | Without a filter it attaches `browser_ui` targets (the omnibox popup, one per context) and component extensions' background pages |

## Candidates

### 1. The sink receives facts, in L1's ids

**Where:** PROTOCOL.md, Backend adapters (`model: ModelSink // feeds the L1 fold: created/ended/changed facts with evidence`).

**What changes.** The adapter's fold, running in the ingestion worker, turns protocol events into **facts**: protocol-neutral observations about the model, each carrying L1 ids and the evidence behind it. L1's fold applies facts to entities; it never sees a protocol event. The vocabulary follows CONCEPTS.md §2:

- **Contexts and navigables:** `UserContextAdded{isDefault}`, `UserContextRemoved`, `PageAdded{context, kind, origin: Created | Opened{opener} | Adopted{opener}}`, `PageReady`, `PageInitializationFailed{reason}`, `FrameAdded{parent}`, `NavigableRemoved{reason}`, `PageCrashed`.
- **Documents:** `DocumentCommitted{navigable, url, origin, createdBy, replaced}`, `DocumentUrlChanged{via: fragment | historyApi}`, `DocumentOpened` (a new generation), `DocumentReadiness{interactive | complete}`.
- **Realms:** `RealmAdded{Window{navigable, document, world} | Worker{kind, url}}`, `RealmDocumentAdded` (the initial-blank reuse), `RealmRemoved`.
- **Navigations:** `NavigationStarted{navigable, url, initiatedAs}`, `NavigationEnded{outcome}`, with CONCEPTS.md's outcomes and the evidence each needs (candidate 8).
- **Network:** `RequestSent`, `ResponseReceived`, `RequestFinished`, `RequestFailed`, per hop; `ConnectionOpened`, `ConnectionFrame`, `ConnectionClosed`.
- **Obligations:** `ObligationOpened{PausedRequest | Prompt | FileChooser}`, `ObligationEnded`, `PromptClosed`.
- **Everything else the API's event modules read:** `DownloadStarted`, `DownloadProgress`, `DownloadEnded`, `ConsoleMessage`, `UncaughtException`.

Facts carry the public data classes where they exist (`NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`), so L1 passes them through.

**Recommendation.** Adopt. The sink is a function the adapter calls from its fold, in order, so the L1 model is updated before the event is published (principle 4). Tests use a sink that records.

### 2. The adapter mints the ids, per connection

**Where:** CONCEPTS.md §1 ("Every public id is minted by L1. Backend ids are correlation evidence held in adapter tables").

**What changes.** The tables live in the adapter, so the adapter mints each id when it first correlates something, with a counter per kind and a short prefix (`N3` a navigable, `D7` a document, `R5` a realm, `U2` a user context, `V4` a navigation, `Q12` a request, `Q12.1` its second hop). Ids are opaque, unique within a connection, and never a protocol id. A command-started navigation gets its id before the command is sent (CONCEPTS.md §1), and the adapter correlates it with the loader id that `Page.navigate` returns.

**Recommendation.** Adopt. "Minted by L1" meant minted by the library, not by the browser; the adapter is where correlation happens.

### 3. The adapter interface is the whole backend contract

**Where:** PROTOCOL.md, Backend adapters.

**What changes.** Besides initialization, declarations, obligations, input and evaluation, L1 needs from every backend, in L1 ids:

- contexts and pages: create and remove a context; create, close (with or without `beforeunload`) and activate a page;
- navigation: navigate, reload, traverse history;
- realms: acquire the utility world for a document, evaluate, release handles;
- capture: screenshot (beyond the viewport, never by scrolling), PDF;
- storage and permissions: read, set and clear cookies; grant and reset permissions;
- network: read a response body;
- files: set an input's files;
- capabilities, with evidence.

Each fails with `ProtocolError`, or with an adapter error whose reasons are `Gone{target, reason}` (the id names something that ended), `Unsupported{capability}` and `Foreign` (an id this connection never minted).

**Recommendation.** Adopt. These are protocol mechanics, so they belong at L0; what to call when is L1's.

### 4. Initialization is a sync, by the same mechanism as a resync

**Where:** PROTOCOL.md, the initialization gate ("events buffered until the tree is known").

**What changes.** A new session's events are held until its first snapshot is in, exactly as after an integrity failure. The client already has the mechanism; it becomes the fold's control over a session: hold it, sync it with an effect that returns the snapshot and the receive sequence it accounts for, and release it. For CDP the gate is, while the target is paused: `Page.enable`, `Page.getFrameTree` (the snapshot), `Runtime.enable` (whose replayed contexts arrive after the snapshot), `Network.enable`, lifecycle events, `setAutoAttach` on the session for its frames and workers, then the declarations in force, then `Runtime.runIfWaitingForDebugger` in a finalizer. The gate never waits on another target: a paused popup blocks its opener, so waiting on the opener deadlocks until a timeout.

**Recommendation.** Adopt.

### 5. Pause-on-start scope follows ownership

**Where:** PROTOCOL.md, Pause-on-start granularity; probe 22.

**What changes.** On CDP, frames and workers are paused per page, and popups only browser-wide. A launched browser is ours entirely, so its adapter auto-attaches browser-wide (pages, service workers and shared workers; `browser_ui` and extension pages excluded by filter) and pauses every new page: `pauseScope` is `"browser"`. An attached browser auto-attaches per page only, so a user's tab is never paused: `pauseScope` is `"related"`, and a declaration that needs before-author-script timing on a popup fails with `Unsupported` unless browser-wide access was granted. Targets we don't control that attach paused are resumed at once.

**Recommendation.** Adopt, and record probe 22's answer for CDP.

### 6. Realms are keyed by `uniqueId`; a realm can gain a document

**Where:** CONCEPTS.md §2 (`documents: NonEmptyReadonlyArray<DocumentId>`); probes 1 and 2.

**What changes.** CDP context ids repeat after a process swap within one session, so the adapter keys realms by `uniqueId` and evaluates with `uniqueContextId`. When a navigation commits without `executionContextsCleared` and without a new context, the initial `about:blank` realm hosts the new document: the adapter emits `RealmDocumentAdded`.

**Recommendation.** Adopt.

### 7. The adapter ends orphaned frames

**Where:** CONCEPTS.md §4 ("the adapter closes orphans itself"); probe 8.

**What changes.** When a frame's document is replaced, every descendant navigable that wasn't re-announced ends with `FrameDetached`, emitted by the adapter, in order, before the new document's facts.

**Recommendation.** Adopt; probe 8 is answered for CDP.

### 8. Navigation outcomes from CDP's evidence

**Where:** CONCEPTS.md §4 (outcomes only with affirmative evidence).

**What changes.** A navigation is correlated by the loader id in `frameStartedNavigating` (or the `Page.navigate` reply), and same-document ones by frame and order. Outcomes:

| Evidence | Outcome |
|---|---|
| `frameNavigated` with the navigation's loader id | `Committed`, with the document request's response when one was seen; an error page (`chrome-error://`) is `Failed{errorDocument: Some}` |
| `navigatedWithinDocument` | `SameDocument{via}` |
| `Page.navigate` replied `isDownload: true`, or `downloadWillBegin` for the frame during the navigation | `Download` |
| the document response was 204 or 205 and its request failed | `NoContent` |
| the request failed `ERR_ABORTED` and a new navigation started on the frame next | `Superseded{by}` |
| a request failure with no commit | `Failed{errorDocument: None}`, until an error page commits |

Anything else stays pending and, at L1, times out with `Timeout{postcondition}`.

**Recommendation.** Adopt.

### 9. A base set of domains, and the rest on demand

**Where:** principle 8; PROTOCOL.md, Domain enablement.

**What changes.** A target's model needs `Page`, `Network` and, under the tracked realm strategy, `Runtime`; the gate enables those. Everything else (`Fetch`, `DOM`, `Log`, `Accessibility`, `Performance`) goes through an `RcMap` keyed by session and domain, so the last scope to release a domain disables it. Under the on-demand realm strategy `Runtime` is never enabled, and realms are acquired with `Page.createIsolatedWorld`.

**Recommendation.** Adopt.

### 10. Evaluation results use WebDriver BiDi's serialization

**Where:** PROTOCOL.md, `evaluate(realm, call): Effect<RemoteResult>`.

**What changes.** A remote value needs one protocol-neutral shape. BiDi's `script.RemoteValue` is specified, CDP produces the same shape with `serializationOptions: { serialization: "deep" }`, and WebKit's patched protocol can be mapped onto it. `RemoteResult` is a `RemoteValue`, or an exception with its details; handles carry the backend's binding as correlation evidence.

**Recommendation.** Adopt.

### 11. Launchers are internal, and profiles are per backend

**Where:** API.md, Modules and backends; `LaunchProfile`.

**What changes.** Each backend gets an internal launcher (executable, temporary profile, arguments, transport) that its `layer` will use, failing with `Browser.BrowserError`'s existing reasons. The profiles' arguments differ per browser, so `LaunchProfile.automation` resolves per backend. Chrome for Testing as the default executable needs the download CLI API.md defers, so until it exists a launch needs `executablePath` or a channel and says so in `ExecutableNotFound`'s hint, with no silent search of `PATH`.

**Recommendation.** Adopt.

### 12. BiDi and WebKit get parsers, and their browsers come from nixpkgs for tests

**Where:** PROTOCOL.md, Code generation; Backends and order.

**What changes.**
- **BiDi:** the CDDL from the W3C spec repository, vendored and pinned like CDP's, parsed into the model. CDDL needs model shapes CDP doesn't: unions (by discriminator, by shape), literals, and maps. Firefox 158 tests it.
- **WebKit:** the `protocol.json` inside Playwright's WebKit build. Its format is CDP's, so the CDP parser serves with a different header. Playwright's WebKit 26.6 (revision 2359) tests it.
- Both browsers come from nixpkgs (`firefox`, `playwright-driver.browsers`) into the Nix store; nothing is installed system-wide.

**Recommendation.** Adopt.

### 13. One conformance suite runs against every backend

**Where:** PROBES.md ("the probe suite is also the adapters' regression suite").

**What changes.** The adapter tests are written once against the adapter interface and the facts, with a local HTTP server, and run against each backend's launcher. A behavior a backend lacks is asserted as `Unsupported`, never skipped silently.

**Recommendation.** Adopt.

## Considered and not adopted

- **Publishing a page only after it is ready, and holding its facts until then.** L1 needs the page's id while the gate runs (for declarations scoped to it, and for an opener's `Popup` event), so `PageAdded` comes first and `PageReady` follows.
- **One adapter interface per access level.** Access is L1's policy. The adapter takes any id; L1 checks access before calling.
- **Pausing popups per opener with `Target.setDiscoverTargets` and attaching on `targetCreated`.** A popup is already running by then; only auto-attach pauses before its scripts.

## Decision

Adopted in full, 2026-10-20, under the maintainer's request to finish the protocol layer. The build records where it differs, as before.
