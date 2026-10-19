# CDP clients outside the JS ecosystem: mechanisms and lessons for an Effect-native design

Repos were cloned with `--depth 1` into `/tmp/prior-art/<name>`. They were read only; nothing was built or run.

| Repo | SHA | Commit date |
|---|---|---|
| chromedp/chromedp | `7862adfd3424d6f379af01f4276a87019b08c507` | 2026-10-11 |
| chromedp/cdproto | `ca3270c01ed815f347cd8d7c97f697ee3c17c694` | 2026-10-17 (Chromium 158 definitions) |
| chromedp/pdlgen (cdproto's generator) | `b06f1c4000de6a70a47ada87dacf348ce797a5c9` | n/a |
| go-rod/rod | `d38c75327872c72a1cf2010dad7527f9e52eebf3` | 2026-08-11 |
| mattsse/chromiumoxide | `afcc3a4313f2087249b4490d94e54bf8e3bfaccf` | 2026-04-03 |
| autoscrape-labs/pydoll | `edaa66f3032fa0bac44366fa3ba08ccbf8dcd6f7` | 2026-09-29 (Pydoll 3) |
| cdpdriver/zendriver | `6740d62cfa86d2245ecd4dbba7ed00ffd43977c2` | 2026-10-01 |
| ultrafunkamsterdam/nodriver | `219a60d65d82fb3d137d0c2c5b1fb285a9f837d0` | 2026-10-08 |
| rubycdp/ferrum | `ece8101b3b5e1033306a129cbbe3663d903938b4` | 2026-10-19 (UTC) |
| VibiumDev/vibium | `79936db99a8a81e345ad884ac2a8b10240ed7935` | 2026-10-17 (v26.8.21) |

Vibium was confirmed through a web search before I relied on it. It is the WebDriver BiDi framework that Jason Huggins announced in December 2025 ([Gigazine](https://www.gigazine.net/gsc_news/en/20260111-vibium), [TestGuild](https://testguild.com/vibium-the-new-selenium/)). The issue-tracker findings come from a `gh` survey of each repo. Comment counts appear as "Nc".

---

## Summary

- **Every library converges on the same transport core.** It has one reader per socket, a pending map from command id to a one-shot reply, and responses resolved on the reader before any event handler runs. Libraries that strayed from this hit deadlocks: Vibium #128 (the client read the socket only while awaiting its own reply), zendriver #144 (handlers awaited inline in the read loop), and chromedp #455 (synchronous listeners). In Effect terms the reader is a forked fiber, the pending map holds `Deferred`s, and event fan-out is a per-session `PubSub`.
- **CDP has no way to cancel a command.** In every library, cancelling only abandons the reply: Go context, Rust future drop and asyncio cancellation all just drop the waiter, and the browser still runs the command. Vibium goes one step further and records abandoned ids as tombstones so late replies are dropped cleanly. Effect interruption should carry the same meaning, and the docs should say so.
- **Lifetimes.** chromedp maps the Go context tree onto browser→tab lifetimes. Cancelling a tab's context detaches and closes the target from a fresh 5 s context, which is exactly an Effect finalizer with a timeout. chromiumoxide shows what goes wrong without async drop: tabs outlive their handles.
- **Composition.** chromedp now models actions as plain functions `Action[T] = func(ctx, *Target) (T, error)`. That is `Effect<T, E, Target>` under another name. rod's `Sleeper` is a hand-rolled `Schedule`, and its `Race` is a sequential poll rather than a real race.
- **Code generation.** cdproto (pdlgen) drops deprecated items, keeps experimental ones, and emits typed `Command[P,R]`/`Event[E]` values (about 28k lines of Go in total). chromiumoxide emits one 111k-line Rust file with closed enums. Its untagged `Message` enum made unknown data fatal to the whole connection (#167, 18c). Protocol drift is the top cross-library bug class.
- **Stealth.** pydoll, zendriver, nodriver and rod never call `Runtime.enable`. They evaluate script through `Runtime.evaluate` without a `contextId`, through `Runtime.callFunctionOn` on an object handle, or in an isolated world from `Page.createIsolatedWorld`. chromedp and chromiumoxide enable Runtime, DOM, CSS, Network and other domains as soon as they attach. A library that tracks realms through `Runtime.executionContextCreated` cannot be stealthy, so realm acquisition must be pluggable and domain enablement must be demand-driven and reference-counted.
- **Waiting.** The best design is Vibium's: Playwright's actionability matrix evaluated in one script round trip, with errors that name the check that failed. rod's `WaitStable`, `WaitRequestIdle` and `WaitDOMStable` are useful building blocks, but they are based on polling.
- **Interception.** "Every paused request must be resolved exactly once" is the shared footgun. It should be enforced by a handler return type, not by documentation.

---

## chromedp + cdproto (Go)

### Cancellation and lifecycle

The context tree is the resource tree. `NewContext(parent)` either inherits the parent's `Browser` and opens a new tab on its first `Run`, or allocates a browser. A watcher goroutine tears down non-root tabs when their context is cancelled (`chromedp.go:239-302`):

```go
go func() {
    <-ctx.Done()
    ...
    // The context ctx is canceled, so make a new context with a timeout.
    ctx, cancel := context.WithTimeout(context.Background(), closeTargetTimeout)
    if id := tgt.SessionID; id != "" {
        _, err := cdp.Call(ctx, c.Browser, target.DetachFromTarget, ...)
    }
    if c.detachOnCancel { return }          // leave the tab open
    ... target.CloseTarget ... waitTargetGone(wctx, ...) // 500ms: CloseTarget answers early
    if c.browserContextOwner { ... target.DisposeBrowserContext ... }
}()
```

`closeTargetTimeout = 5 * time.Second` (`chromedp.go:39`). The returned cancel function waits for the teardown (`closedTarget.Wait()`) and for the allocator to finish (`<-c.allocated`). `Cancel(ctx)` closes gracefully through `Browser.close` and collects `cancelErr`.

The big footgun is documented in `chromedp.go:154-170`: "The first call of Run on a context starts the browser, and it binds the life of the browser to the context that you pass to that call." Putting a timeout on that first call therefore kills the browser.

**In-flight commands** (`browser.go:246-303`). `execute` registers a listener for the reply id, enqueues the command, then selects on `ctx.Done()`, `LostConnection` and the reply. On cancel it returns `ctx.Err()` and the listener is pruned; the browser still runs the command. A lost connection wraps the loss reason with `context.Canceled`, and a reply that races the loss is still honoured. Process cleanup uses `Pdeathsig = SIGKILL` and `killLeftovers(dir)` (`allocate_linux.go:32`).

### Composing actions

The "Tasks and Actions as data" model has been replaced. Since cdproto `v0.157.3` there is a typed API:

```go
type Action[T any] func(ctx context.Context, t *Target) (T, error)   // action.go:31
func Run[T any](ctx context.Context, a Action[T]) (T, error)         // action.go:59
func Steps(steps ...Action[Void]) Action[Void]                       // replaces Tasks
func Legacy(a OldAction) Action[Void]                                // adapter for old Do(ctx) actions
```

`WaitEvent(ev, match, trigger)` (`action.go:204`) subscribes, runs `trigger`, then takes the first match: subscribe-before-trigger as a combinator. Actions are plain closures; nothing interprets them.

### Code generation (cdproto via pdlgen)

`pdlgen/docs/GENERATOR.md:9-45`: fetch Chromium and V8 PDL at pinned versions, add a hand-written HAR domain, "skip a domain, a type, a command, an event or a parameter that the protocol marks as deprecated" (and anything redirected), move circular types into `cdp`, name inline enums, generate. Experimental items are kept. Every command becomes a value (`cdproto/page/page.go:358`):

```go
var Navigate = cdp.Command[NavigateParams, NavigateResult]{Method: CommandNavigate}
```

and runs through a tiny generic core (`cdp/types.go:41-118`): `Command[P,R]{Method}`, `Event[E]{Method}`, a `Session` interface with `Call` and `Subscribe`, and `Call[P,R]`. `Events[E]` returns an `iter.Seq2[E, error]`; decoding happens per subscriber, and "a payload that does not decode yields the decode error and ends the iteration".

Versioning is `v0.<chromium major>.<patch>`; any release may break, and no release is cut when the generated API is unchanged. The whole protocol is 158 files, about 28k lines, because it relies on `encoding/json/v2` (via a `cdp/jsonv2` shim) instead of generated codecs.

### Event dispatch and backpressure

There are three tiers.

1. **Reader goroutine** (`browser.go:357-399`). Session-scoped messages are sent, with blocking, to `incomingQueue`. Browser-level events are published synchronously to listeners.
2. **Browser loop** (`browser.go:402-443`). It routes messages to each target's `messageQueue` (capacity 1024, blocking send). Messages for unknown sessions are dropped ("A page that we closed recently still sends events", `:427`).
3. **Target loop** (`target.go:99-170`). It runs listeners synchronously, then feeds `Runtime`/`Page`/`DOM` events into `syncEventQueue` (4096). The comment there admits: "TODO: If this queue gets full, the goroutine below can get stuck on a send. Then the response callbacks never run, and this causes a deadlock."

The newer `Subscribe` API sidesteps this. Each subscription gets an unbounded queue and a pump goroutine. `publish` "never blocks" (`session.go:88`), and `close()` drains the remaining events before closing ("a reader sees every event up to the end of the session"). Delivery is therefore lossless and unbounded, and dispatch is per session. The old `ListenTarget` callbacks ran under `listenersMu`, so calling an action from inside one deadlocked (#455; "any Actions must be run via a separate goroutine").

### Targets and sessions

`attachTarget` uses `Target.attachToTarget{flatten:true}` (`chromedp.go:558-562`) and then calls `Target.setAutoAttach{autoAttach:true, flatten:true}` on the page (`:606`). Child sessions have no entry in `b.pages`, so their messages are dropped. There is no OOPIF support, and iframes are queried in the parent's DOM mirror through `ContentDocument` (`query.go:283-285`). Issue #72 "consider APIs to help deal with iframes" (36c) is still unresolved.

### Waiting and input

chromedp keeps a client-side DOM mirror built from `DOM.*` events (`util.go` `nodeOp`s). Selector queries retry every 5 ms (`query.go:239`) through `retryWithSleep`. Two errors are treated as permanent: `"DOM Error while querying"` and a JSPath value that is not a node (`query.go:296-310`).

`NodeVisible` is `DOM.getBoxModel` plus a `visibleJS` call (`query.go:633-655`). `Click` is `NodeVisible`, then `DOM.scrollIntoViewIfNeeded`, then the centre of `DOM.getContentQuads`, then `Input.dispatchMouseEvent` (`input.go:79-118`).

Navigation (`responseAction`, `chromedp.go:802-940`) buffers `earlyEvents` until the `init` lifecycle event reveals the `loaderId`, follows redirects, and finishes on `loadEventFired`, `frameStoppedLoading` or `navigatedWithinDocument`. Trackers show mirror races (#75, 32c) and waits with no default timeout (#794).

### Stealth posture

On every attach, chromedp enables Runtime (it evaluates `self` to detect workers), Log, Network, Inspector, Page, DOM and CSS. It also calls `setDiscoverTargets` and `setAutoAttach` and enables lifecycle events (`chromedp.go:579-614`). That is the most detectable profile in this survey.

---

## go-rod/rod (Go)

### Cancellation and lifecycle

Every handle (`Browser`, `Page`, `Element`) carries a `ctx`, and the context-related methods return clones (`context.go`):

```go
func (p *Page) Timeout(d time.Duration) *Page {
    ctx, cancel := context.WithTimeout(p.ctx, d)
    return p.Context(context.WithValue(ctx, timeoutContextKey{}, &timeoutContextVal{p.ctx, cancel}))
}
func (p *Page) CancelTimeout() *Page { val := p.ctx.Value(timeoutContextKey{}).(*timeoutContextVal) ... }
```

A timeout is a total budget for the chain that follows; `CancelTimeout` panics without one (forced type assertion); cancelling never closes the page. The transport (`lib/cdp/client.go:87-125`) keeps a `once`-guarded callback in a `sync.Map`, deleted by `defer`, so a cancelled caller just discards the reply. Commands to a closed session never get a reply, so callers without a deadline hang (#283, 17c). The `leakless` guard binary kills the browser when Go exits (`lib/launcher/launcher.go:270`); antivirus flags it (#720). `Pool[T]` is a channel whose `Get` ignores contexts (`utils.go:97-127`).

### Composing actions: `Must*`, sleepers, `WaitStable`, `Race`

**`Must*` versus error-returning.** `must.go` (1,172 lines) wraps every method via `genE(fail)`, which calls `fail` when the last return is an error; `WithPanic` swaps the strategy and `rod.Try` recovers. Docs pitch `Must*` for scripts and errors for production (`examples_test.go:171-216`). Cost: a doubled surface whose halves drift (`MustClick` fixes `button` and `clickCount`).

**Sleeper.** `type Sleeper func(context.Context) error` (`lib/utils/sleeper.go:18`), configured as a factory `func() Sleeper` because sleepers are stateful. Combinators: `BackoffSleeper` (`A(n) = A(n-1) * random[1.9,2.1)`), `CountSleeper`, `EachSleepers`, `RaceSleepers`, `Retry`. The default is 100 ms→1 s (`utils.go:69-78`) because "if a retry never ends it can easily flood the program". `NotFoundSleeper` fails immediately, turning a query into one attempt. `Page.Element` "retries until an element in the page matches" (`query.go:140`): forever, absent a timeout. This is `Schedule` without the algebra.

**`WaitStable`** (`page.go:821-838`) is `utils.All(WaitLoad, WaitRequestIdle(d,…), WaitDOMStable(d,0))`.
- `WaitRequestIdle` (`page.go:713-779`) keeps a `waitList` of request ids from `NetworkRequestWillBeSent`, removing them on `LoadingFinished` or `LoadingFailed`. It excludes WebSocket, EventSource, Media, Image and Font by default, de-duplicates redirects by `RequestID`, and treats the page as idle after `d` with nothing in flight. It returns a wait function, so the subscription starts before the trigger.
- `WaitDOMStable` (`page.go:783-818`) diffs `DOMSnapshot.captureSnapshot` strings with an LCS every `d`.
- `Element.WaitStable` compares `Shape()` (content quads) on a ticker, and `WaitStableRAF` compares them across two `requestAnimationFrame`s (`element.go:519-585`).

**`Race`** (`query.go:438-458`) is not concurrent:

```go
err := utils.Retry(rc.page.ctx, rc.page.sleeper(), func() (stop bool, err error) {
    for _, branch := range rc.branches {
        bEl, err := branch.condition(rc.page.Sleeper(NotFoundSleeper))
        if err == nil { ...; return true, err }
        else if !errors.Is(err, &ElementNotFoundError{}) { return true, err }
    }
    return
})
```

The branches are polled in order, each fails fast, and the whole round is retried with backoff.

### Code generation

`lib/proto` is generated from the `/json/protocol` endpoint of a browser launched at a pinned revision (`lib/proto/generate/utils.go:16-38`; `RevisionDefault = 1321438`). Experimental and deprecated items are both kept, with `(experimental)` and `(deprecated)` doc prefixes (`generate/main.go:111-115`). The output is about 35k lines. Commands are structs with methods, e.g. `proto.PageNavigate{URL: u}.Call(p)` (`lib/proto/page.go:2167-2191`), and events are found by reflection through `proto.GetType(method)`. Drift breaks it in the usual places (#1094, #1097, `cookiePartitionKey`).

### Event dispatch

A single reader sends events onto an unbuffered channel, so it blocks until consumed (`lib/cdp/client.go:155`). A goroutine republishes them into `goob`, an unbounded pub/sub (`browser.go:438-452`). There is a single global bus, and every subscriber filters by `SessionID` (`browser.go:391`). Delivery is lossless and unbounded.

`eachEvent` turns callback signatures into types by reflection (`func(e *proto.PageLifecycleEvent) bool`) and enables the matching domain automatically, restoring its previous state afterwards (`browser.go:354-404`). `EnableDomain` (`states.go:60-75`) is not reference-counted. A waiter that enabled a domain disables it on restore even if another waiter still depends on it.

### Targets, frames, OOPIF

rod uses `attachToTarget{Flatten:true}` ("if it's not set no response will return", `browser.go:275`) and no auto-attach. `Element.Frame()` clones the `Page` and resolves the frame's JS context through `DOM.resolveNode(contentDocument.backendNodeId)` (`element.go:458-470`, `page_eval.go:345-360`). Cross-origin frames only work because the launcher passes `disable-site-isolation-trials` (`lib/launcher/launcher.go:91`). This is the most-discussed issue in the repo (#548, 57c). #1234 notes that it silently falls back when you attach to a browser rod did not launch.

### Waiting and input

`Element.Interactable()` (`element.go:146-195`) checks the following in order:
1. Computed `pointer-events` is not `none`.
2. `Shape().OnePointInside()` returns a point.
3. `DOM.getNodeForLocation` at that point (`ElementFromPoint`, `page.go:989`, with scroll offsets added) returns a node, and `ContainsElement` holds for it. Otherwise it raises `CoveredError`.

`WaitInteractable` scrolls into view on every retry. `Click` is `Hover` (which waits for interactability and moves the mouse), then `WaitEnabled`, then `Mouse.Click`. `Input` focuses the element, waits for enabled and writable, calls `Input.insertText`, and then dispatches a synthetic `input` event.

### Evaluation without `Runtime.enable`

`getJSCtxID` (`page_eval.go:324-343`) calls `Runtime.evaluate{Expression:"window"}`, keeps the `objectId` as an anchor for the realm, and runs everything through `Runtime.callFunctionOn{objectId}`. Helper functions are cached per realm. When it gets `ErrCtxNotFound` it resets the anchor and retries, backing off from 30 ms to 3 s (`page_eval.go:123-146`). rod enables `Page` on every new page and `DOM` for searches, but it never enables `Runtime`.

### Hijack (Fetch)

`HijackRequests()` builds a router (`hijack.go:53-111`) that calls `Fetch.enable` with the union of its patterns. Each `Fetch.requestPaused` is handled in its own goroutine (`:70`), so a handler that issues commands cannot deadlock the event loop. Handlers run in order. `ctx.Skip` falls through to the next handler, `ContinueRequest` passes the request through, and otherwise the router fulfils the request with a response that defaults to `ResponseCode: 200` (`:170`).

`LoadResponse(http.Client, loadBody)` re-sends the request through Go's HTTP client. That means a different TLS stack, cookie jar and proxy from the browser's, and the whole body is buffered in memory (#748 memory leak). The maintainer has proposed replacing Fetch with a proxy (#395), and requests served by a service worker bypass the router (#318).

---

## mattsse/chromiumoxide (Rust)

### Cancellation and lifecycle

The user has to spawn and poll a `Handler: Stream`, which owns every piece of state (`src/handler/mod.rs:55-90`): pending commands, targets, sessions, navigations and listeners. The README loop is `while let Some(h) = handler.next().await { if h.is_err() { break; } }` (`README.md:26`). If the browser sends one message the client cannot parse, that loop exits and the browser stops responding.

**Future drop.** `CommandFuture` sends lazily on its first poll (`commandfuture.rs:80-90`). Dropping it before the first poll means the command never goes out. Dropping it afterwards leaves the entry in `pending_commands` until the reply arrives, when the send to the oneshot fails silently, or until `evict_timed_out_commands` removes it (`mod.rs:482-515`, `request_timeout`). `CommandFuture` also has its own hard-coded `Delay::new(REQUEST_TIMEOUT)` of 30 s (`commandfuture.rs:50`, `mod.rs:34`), which explains "configured timeout ignored" (#228, #175, #333).

`Browser`'s `Drop` relies on `kill_on_drop` and logs a warning (`browser/mod.rs:504-523`). `Page` has no drop behaviour because Rust has no async drop, so a tab whose handle is dropped stays open.

### Composition

Methods return `Result<&Self>` so that async calls can be chained: `page.find_element("input").await?.click().await?.type_str("x").await?`. `find_element` is a single `DOM.querySelector` with no retry and no actionability checks (`handler/page.rs:122-127`).

### Code generation (`chromiumoxide_pdl`)

There is a PDL parser plus a generator built on `quote!`. Experimental and deprecated items can be switched on or off independently (`chromiumoxide_pdl/src/build/generator.rs:58-60,406-452`). The freshness test sets the defaults to experimental on and deprecated off, with an allowlist of deprecated types that are still needed (`chromiumoxide_cdp/tests/generate.rs:20-26`). Output is a single `src/cdp.rs` of 111,037 lines, pinned at `CURRENT_REVISION = 1566079` (`chromiumoxide_cdp/src/lib.rs:34`).

Unknown event methods fall back to `CdpEvent::Other(serde_json::Value)` (`cdp.rs:728`), but enums and required fields are closed. Each frame is parsed in one step, `serde_json::from_str::<Message<T>>` (`src/conn.rs:133`), into an untagged enum. For most of the project's life one unknown enum value killed the whole connection (#167, 18c; #243). The `ignore_invalid_messages` option now defaults to true, but a reply that cannot be parsed still leaves its command waiting until the timeout.

### Event dispatch

Events are routed by session to the owning `Target`, or otherwise to the handler (`mod.rs:399-417`). Each listener has an `UnboundedSender<Arc<dyn Event>>` plus a `VecDeque` overflow, and a listener is pruned when its receiver disconnects (`src/listeners.rs:124-160`). Delivery is lossless and unbounded, with one `Arc` shared across subscribers and downcast at each one.

Subscribing is asynchronous: `event_listener::<T>()` sends `AddEventListener` through the handler channel (`page.rs:313-324`). Handlers never run on the handler task, because everything is a channel, so there is no reentrancy deadlock. The cost is the mandatory poll loop.

### Targets and sessions

The handler calls `setDiscoverTargets(true)` at construction and creates a `Target` for every `targetCreated` (`mod.rs:424-446`). Only page targets are driven (`target.rs:323`). Each one goes through a `TargetInit` state machine:
1. `attachToTarget{flatten}`.
2. `Page.enable`, `getFrameTree`, lifecycle events, `Runtime.enable` (`frame.rs:215-238`).
3. Network setup.
4. `setAutoAttach{flatten, waitForDebuggerOnStart:true}`, `Performance.enable`, `Log.enable` (`target.rs:571-596`).
5. Emulation.

When a child attaches, it gets `Runtime.runIfWaitingForDebugger`, and service workers are detached (`target.rs:259-280`). That resume call was missing for a long time, which produced "&lt;iframe&gt; elements stop page from loading" (#163, 28c). Iframe targets are never initialised, so OOPIF content cannot be reached (#280).

### Waiting, input, stealth

A navigation completes when the frame has seen the `load` lifecycle event (`frame.rs:139-140`), which is the source of the lazy-frame bugs. `click` scrolls the element into view, takes the first content quad with area greater than 1, and dispatches mouse events (`element.rs:142-160,269-273`).

`enable_stealth_mode` injects scripts with `addScriptToEvaluateOnNewDocument` and pins the user agent to Chrome 107 (`page.rs:64-70`). A stale UA is a fingerprint of its own, and this happens on top of eager `Runtime.enable`.

---

## pydoll (Python)

### Lifecycle and cancellation

The entry point is `async with Chrome() as browser`. Each tab gets its own `ConnectionHandler` and WebSocket to `/devtools/page/<id>` (`browser/tab.py:2075-2083`), so pydoll does not use flatten mode for tabs.

`execute_command` uses `asyncio.wait_for(future, timeout=60)` and removes the pending entry on `TimeoutError` (`connection/connection_handler.py:98-148`). `CancelledError` is not caught, so a cancelled caller leaves its entry in the map. `resolve_command` later pops it and checks `future.done()` to avoid `InvalidStateError` ("A late response can arrive after the caller already timed out", `commands_manager.py`). When the connection is lost, every pending command fails immediately. A message that cannot be parsed is logged and skipped rather than killing the reader (`:384-404`).

### Event dispatch

Responses are resolved inline on the reader. Events go into an unbounded `asyncio.Queue` that one worker drains in order, awaiting each async callback (`events_manager.py:55-80,199`). Ordering is strict, but one slow callback blocks every event behind it. Network logs live in a bounded deque of `MAX_NETWORK_LOGS = 10000` (`:22`). The worker also guards against a callback that raises `CancelledError`, so the worker itself does not die.

### Protocol types

The protocol is described with hand-written `TypedDict`s (`pydoll/protocol/*/methods.py`). Commands are plain dicts with no runtime decoding, so pydoll tolerates drift by construction but performs no validation at all. The sync API is generated from the async one (`scripts/generate_sync_api.py`).

### Targets, iframes, OOPIF

`IFrameContextResolver.resolve()` (`interactions/iframe.py`) works lazily:
1. `DOM.describeNode` the `<iframe>` to get its frameId.
2. If the frame is out of process, open a new browser-level socket, call `Target.getTargets`, filter by `parentFrameId`, attach with `flatten`, read the frame tree, and confirm the owner with `DOM.getFrameOwner` (`:288-420`).
3. Call `Page.createIsolatedWorld{frameId, worldName:'pydoll::iframe::<id>', grantUniversalAccess:true}` to get an `executionContextId` (`:480-500`).

The context is reused while the document object's `isConnected` is still true. The extra sockets leak (#426), and nested frames break (#382).

### Waiting and input

`find(..., timeout=N)` polls with a `PollInterval` and returns once anything is found (`find_elements_mixin.py:355-380`). `wait_until(is_visible=, is_interactable=, is_hidden=, is_detached=, is_enabled=, timeout=)` is a conjunction of predicates. `click()` checks visibility, scrolls into view, computes the target point and dispatches the click, optionally `humanize=True` for Bezier mouse paths (`web_element.py:617-660`).

### Stealth

Nothing is enabled by default. Per-domain flags (`_page_events_enabled`, `_runtime_events_enabled`, …, `tab.py:178-183`) are set only when the user asks. Scripts run through `Runtime.evaluate`, through `callFunctionOn` on object ids, or in isolated worlds. pydoll also ships a fingerprint applier and humanized input.

### Interception

`enable_fetch_events()` plus `on(FetchEvent.REQUEST_PAUSED, cb)` hands the callback raw dicts (`event['params']['requestId']`). The docs warn: "Resolve every paused request, exactly once … Miss one and that request hangs" (`docs/en/guides/request-interception.md:70`). Proxy authentication is also built on Fetch, which collides with user interception (#353, #268).

---

## zendriver / nodriver (Python)

### Lifecycle

There is one `Connection` per target. Each now attaches over the browser socket as a flattened session (`_attach_session`: `attach_to_target(flatten=True)`, `connection.py:456-475`). When a session detaches, its pending transactions fail with `ProtocolException("target session was detached")`. Cleanup at exit uses `asyncio_atexit`.

`await tab` calls `wait()`, which blocks until the listener has seen no messages for 0.10 s (0.75 s in interactive mode; `connection.py:875`). nodriver's docs tell users to "let it breathe" by awaiting the page. That is an idle heuristic presented as a synchronisation primitive.

### Commands as generators

The bindings are py-cdp style. Each command is a generator that yields the JSON request and receives the JSON reply, and its `StopIteration` value is the parsed result. A `Transaction(asyncio.Future)` drives it (`connection.py:80-131`). This keeps a codec as pure data. Results with several fields come back as positional tuples (`cdp/page.py:2680-2695`: `(FrameId, LoaderId?, str?, bool?)`).

The generator (`scripts/generate_cdp.py`) keeps experimental and deprecated items, adding a `@deprecated` decorator and doc tags. Enum `from_json` is `cls(json)` and raises on unknown values. An event that fails to parse is logged and dropped (`connection.py:955-964`), which is the drift failure mode (#249 `privateNetworkRequestPolicy` renamed in Chrome 146).

### Dispatch and domain reconciliation

The listener loop pops replies from `mapper`. For each event it spawns `asyncio.create_task(callback(...))`, or `asyncio.to_thread` for sync callbacks (`connection.py:976-983`). Callbacks are therefore unordered and unbounded. The earlier inline-await design deadlocked (#144).

`_register_handlers()` runs before every `send` (`:665-716`). It reconciles the registered handler types against the domains currently enabled and sends `domain.enable()` on demand. A Fetch handler with no patterns therefore pauses every request (#158). Domains that are no longer needed are dropped from the tracking list but never actually disabled.

### Stealth: what works and what leaks

`tab.evaluate` calls `Runtime.evaluate` with no `contextId` (`tab.py:842-870`), so no `Runtime.enable` is needed. However, the default `Element.click()` does two things (`element.py:418-442,921-1000`):
- It calls `flash(0.25)`, which inserts a `<div>` and writes a `@keyframes` rule into the page's own stylesheets.
- It runs `(el) => el.click()`, which dispatches an untrusted click (`isTrusted === false`).

The native `mouse_click` is documented as "likely does not work atm". nodriver's `expert=True` disables site isolation and forces shadow roots open, and the code admits "it is also being detected" (`nodriver/core/tab.py:1727-1731`). The lesson is that stealth fails through whichever path is weakest.

### Interception

`tab.intercept(pattern, stage, type)` is an async context manager (`core/intercept.py`). It calls `Fetch.enable` with a single pattern, resolves a future on the first match, and calls `Fetch.disable` on exit. That disable is global, so it can tear down other interceptors. Requests that match after the first one stay paused until the context exits. `expect_request`, `expect_response` and `expect_download` are subscribe-before-trigger context managers (`core/expect.py`).

---

## ferrum (Ruby; skimmed)

- **Transport.** It uses threads. Each command waits on a `Concurrent::IVar` with `pending.value!(timeout)`. A dead dispatch thread calls `release_pendings`, so waiters fail instead of hanging (`client.rb:218-243,340-367`).
- **Typed errors from strings.** `raise_browser_error` maps CDP message text to exception classes (`client.rb:374-392`): `"Cannot find context with specified id"` becomes `NoExecutionContextError`, and `"No node with given id found"` becomes `NodeNotFoundError`.
- **Two dispatch lanes.** `INTERRUPTIONS = %w[Fetch.requestPaused Fetch.authRequired]` run on a priority thread. Everything else runs on a regular thread (`client/subscriber.rb`). As a result, interception is never stuck behind slow regular handlers. Callbacks receive `(params, index, total)` so the last handler can decide whether to continue. `off(event, id)` deletes by array index, which shifts when other handlers are removed.
- **Targets.** Since 0.15 it uses one socket with flatten mode, which caused CI regressions (#470, 19c). Auto-attach is recursive with `waitForDebuggerOnStart`, re-armed on each new session (`contexts.rb:159-218`). Site isolation is disabled by default (`browser/options/chrome.rb:47`).
- **Idle.** `network.wait_for_idle(connections:, duration: 0.05, timeout:)` polls the pending-connection count (`network.rb:70-80`). Lazy iframes that never fire `frameStoppedLoading` block it (#583).

---

## Vibium (Go daemon + JS/Python/Java clients; WebDriver BiDi)

- **Architecture.** The `clicker` Go binary proxies BiDi between clients and the browser. It also implements `vibium:*` extension commands on the server side, and it exposes an MCP server and a CLI. Clients are thin. An element is just `(context, selector, index, semantic params)` and is resolved again on every action (`clients/javascript/src/element.ts:60-90`). That gives locator semantics, with no stale handles.
- **Actionability** (`clicker/internal/api/actionability.go:13-29`). It uses Playwright's matrix: `ClickChecks = {Visible, Stable, ReceivesEvents, Enabled}` and `FillChecks = {Visible, Enabled, Editable}`. One generated script resolves the element, scrolls it into view and runs every check except stability in a single round trip. Stability is checked in Go by comparing bounding boxes 50 ms apart. The poll interval is 100 ms. A timeout names the check that failed last: `"timeout after %s: %s check failed — %s"` (`:295-362`).
- **Cancellation.** Each session has a `modelContext`. Commands that were abandoned (cancelled or timed out) go into `abandonedInternal`, so late replies on the shared BiDi socket are dropped instead of being misrouted (`router.go:1270-1295`).
- **Pain points.** #128: before a dedicated reader existed, `page.route` deadlocked `page.go`. #397: writes had no deadline. #351: event setup was not awaited, so a fast trigger lost events.

---

## Cross-cutting comparison

| | chromedp | rod | chromiumoxide | pydoll | zendriver | ferrum | Vibium |
|---|---|---|---|---|---|---|---|
| Transport | 1 socket or pipe, flatten | 1 socket, flatten | 1 socket, flatten, user-polled `Handler` | socket per tab, plus ad-hoc sockets for OOPIFs | browser socket plus flattened sessions | 1 socket, flatten (since 0.15) | BiDi via daemon |
| Cancel in-flight command | waiter returns `ctx.Err()`; command still runs | waiter dropped; no reply on a closed session means a hang | drop before poll means never sent; after that, reply discarded | `wait_for` timeout removes it; a cancel leaves a stale entry | future dropped; detach fails pending | `IVar` timeout | tombstone the id |
| Event delivery | per-subscription unbounded queue (new API); blocking 1024/4096 queues (legacy) | global unbounded `goob`, filtered by session | unbounded per listener | unbounded queue, one ordered worker | a task per callback (unordered) | 2 thread lanes | single reader (after #128) |
| Dispatch scope | per session | global | per target | per socket (≈ tab) | per session | per session name | per session |
| Domain enabling | eager (Runtime, DOM, CSS, Network, …) | lazy; per-wait enable/restore, not ref-counted | eager incl. Runtime | lazy flags | reconciled from handlers, never disabled | eager per page | BiDi `session.subscribe` |
| Script without `Runtime.enable` | no | yes (`window` handle) | no | yes (isolated world, objectIds) | yes (`evaluate` without contextId) | no | n/a (BiDi realms) |
| OOPIF | dropped | needs site isolation off | iframe targets ignored | lazy attach on demand | partial | recursive auto-attach, site isolation off | BiDi contexts |
| Element waits | DOM mirror plus 5 ms poll | Sleeper backoff plus hit-test | none | poll `find(timeout)`, `wait_until` | 0.5 s poll | `wait_for_idle` poll | actionability matrix in one round trip |
| Interception | raw Fetch | goroutine per request; Go HTTP reload | NetworkManager | callbacks; exactly once | context manager; global `Fetch.disable` | priority lane | `Route`, race errors swallowed |
| Codegen | pdlgen: deprecated dropped, ~28k LOC | from `/json/protocol`, keeps all, ~35k | `quote!`, flags, 111k single file | hand-written TypedDicts | py-cdp generators, ~43k | none (raw dicts) | none (BiDi) |

---

## Ergonomics: what to steal, what to avoid

### Call sites at their best

**chromedp: typed values in, typed values out, and no output pointers** (`example_test.go:961-1000`, `action.go:204`):

```go
title, err := chromedp.Run(ctx, chromedp.Title())
res, err := chromedp.Call(ctx, page.GetFrameTree, cdp.Empty{})     // Command[P,R] value
_, err = chromedp.Run(ctx, chromedp.WaitEvent(page.LoadEventFired, nil,
    chromedp.Click(chromedp.ID("next"))))                           // subscribe, then trigger
```

**rod: a fluent chain whose budget covers the whole chain, plus a two-phase wait** (`examples_test.go:112-126,330-345`):

```go
page.Timeout(5 * time.Second).MustWaitLoad().MustElement("title").CancelTimeout().MustText()
wait := page.MustWaitRequestIdle()                // subscribes now
page.MustElement("#searchInput").MustInput("lisp")
wait()                                            // blocks until no requests are in flight for d
saveBtn.MustWaitStable().MustClick().MustWaitInvisible()
```

**pydoll: schema-driven extraction and expectation scopes** (`README.md:189-205,301-308`):

```python
class Quote(ExtractionModel):
    text: str = Field(selector='.text')
    tags: list[str] = Field(selector='.tag')
quotes = await tab.extract_all(Quote, scope='.quote', timeout=5)
async with tab.expect_cloudflare_turnstile():
    await tab.go_to(url)
```

**Vibium: one verb, implicit actionability, and errors that explain themselves.** `await (await vibe.find('a')).click()` either succeeds or fails with `timeout after 30s: receivesEvents check failed — …`.

### Call sites at their worst

**chromiumoxide: the user writes the event loop, and the README's version is fragile** (`README.md:20-30`):

```rust
let (mut browser, mut handler) = Browser::launch(cfg).await?;
let handle = tokio::spawn(async move {
    while let Some(h) = handler.next().await { if h.is_err() { break; } }   // one bad frame ends the browser
});
```

**pydoll and zendriver interception: untyped dicts and an obligation enforced only by the docs:**

```python
async def on_request(tab, event):
    request_id = event['params']['requestId']      # KeyError surfaces at runtime
    await tab.continue_request(request_id)         # forget this and the page hangs
await tab.enable_fetch_events()
await tab.on(FetchEvent.REQUEST_PAUSED, partial(on_request, tab))
```

**rod: a stateful sleeper factory whose example ignores the context** (`examples_test.go:354-370`):

```go
sleeper := func() utils.Sleeper {
    return func(context.Context) error { time.Sleep(time.Second / 2); return nil }   // not cancellable
}
el, _ := page.Sleeper(sleeper).Element("input")
```

**chromedp: a lifetime rule you can only learn from prose** (`action.go:37-41`): "Do not set a timeout on the context of that first call, because the timeout stops the whole browser."

### Friction catalogue

- **Ceremony.** chromiumoxide's mandatory handler task. pydoll's `partial(cb, tab)` and enable/on/disable triplets. rod's 1,172-line `must.go` doubling the API.
- **Footguns.**
  - rod's `Element` retries forever by default (`query.go:140`).
  - rod's `CancelTimeout()` panics if no timeout is set.
  - rod's `wait()` panics if called twice ("can't use wait function twice", `browser.go:379`).
  - zendriver's `Fetch.disable` on exit is global.
  - zendriver's `click()` mutates the page's stylesheets.
  - Synchronous listeners that call back into the browser (chromedp #455).
  - Non-ref-counted domain restore (rod `states.go:60`).
- **Confusing names.** chromedp's untyped string selector means `Search` (`DOM.performSearch`, which matches text, CSS or XPath), while `CSS` and `ID` are typed wrappers. rod's `Element`, `ElementR` and `ElementX` suffixes. zendriver's `await tab` meaning "wait for idle".
- **Hard to discover.** `chromedp.WithDetachOnCancel`. rod's `NotFoundSleeper` as the way to get "no retry". Pydoll's Literal-typed `raise_exc` overloads (nice once found).
- **Error messages.** chromiumoxide's `data did not match any variant of untagged enum Message` names neither the method nor the field. ferrum reaches typed errors by string-matching CDP messages. Vibium and rod show the good version: rod's `CoveredError{elAtPoint}` carries the element that covers the target, and Vibium names the failed check.

### How the internals make the good surfaces possible

- **`chromedp.Run(ctx, chromedp.Title())` returning a `string`** depends on a two-method `Session` interface (`Call`, `Subscribe`) plus generic `Command[P,R]` values. Everything above the transport is written once against `Session`.
- **Subscribe-before-trigger** (`WaitEvent`, rod's `wait := ...`, pydoll's `expect_*`) is only safe because subscriptions buffer without limit from the moment they are created (`session.go:127-131`). With a bounded or dropping queue, the combinator would silently lose events.
- **rod's chains are cancellable at every link** because each handle carries its own `ctx` and the context methods return clones. Configuration is propagated by value.
- **Vibium's "one verb, rich error"** works because actionability runs as one generated script, not N round trips, which makes the default auto-wait cheap enough to always be on.
- **pydoll's sync API never lags the async one** because it is generated.
- **chromiumoxide's `&Self` chaining** works only because every method is a thin message to a single owner task, and that same design forces the poll ceremony.

---

## Lessons and candidate abstractions for an Effect-native design

1. **Connection core: one fiber per socket, `Deferred` per command, replies before events.**
   - `CdpConnection` is a `Context.Service` built in a `Layer.scoped`. The reader is a scoped forked fiber. `pending: MutableHashMap<number, Deferred<Json, CdpError>>`.
   - A command is `Effect.uninterruptibleMask(restore => register.pipe(send, restore(Deferred.await)))` with `Effect.onInterrupt(() => tombstone(id))` (Vibium's `abandonedInternal`).
   - Document that interruption abandons the reply but not the side effect, because CDP has no cancel.
   - Losing the connection fails every pending `Deferred` with `ConnectionLost` (pydoll, ferrum). A session detach fails that session's commands with `SessionDetached`, so rod #283's hang cannot happen.
2. **Decode at the edge of each consumer, never in the reader.**
   - The reader decodes only the envelope `{id?, method?, sessionId?}`.
   - Params and results are decoded with the command's or event's `Schema` inside the caller's fiber, so a drift failure becomes a `DecodeError` for that one caller or subscriber (chromedp's `cdp.Events` already works this way).
   - Generated enums should be open: a literal union widened with `Schema.String` as a fallback, plus a branded `Unknown`. Experimental fields should be `optional`. This addresses the largest cross-library bug class (#167, #797, #249).
3. **Commands and events as values.**
   - `Page.navigate: Command<NavigateParams, NavigateResult>` and `Page.loadEventFired: Event<LoadEventFired>`.
   - `session.call(Page.navigate, {...})` returns `Effect<NavigateResult, CdpError | DecodeError>`, and `session.events(Page.loadEventFired)` returns a `Stream`.
   - This is cdproto's design (`cdp/types.go:41-118`), and it keeps generated code to types plus constants. That keeps bundles small and tree-shakeable: one module per domain, schemas built lazily.
4. **Events: a per-session `PubSub` with scoped subscriptions and an explicit policy.**
   - `PubSub.subscribe` already requires `Scope`, which is the subscription-lifetime story.
   - Use `unbounded` by default so subscribe-before-trigger stays lossless. chromedp, rod and chromiumoxide all chose unbounded. Offer `sliding(n)` for high-volume telemetry such as console output and screencast frames.
   - Provide `waitFor(event, {match, trigger})` as `Effect.scoped(subscribe → fork trigger → Stream.runHead filtered)`, the generalisation of `WaitEvent`/`expect_*`.
   - Handlers run in their own fibers (a `FiberSet` per subscription), never on the reader, which fixes the #455/#144 class.
   - Copy ferrum's lanes: `Fetch.requestPaused` and `authRequired` get a dedicated fiber per request.
5. **Domain enablement as a ref-counted resource.**
   - `RcMap<[SessionId, Domain], void>` whose acquire is `X.enable` and whose release is `X.disable`, with an idle TTL to avoid flapping.
   - A `Stream` of Network events acquires `Network` for as long as it runs. This fixes rod's non-ref-counted restore and zendriver's enable-forever, and it makes "enable nothing until asked" the default posture.
   - Encode the stealth constraint in the type: Runtime-event streams (`consoleAPICalled`, `executionContextCreated`) require a `RuntimeDomain` service that the `Stealth` layer does not provide. Code that needs them then fails to type-check under a stealth runtime.
6. **Realms resolved on demand, with Runtime-event tracking as a pluggable strategy.**
   - The `Realm` service has two strategies:
     - **Tracked**: `Runtime.enable` plus `executionContextCreated`. This is what Puppeteer, Playwright, chromedp and chromiumoxide do.
     - **On demand**:
       - a handle from `Runtime.evaluate("globalThis")` (rod);
       - `Page.createIsolatedWorld` for utility code (pydoll);
       - `DOM.resolveNode(contentDocument)` for frames (rod);
       - or rebrowser's "isolated `document`, then resolve in the main world" trick.
   - Cache the realm handle in a `ScopedRef`. Invalidate it on `ExecutionContextDestroyed` (normalised from `"Cannot find context with specified id"`), and retry with `Schedule.exponential("30 millis").pipe(Schedule.upTo("3 seconds"))`, which is rod's exact policy.
   - **Why this matters for scraping.** With Runtime enabled, Chrome reports console calls to the client and builds previews of the logged arguments, which reads their properties. A page can log an object with an instrumented getter, classically an `Error` whose `stack` is a getter, and detect the read. rebrowser-patches ([README](https://github.com/rebrowser/rebrowser-patches)) points to DataDome's write-up for this probe and offers `addBinding`, `alwaysIsolated` and `enableDisable` replacement modes. Patchright instead disables the console API ([ref](https://apiserpent.com/blog/puppeteer-stealth-still-works-2026)).
   - **Implication for an eager-enabling design.** A library that enables Runtime on attach, as chromedp and chromiumoxide do, cannot add stealth later, because its frame and realm model depends on those events. The decision has to be made at the architecture level.
7. **The `Scope` tree mirrors the target tree.**
   - The Browser `Layer` is an `acquireRelease` that launches the process (pipe transport, PDEATHSIG) and, on release, sends `Browser.close` with `Effect.timeoutOrElse` before falling back to kill.
   - Below it: BrowserContext scope, then Page scope (`createTarget`/`closeTarget` plus "wait until gone", chromedp's 500 ms), then Frame, then Realm.
   - Finalizers are uninterruptible, so bound each one (chromedp's 5 s `closeTargetTimeout`). Provide a `detach` finalizer variant (`WithDetachOnCancel`).
   - This removes chromedp's "first Run binds the browser" footgun: the browser's lifetime comes from the Layer, and per-action timeouts are just `Effect.timeout`.
8. **Waiting = `Schedule` + one-round-trip predicates + typed timeouts.**
   - Replace rod's `Sleeper` factories with `Schedule`, which is already a description and needs no factory. Default to `Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.either(Schedule.spaced("1 second")))`, combined with a mandatory overall deadline, so nothing hangs the way `rod.Element` can.
   - A `Locator` is a value that is re-resolved on every action (Vibium). Actionability is a single generated function over the matrix.
   - Failures are `ActionabilityTimeout { check: "receivesEvents", hitTarget: Option<string>, last: Duration }`.
9. **A real `race`.**
   - `Effect.raceAll(locators.map(waitFor))` interrupts the losers. That is a one-liner in Effect but not in Go: rod's `Race` is a sequential poll.
10. **Stability as streams.**
    - Track in-flight requests as a `SubscriptionRef<HashSet<RequestId>>`, excluding long-lived types (rod's list) and de-duplicating redirects.
    - Network idle is `changes |> Stream.debounce(d) |> filter(empty)`.
    - DOM stable is a mutation-count stream, which is cheaper than rod's LCS over snapshots.
    - Element stable is a bbox comparison across two `requestAnimationFrame`s.
    - `waitStable = Effect.all([load, networkIdle, domStable], {concurrency: "unbounded"})`.
11. **Interception: the type system enforces resolve-exactly-once.**
    - The route handler is `(req) => Effect<Decision>`, where `Decision = Continue(overrides) | Fulfill(resp) | Fail(reason) | Fallthrough`. The router, not the user, issues the `Fetch.*` call.
    - On defect or interrupt, `Effect.onExit` defaults to `Continue`, so nothing stays paused.
    - Each request runs in its own fiber in a `FiberSet`.
    - Fetch patterns are the union of active routes, maintained by an `RcMap`, which avoids zendriver's global `Fetch.disable`.
    - Response bodies are a `Stream` from `Fetch.takeResponseBodyAsStream`, not rod's out-of-browser `http.Client` replay.
    - Proxy authentication shares the router instead of competing for `Fetch` (pydoll #353).
12. **One typed error vocabulary, normalised once.**
    - `ProtocolError{code, message, method}`, `TargetClosed`, `SessionDetached`, `NodeNotFound`, `ExecutionContextDestroyed`, `CommandTimeout{method}`, `DecodeError{method, issue}` and `ConnectionLost{reason, exit}`, built with `Schema.TaggedError` and mapped in one place (ferrum's `raise_browser_error`).
    - Include the browser's exit status, as chromedp does with `withExitError`.
13. **Targets: recursive auto-attach done correctly, with lazy attach as the stealth alternative.**
    - Call `setAutoAttach{flatten, waitForDebuggerOnStart}` again on every new session. Finish setting up each session (subscriptions, enables), then always call `runIfWaitingForDebugger` (chromiumoxide #163 shows the stall when it is missing).
    - OOPIFs become child `Frame` scopes carrying their own session, held in a `FiberMap`/`RcMap` keyed by `FrameId`.
    - Never default to `--disable-site-isolation-trials`. It is detectable and fails silently on browsers launched elsewhere (rod #1234).
14. **API surface.**
    - Methods on handles are `Effect.fn`-traced; the spans replace rod's `tryTrace`.
    - Data-first, composable actions (`Action<A, E, Page>` is just `Effect<A, E, Page>`) let you write a test step once and run it under a `Page` provided by a test, a scraper pool (`Pool.make` over pages) or an agent.
    - No `Must*` twin is needed: typed errors plus `Effect.orDie` cover the scripting case.
15. **Code generation policy.**
    - Generate from PDL, pinned per Chromium major with tags in the form `x.<major>.y` (cdproto).
    - Include experimental items, annotated with `@experimental` JSDoc and optional by default. Exclude deprecated items unless explicitly allowed (chromiumoxide's `allowed_deprecated_type`).
    - Emit open enums and per-domain modules, plus a drift test that decodes recorded traffic from the oldest and newest supported Chrome.

---

## Open questions

1. **Default queue policy.** Should event streams default to unbounded, which is correct for subscribe-before-trigger but risks memory growth from `Network.*` floods, or should the default be bounded with a typed `Overflow` failure? chromedp chose unbounded and simply documents the growth.
2. **Interruption with side effects.** Should interrupting an in-flight `Page.navigate` also issue `Page.stopLoading`? Should interrupting a `Runtime.evaluate{awaitPromise}` call `Runtime.terminateExecution`? Or is "abandon the reply" enough?
3. **Stealth as types or as a runtime flag.** Is a compile-time stealth capability (no `RuntimeDomain` service) ergonomic enough, or will users want to switch modes at runtime per page?
4. **OOPIF strategy per mode.** Should the stealth profile use eager recursive auto-attach, as Playwright does, or lazy on-demand attach (pydoll), which avoids `waitForDebuggerOnStart` stalls but misses early events in the frame?
5. **Schema cost.** At about 600 types per Chromium major, do lazily built `Schema`s keep bundle size and startup acceptable? Should raw passthrough (pydoll's TypedDict approach) be offered for hot paths such as screencast frames?
6. **BiDi parity.** Vibium's locator and actionability design ports cleanly to BiDi. CDP-specific primitives (Fetch stages, isolated worlds, `DOM.getNodeForLocation`) need an abstraction that does not leak, or BiDi-only and CDP-only capability services.
7. **Do the idle heuristics belong in the core?** Should network-idle, DOM-stable and zendriver-style "socket quiet" waits ship in the core library, or as opt-in modules given how often they mislead (ferrum #583, chromiumoxide #184)?
