# PROBES: conformance probes, hazard coverage and model tests

*Revision 5, 2026-10-18. The specs leave key orderings and identities undefined, and the research disagrees in places. These questions are to be measured, not argued. The probe suite is also the adapters' regression suite: recorded traffic must decode against the generated schemas, and recorded behavior is re-run on each browser roll. Probe numbers are stable across revisions.*

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
12. **Pipe EOF.** Does Chrome exit when fd 3 and fd 4 close after the parent is SIGKILLed? Does Bun support the extra file descriptors?
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
| H14 a dialog blocks sibling pages | confirmed vs suspected blocking; `Pending` is waitable; auto-resolutions reported |
| H15 beforeunload needs activation | `CloseCanceled`; the page stays usable |
| H16 back/forward-cache restore | document continuity correlated; handles proven separately |
| H17 a service worker answers a request | `servedBy`; lifecycle without `Sent`; bypass capability |
| H18 service worker restart | realm cycles under a stable registration |
| H19 rendering-based waits hang in hidden tabs | `NoRenderingOpportunity`; `activate()` |
| H20 the click lands elsewhere | pre-check plus a guard on the trusted event |
| H21 synthetic input is not user input | input fidelity; activation declared |
| H22 transient activation expires | gated work chained in one gesture; evaluation with user activation |
| H23 the file chooser doesn't pause | obligation armed before input |
| H24 focus differs headless vs headed | page focused before key input |
| H25 IME composition | `insertText` primitive |
| H26 shadow DOM retargeting | per-shadow-root hit testing; composed-tree queries |
| H27 top layer and inert subtrees | `NotInert`, `BlockedByModal` |
| H28 content-visibility | `ContentVisibilitySkipped` |
| H29 storage in the wrong partition | explicit partition mapping; portable storage state |
| H30 prerender | `Activated`; capability-gated |
| H31 keepalive requests outlive the page | detached attribution; no fabricated failures |

## Deterministic model tests

These run against synthetic protocol traffic with an injected clock. They check L1 and L0 logic, not browser behavior.

**Timelines.** Most of these tests are about *when* things happen relative to each other, so a fake browser is driven by marble-style timelines, after RxJS's `TestScheduler`, under `TestClock`. Each character is one virtual tick, and each named token is a scripted model event:

```ts
FakeBrowser.timeline("--resp(cart)--commit--load--|", ({ page }) =>
  Effect.gen(function* () {
    const cart = yield* page.events.response({ url: "**/api/cart" }).pending   // armed at tick 0
    yield* TestClock.adjust("20 millis")                                       // the response arrives at tick 2
    expect((yield* cart).url).toContain("/api/cart")                          // latched before the await
  }))
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
  - a `.pending` latches a match that arrives before the await;
  - a `.stream` acquired before the trigger misses nothing;
  - `changes` ends after the terminal state.
- **Ownership ledger:** persisted candidates never trigger automatic cleanup.
- **Types:** API sketches preserve caller `E` and `R`.
