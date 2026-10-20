# PROBES: conformance probes, hazard coverage and model tests

*Revision 5.25, 2026-10-19; first results 2026-10-20, for CDP, BiDi and patched WebKit. The specs leave key orderings and identities undefined, and the research disagrees in places. These questions are to be measured, not argued. The probe suite is also the adapters' regression suite: recorded traffic must decode against the generated schemas, and recorded behavior is re-run on each browser roll. Probe results and recorded traces are also the evidence that spec corrections cite (PROTOCOL.md, Code generation). Probe numbers are stable across revisions.*

## Conformance probes (run against each backend)

1. **Commit ordering.** Does the realm-created event come before or after commit (`realmCreated` vs `navigationCommitted`; `executionContextCreated` vs `frameNavigated`)?
2. **Initial `about:blank` reuse.** Do CDP and BiDi keep the same context or realm id when the first same-origin navigation reuses the Window?
3. **Back/forward cache.** Is `realmDestroyed` sent on entry? Are realms and contexts re-announced on restore, and with the same ids? Is `contextDestroyed` sent for cached child frames? Does CDP keep the `loaderId`? The answers decide true suspension support versus the `restoredFrom` fallback.
4. **Missing terminal events.** What does each backend emit for a canceled `navigate` event, `intercept()`, a `javascript:` URL that returns a non-string, and a superseded navigation?
5. **Prerender activation.** Which ids does the activated page carry? Do preload scripts run in prerendered documents?
6. **Fenced frames.** Do they appear as children or as top-level in `getTree` and `Target`?
7. **Service workers.** How are requests served by a service worker, and the worker's own subrequests, attributed? Is double interception real?
8. **Orphaned children.** Does every backend emit a detach for the child frames of a document that navigated away?
9. **Event-loop sharing.** Does an `alert()` in a popup block evaluation in its same-site opener?
10. **Stability sampling.** Measure native animation-frame cadence and the stable-frame count per backend and headless mode, including background tabs. Confirm that sampling stays independent of an injected application clock.
11. **Partial CDP implementations** (Lightpanda and similar). Which methods return success without doing anything?
12. **Pipe EOF.** Does Chrome exit when fd 3 and fd 4 close after the parent is SIGKILLed? Does each backend exit when its transport drops that way, and what does it leave in its profile directory that would block the next launch (`strider prune`, CLI.md)? Do Bun and Deno support the extra file descriptors, including inside worker threads, where etest's executors run?
13. **Browsing-context-group switches.** How does each backend reveal one: an opener change, a new WindowProxy, `sharedId` invalidation?
14. **Safari BiDi on stable.** Does `safari:experimentalWebSocketUrl` work on stable Safari 27?
15. **Navigations that keep the old document.** For a canceled navigation, a download or a 204/205, confirm the old realm stays usable and no wait depends on a replacement realm that never arrives.
16. **Delayed consequences.** After a synchronous and a timer-delayed navigation, confirm that `drainObserved` covers only its local watermark, and that deadlines report "unobserved" without inventing cancellation.
17. **Node and reference continuity.** Probe document identity, connectivity, node binding and handle validity separately for: removing and reinserting a node; adopting it into another document; `document.open()` (including how to detect the generation reset); and back/forward-cache restore.
18. **Initialization boundaries.** Inject a required setup failure and concurrent declaration changes during popup and out-of-process-iframe creation. Check the before-script boundary, ordered preload execution, and that removal never replays the remaining scripts. Check attaching to an existing page separately.
19. **Connection loss.** Drop the client connection while intercepts are installed, requests are paused, and targets are paused for the debugger, on CDP and on BiDi (including BiDi-only sessions). Are requests released, do targets resume, does the session survive?
20. **Evaluation with user activation.** Do `userGesture`, `userActivation` and `emulateUserGesture` grant transient activation, sticky activation, or both?
21. **Page time.** Per backend, check:
    - fixed and offset wall time with live timers;
    - controlled timers and animation frames;
    - log replay across navigations and into same-origin frames;
    - sampling that stays independent of the page clock;
    - clicking with the clock paused, without page time advancing;
    - installation before author script;
    - teardown.
22. **Pause-on-start granularity.** Can new targets be paused per created context, per opener (popups), or only browser-wide by type? Covers CDP `setAutoAttach` filters and `autoAttachRelated`, and WebKit page proxies. A user-opened tab in an attached browser must never be paused unless browser-wide access was granted.
23. **Interactivity evidence.** Per backend, can event listeners be listed (CDP `DOMDebugger.getEventListeners`; WebKit unconfirmed; BiDi has none)? What does that cost on large pages? On a corpus of known-inaccessible sites, how much do inferred interactivity and inferred names recover compared with the accessibility tree alone?
24. **Error vocabulary.** Per backend, record the error reply for each of these: a stale node id, a detached frame, a closed target, an unknown method, an unsupported operation, invalid parameters, and a command sent to an ended session. The replies seed the error matcher tables and become drift-test fixtures.
25. **Several clients on one browser.** Can several clients connect to one browser at once, each owning its own user contexts, on CDP (`createBrowserContext` with `disposeOnDetach`) and on Firefox's BiDi? When a client disconnects, are its contexts removed? This decides one browser per test run.
26. **Many pages at once.** With one context per test and 1, 4 and 8 tests running concurrently, headless and headed, with and without `LaunchProfile.concurrent`:
    - Do pages stay visible and keep rendering? Do timers keep their cadence?
    - Does each new context's first page get its own window?
    - What does `document.hasFocus()` report with `focus` set to `"emulated"` and to `"system"`?

## Results

Recorded with Chromium 155.0.8059.79 over the pipe, every message logged both ways; the adapter conformance suite (`test/integration/adapter/`) re-checks the ones the CDP adapter depends on.

| Probe | CDP (Chromium 155, 2026-10-20) |
|---|---|
| 1. Commit ordering | The realm comes after the commit: `executionContextsCleared` (main frame) or `executionContextDestroyed` (subframe), lifecycle `init`, `frameNavigated`, then `executionContextCreated` |
| 2. Initial `about:blank` reuse | Kept. A popup opened with `window.open('/two')` commits its initial `about:blank`, then `/two`, with no new context: same id, same `uniqueId`. A frame's initial document has no realm until script touches it, so its first navigation creates one |
| 3. Back/forward cache | Used between plain pages of one site: back gives `frameStartedNavigating` (a history navigation, with a new loader id), the old document's context destroyed, the restored document's new context, then `frameNavigated{type: BackForwardCacheRestore}` under the restored document's original loader id. Not used by the first probe's pages |
| 4. Missing terminal events (superseded) | A navigation replaced while in flight gets `loadingFailed{ERR_ABORTED, canceled}` just before the new one's `frameStartedNavigating`, and its `Page.navigate` replies `ERR_ABORTED`; no event names the replacement |
| 8. Orphaned children | No `frameDetached` for the children of a document that a cross-document navigation replaced. A frame removed by script gets `frameDetached{reason: remove}`; one moving to another process, `swap` |
| 15. Navigations that keep the old document | A 204: `Page.navigate` replies `ERR_ABORTED`, then `responseReceived` 204 and `loadingFailed` (canceled), and no commit. A download: `isDownload: true`, `loadingFailed`, then `Browser.downloadWillBegin` for the frame. The old realm stays usable in both |
| 17. Node and reference continuity (`document.open()`) | Visible: `Page.documentOpened`, then lifecycle `init`, `DOMContentLoaded` and `load` again under the same loader id |
| 22. Pause-on-start granularity | Frames and workers: per page (`setAutoAttach` on its session; an out-of-process frame attached with `waitingForDebugger: true`). Popups: browser-wide only. A popup opened with a user gesture is created with `openerId`, but neither `autoAttachRelated` on its opener nor auto-attach on the opener's session attaches it, and `TargetFilter` has no context. A paused popup also blocks its same-process opener: `window.open` doesn't return until the popup resumes |
| 24. Error vocabulary | Six rows (PROTOCOL.md, Protocol client): unknown method, invalid parameters, unknown target, unknown frame, unknown node, ended session. An unknown execution context is `Unrecognized` |
| 25. Several clients on one browser | Yes: a second client connected over the debugging port attached to a page the first one had created and crashed it, and the first one saw the crash |

| Probe | BiDi (Firefox 158.0, 2026-10-20) |
|---|---|
| 1. Commit ordering | The realm comes **before** the commit: `realmDestroyed` (old), sometimes a transient `realmCreated` and `realmDestroyed` with origin `null`, `realmCreated` (new), then `navigationCommitted` |
| 2. Initial `about:blank` reuse | Kept, as in Chromium: a same-origin frame or popup commits its first document with no new realm |
| 3. Back/forward cache | Used for back and forward between plain pages: `navigationStarted`, the old realm destroyed, a new realm (a new id) created, and no `navigationCommitted`, `domContentLoaded` or `load`; `traverseHistory` replies after. Leaving the JSON viewer before it has loaded, there isn't even a `navigationStarted`, and the viewer's realm is destroyed after the new one is created. A console message the restored page logged when it loaded comes again |
| 8. Orphaned children | Reported: `contextDestroyed` for the remaining frame when the top document navigated away, unlike Chromium |
| 15. Navigations that keep the old document | A 204: `responseStarted` 204, `fetchError` `NS_BINDING_ABORTED`, an error reply to `browsingContext.navigate`, and `navigationFailed` only when the next navigation starts. A download: `downloadWillBegin` naming the navigation, then `downloadEnd` |
| 17. `document.open()` | `historyUpdated`, then `domContentLoaded` and `load` again under the document's own navigation id |
| 20. Evaluation with user activation | `userActivation: true` grants transient activation for the call only: `isActive` and `hasBeenActive` are true inside it and false after. A popup opened inside it isn't blocked. Chromium's `userGesture` leaves `hasBeenActive` true |
| 24. Error vocabulary | `unknown command` for a missing method (also for `emulation.setMediaFeaturesOverride`, which Firefox doesn't implement), `invalid argument`, `no such frame`, `no such node`, `no such history entry`, `no such network data`; a failed navigation is an `unknown error` reply to `navigate` |

Other BiDi findings: `browsingContext.reload` with `ignoreCache`, whatever its value, is refused as `unsupported operation` ("Argument "ignoreCache" is not supported yet."); a JSON response renders in a JSON viewer whose realm's origin is `resource://devtools`; a dedicated worker's console messages arrive with its owner window's realm as their source; an error page commits as `about:neterror?e=…` under a navigation id never announced by `navigationStarted`; frame context ids are numeric strings, top-level ones UUIDs; `permissions.setPermission` is implemented.

Other CDP findings: a page's commands are refused with "Not attached to an active page" for a moment while it swaps documents, as just after a commit; execution context ids restart after a process swap within one session, while `uniqueId` doesn't; `frameStartedNavigating` carries the loader id from the start, also for same-document navigations started by a command (`navigationType: sameDocument`); a refused connection commits `chrome-error://chromewebdata/` under the navigation's own loader id; browser-wide auto-attach without a filter attaches `browser_ui` targets and component extensions' pages; `Fetch.requestPaused` follows `Network.requestWillBeSent` and names it with `networkId`; deep serialization gives BiDi's `RemoteValue`, and a node carries its `backendNodeId` and its document's loader id.

Recorded with Playwright's WebKit build 2359 over the pipe, every message logged both ways by scratch scripts that aren't committed; the conformance suite and `test/integration/WebKit.test.ts` re-check what the WebKit adapter depends on.

| Probe | Patched WebKit (Playwright's build 2359, WebKit 26.6, WPE headless, 2026-10-20) |
|---|---|
| 1. Commit ordering | The realm comes after the commit, as in Chromium: `frameNavigated`, then `executionContextCreated`. No event ever says a context was destroyed |
| 2. Initial `about:blank` reuse | Not kept: a popup opened with `window.open('/hello')` by a same-origin opener commits `/hello` with a new context (id 2 after 1), and so does a new page's first navigation |
| 3. Back/forward cache | Not used: `Page.goBack` loads the page again from the network, under a new loader id |
| 8. Orphaned children | Reported: `frameDetached` for each child of a document a navigation replaces, before the parent's `frameNavigated`, like Firefox |
| 15. Navigations that keep the old document | A 204: `responseReceived` 204, `loadingFailed` "Frame load interrupted" (canceled) and `Playwright.provisionalLoadFailed` with the loader id, and no commit. A download: `Playwright.downloadCreated` (whose `frameId` isn't the page's frame id in the web process), `responseReceived` twice, the same two failures, then `downloadFilenameSuggested` and `downloadFinished`. A request the browser refuses to send (port 9) has no request event at all, only `provisionalLoadFailed` and a `security` console message |
| 17. `document.open()` | Only `loadEventFired` and `domContentEventFired` again, for the same frame and loader; no other event |
| 20. Evaluation with user activation | `emulateUserGesture` grants activation that outlasts the call: `isActive` and `hasBeenActive` are still true after it, as with Chromium's `userGesture` |
| 22. Pause-on-start granularity | Every target created after `Playwright.enable` starts paused (`isPaused`): a new page's, a popup's (its page proxy names its opener) and the provisional target of a cross-site navigation, each resumed on its own with `Target.resume`. The startup page, created before, isn't. Frames run in their page's process (no site isolation in this build), so a cross-site iframe is no target of its own |
| 24. Error vocabulary | Eight rows (PROTOCOL.md, Built for WebKit): an unknown domain or method (`-32601`, at the browser, a page proxy and a target alike), arguments that can't be processed, a page proxy that is gone (two codes), a target that is gone, an unknown frame, an unknown node by id or object. An unknown execution context ("Missing injected script for given executionContextId"), object or browser context is `Unrecognized` |

Other WebKit findings:

- Two commands abort the browser instead of failing: `Playwright.navigate` with a `frameId` the page doesn't have (exit 134), and `Dialog.handleJavaScriptDialog` with no dialog open (exit 139).
- A cross-site navigation loads in a provisional target whose main frame has a new id (`8589934595` for `8589934594`); the loader id is the same in both, `Page.didCheckNavigationPolicy` on the old target says `cancel: true` though the navigation goes on, and `didCommitProvisionalTarget` comes before the old target's `targetDestroyed`. The provisional target's tree shows a main frame with an empty URL and loader id.
- `loadEventFired` usually comes before `domContentEventFired` for the same frame; a parent's `domContentEventFired` can come before its children's load.
- `Page.getResourceTree` must come before `Runtime.enable` for its snapshot to precede the contexts `Runtime.enable` replays.
- `Playwright.navigate` replies with the loader id before the load's events, and with none for a same-document navigation; `Playwright.createPage` replies after `pageProxyCreated` and `targetCreated`.
- `Playwright.setLanguages` reaches only web processes started after it: a same-process navigation keeps the old locale, a cross-site one takes the new one.
- `Emulation.setDeviceMetricsOverride` resizes the view and has nothing to clear (0 by 0 makes the view empty); WPE headless starts views at 1024 by 768.
- A document caches `navigator.userAgent` once it has been read, so `Page.overrideUserAgent` shows in it only if nothing read it before.
- Workers have no `Network` domain; a worker's script request comes on its page's target with `targetId` naming the worker, before `workerCreated`.
- A dialog's `Dialog.javascriptDialogOpening` comes on the page proxy, and an answer the adapter sends completes it; in a raw-protocol scratch probe, the same answer left the dialog open and its page blocked, and that difference wasn't traced.

## Hazard coverage

The hazards are catalogued in `research/platform-concept-model.md` §4.

| Hazard | Handled by |
|---|---|
| H1 element detached between query and action | binding, generation and connectivity checked at use; locators re-resolve; mutations never replayed |
| H2 navigation during an evaluation | `within` arbitration; uncertain side effects recorded |
| H3 evaluation in a back/forward-cached document | fail fast with `StaleRef{Suspended}`; locators see `NotReady`; waiting is opt-in |
| H4 script runs before the realm-created event | preload bundles installed before navigation |
| H5 frame scripted before it is known | initialization gate where pause-on-start is available (probe 22) |
| H6 popup before listeners | observation windows; opener correlation; initial blank ≠ destination |
| H7 process swap | session generations; initialization gate re-runs; operation-aware retry |
| H8 browsing-context-group switch | `Confirmed/Suspected/Unknown`; lost bindings invalidated |
| H9 navigation without a terminal event | evidence-only outcomes; `Timeout{postcondition}` |
| H10 "failed" but an error page committed | `Failed{errorDocument}` |
| H11 navigation produces no document | `Download`, `NoContent` |
| H12 navigation ignored during traversal or unload | `Canceled` only with evidence |
| H13 initial `about:blank` reuse | realms are siblings of documents |
| H14 a dialog blocks sibling pages | confirmed vs suspected blocking; a pending prompt resolution is waitable; auto-resolutions reported |
| H15 beforeunload needs activation | `CloseCanceled`; the page stays usable |
| H16 back/forward-cache restore | document continuity correlated; handles proven separately |
| H17 a service worker answers a request | `servedBy`; lifecycle without `Sent`; bypass capability |
| H18 service worker restart | realm cycles under a stable registration |
| H19 rendering-based waits hang in hidden tabs | `NoRenderingOpportunity`; `activate()`; `LaunchProfile.concurrent` (probe 26) |
| H20 the click lands elsewhere | pre-check plus a guard on the trusted event |
| H21 synthetic input is not user input | input fidelity; activation declared |
| H22 transient activation expires | gated work chained in one gesture; evaluation with user activation |
| H23 the file chooser doesn't pause | obligation armed before input |
| H24 focus differs headless vs headed | page focused before key input; `focus: "emulated"` for owned contexts |
| H25 IME composition | `insertText` primitive |
| H26 shadow DOM retargeting | per-shadow-root hit testing; composed-tree queries |
| H27 top layer and inert subtrees | `NotInert`, `BlockedByModal` |
| H28 content-visibility | `ContentVisibilitySkipped` |
| H29 storage in the wrong partition | explicit partition mapping; portable storage state |
| H30 prerender | `Activated`; capability-gated |
| H31 keepalive requests outlive the page | detached attribution; no fabricated failures |

## Deterministic model tests

These run against synthetic protocol traffic with an injected clock. They check L1 and L0 logic, not browser behavior.

**Timelines.** Most of these tests are about *when* things happen relative to each other, so a fake browser, `Browser.layerTest(timeline)` (API.md, Testing), is driven by marble-style timelines, after RxJS's `TestScheduler`, under `TestClock`. Each character is one virtual tick, and each named token is a scripted model event:

```ts
it.effect("latches a response before it is awaited", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()                                     // the first page plays the timeline
    const cart = yield* NetworkResponse.next(page, { url: "https://shop.example.com/api/cart" })   // subscribed at tick 0
    yield* TestClock.adjust("20 millis")                                      // the response arrives at tick 2
    assert.include((yield* Deferred.await(cart)).url, "/api/cart")            // latched before the await
  }).pipe(Effect.provide(Browser.layerTest("--resp(cart)--commit--load--|"))))
```

Tokens map to fold inputs: `resp(name)`, `req(name)`, `commit`, `load`, `dialog(kind)`, `popup`, `crash`, and `|` for a normal close. The timeline sits on the in-memory transport, so the same tests also exercise ingestion. Cases:


- **Lifetimes and interruption:** a typed lifetime end versus caller interruption; late resource replies after a cleanup group has shut down; transfer racing cleanup; tearing down controlled `leaveOpen` resources.
- **Declarations:** out-of-order override release; a failed override apply; preload dependency validation (only equal or broader scope).
- **Obligations:** competing and hung handlers; a fallback racing an explicit decision.
- **Ingestion:** subscriber predicates that throw or run slowly while replies and obligations still progress; malformed required events and core overload.
- **Deadlines and ordering:** one deadline across nested waits and input permits; a final match versus the stream's terminal marker; the hand-off from snapshot to subscription.
- **Network:** response-hop identity and body retention; a backend mismatch after partial dispatch.
- **Storage:** codec round-trips of storage state and restoring into a fresh context.
- **Ambiguity and dialogs:** ambiguity fails immediately with candidates and a visibility hint, and the dialog policy decides with no delay.
- **State and events:**
  - a `Watchable` subscribed late sees the present, and `waitFor` succeeds even after intermediate stages were skipped;
  - a `next` latches a match that arrives before the await, and its deadline runs from `next`;
  - a `stream` acquired before the trigger misses nothing;
  - a `next` subscribed just after its match times out with a hint naming that match;
  - `history` keeps the newest entries past the cap and counts the rest in `dropped`;
  - `changes` ends after the terminal state.
- **Ownership ledger:** persisted candidates never trigger automatic cleanup.
- **Types:** API sketches preserve caller `E` and `R`.
