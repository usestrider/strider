# PROTOCOL: transports, protocol clients and backend adapters (L0)

*Revision 5.25, 2026-10-19; CDP code generation, the transports and the CDP client built 2026-10-19; the client's timeouts, late replies and validation modes, and the ingestion pipeline, built 2026-10-20. A condensed sketch drawn from draft 4 of the native model (commit `6cc0bc1`) and the research notes, especially `research/effect-building-blocks.md`, `research/non-js-cdp-clients.md`, `research/puppeteer-and-chromium-bidi.md`, `research/webdriver-bidi.md` and `research/webkit.md`.*

## Purpose

L0 moves protocol messages, decodes them, keeps events in order, and maps each backend's protocol onto the native model ([CONCEPTS.md](CONCEPTS.md)). It owns protocol ids, session trees, attach-and-configure mechanics, code generation and capability evidence. It decides no policy.

## Top data models

```ts
// ── Transport: framed text, no reconnect ──────────────────
interface Transport {
  send(message: string): Effect<void, ConnectionLost>            // fails fast after close
  readonly messages: Stream<string, ConnectionLost>               // exactly one consumer: the dispatcher
  readonly closed: Effect<ConnectionLost>
}

// ── Generated protocol definitions ────────────────────────
interface CommandDef<M extends string, P, A> {
  (...params: [P] extends [void] ? [] : [params: P]): Command<M, P, A>   // yieldable value
  readonly method: M
  readonly Params: Schema.Codec<P, unknown>
  readonly Result: Schema.Codec<A, unknown>
  readonly compensation?: CompensationKind                       // e.g. input release, paused-request resolution
}
interface Command<M extends string, P, A> extends Effect<A, ProtocolError, ProtocolSession> {
  readonly method: M
  readonly params: P
}
interface EventDef<M extends string, A> {
  readonly method: M
  readonly Params: Schema.Codec<A, unknown>
}

// ── Sessions ──────────────────────────────────────────────
interface ProtocolSession {
  readonly key: SessionKey                                        // CDP sessionId, BiDi routing key, WebKit pageProxyId/targetId
  send<M extends string, P, A>(command: Command<M, P, A>): Effect<A, ProtocolError>
  subscribe<M extends string, A>(event: EventDef<M, A>, options?: {
    readonly prefilter?: MetadataFilter                           // declarative, run before buffering
    readonly buffer?: "lossless" | { sliding: number }
  }): Effect<Stream<A, SessionEnded>, never, Scope>               // live when this returns
  readonly ended: Effect<SessionEnded>
}

type ProtocolError =
  | { _tag: "Rejected"; method: string; reason: RejectReason; code: number | string; message: string }   // code and message sanitized, kept as evidence
  | { _tag: "Decode"; method: string; issue: string }
  | { _tag: "SessionEnded"; reason: SessionEndReason }
  | { _tag: "Unsupported"; method: string }
type RejectReason = "NoSuchTarget" | "NoSuchFrame" | "NoSuchNode" | "InvalidArgument" | "Unrecognized"
type SessionEndReason = "detached" | "targetDestroyed" | "connectionLost" | "swapped"

// ── Error matchers: one table per backend, data ───────────
interface ErrorMatcher {
  readonly match: { code?: number | string; message?: string | { includes: string } | { matches: string } }
  readonly becomes: "Unsupported" | { SessionEnded: SessionEndReason } | { Rejected: RejectReason }
  readonly evidence: string                                       // the probe or recorded trace behind the entry
}
```

## Transports

| Transport | Details |
|---|---|
| **Pipe** (launched Chromium; patched WebKit) | fd 3 in, fd 4 out, NUL-framed JSON. One long-lived outbox stream feeds fd 3, because a finite stream would send EOF and disconnect the browser. Spawned with `forceKillAfter`, and stderr is drained or ignored |
| **WebSocket** (remote CDP, BiDi, iOS) | Through the `Socket.WebSocketConstructor` in context. Headers are allowed for remote providers. The constructor sets the largest message: 128 MiB for Node's built-in WebSocket |

- **One reader per connection.** Writes fail promptly after close. Effect 4.0.5's `Socket` writer *waits* for a reconnection after a disconnect, so L0 wraps it to fail instead.
- **No reconnect.** A new connection is a new model namespace (CONCEPTS.md §1).

**Built** (2026-10-19). `@usestrider/browser/protocol` exports `Transport`: `pipe(handle)` over a process spawned with `Transport.pipeFds`, and `webSocket(url, options?)` through the `Socket.WebSocketConstructor` in context. Both are our own small, fail-fast transports; neither goes through Effect's `Socket`, so there is nothing to wrap.

- **Errors.** `TransportError` has two reasons. `ConnectFailed`: refused, rejected at the handshake, or not open within `openTimeout` (default 10 seconds). `ConnectionLost`: its `initiator` is `local` when our scope closed it and `remote` when the browser closed its pipe, exited or closed the socket, and its `description` says which.
- **Closing a pipe** ends file descriptor 3, and Chrome then exits with code 0 on its own (an integration test checks the exit code). The writer outlives the transport's scope for that: interrupting it would leave the pipe open. The process's own scope still terminates the browser.
- **Message limits, measured** with Chromium 155 and Node 24.21:
  - Chrome sends 200 MiB replies over both transports.
  - Node's built-in WebSocket (undici) closes the connection with code 1006 on a message over 128 MiB, its default `maxPayloadSize`. `ws` stops at 100 MiB unless `maxPayload` is raised; with it raised to 256 MiB, a 200 MiB reply arrives. `NodeSocket.layerWebSocketConstructor` uses the first, or the second when headers are given.
  - The pipe has no limit of its own. A 300 MiB reply took 1.7 seconds through `CdpConnection`, against 1.35 seconds for 200 MiB read by plain Node.
  - No transport can deliver a message longer than V8's longest string, 2^29 − 24 characters. Chrome escapes non-ASCII text as `\uXXXX`, six bytes a character, so a string of 100 million accented characters is a 600 MB message. Such a message loses the connection, and the description says why. A probe found that, before this was handled, the reader died on it and the command waited forever.
- **No `ws` constructor of our own** (decided 2026-10-19, below). Until Effect's Node constructor passes `ws` options through, a remote endpoint's replies are limited to 128 MiB; launched browsers use the pipe.

## Protocol client

- **Commands are yieldable values.** `yield* Page.navigate({ url })` runs on the session in `R`, and `.pipe(Protocol.on(session))` picks a session explicitly.
- **Pending map.** Pending commands sit in a map from id to resumer. Interrupting the caller removes its entry and tombstones the id, so a late reply is dropped. Replies to commands that create resources are still routed to their owner for adoption or cleanup.
- **No remote cancel.** No protocol can cancel a command; interruption only abandons the reply. Compensation metadata on generated commands tells L1 what to undo, for example releasing input or resolving a paused request.
- **Timeouts** come from the operation deadline (L1), with a protocol-level fallback default for raw L0 use.
- **Errors are classified once, at this boundary,** by a per-backend table of `ErrorMatcher`s. The result is always one of the tags above; the tables never add tags.
  - Every field of a matcher must match. The most specific matcher wins (one point per field), and ties go to table order.
  - BiDi entries mostly match the spec's error codes (`no such node`, `unknown command`). CDP and WebKit return most failures as `-32000` plus text, so their entries match messages.
  - A reply that nothing matches becomes `Rejected{Unrecognized}`, never a guess.
  - The tables live in `overlay/`, and each entry cites its evidence (probe 24). A `RejectReason` that no table produces is removed.
  - Above L0, error handling never matches message text. L1 maps reasons using its own state, for example `NoSuchNode` becomes `StaleRef{Detached}`.

**Built for CDP** (2026-10-19). `CdpConnection.make(transport)` starts one reader in its scope, on a client every backend will share (`src/internal/protocolClient.ts`); BiDi and WebKit bring their own envelope, lifecycle and table. `browser` is the browser's own session, and `session(sessionId)` returns a session the browser announced with `Target.attachedToTarget`.

- **The reader is synchronous and never waits on a consumer.** It parses the envelope, resolves the pending reply, applies the session lifecycle and offers events to subscriber queues. Results are decoded by the caller and event parameters by each subscriber, in their own fibers, so a payload that doesn't match its codec fails one call or one subscription. Anything that stops the reader, a defect included, ends the connection.
- **Sessions form a tree.** `attachedToTarget` registers a session under the session it arrived on, and it arrives before any message on the new session and before the `attachToTarget` reply (recorded). `detachedFromTarget` ends the session and its children. A session that ends fails its pending commands and its subscriptions with `SessionEnded`, and later sends fail at once without reaching the wire.
- **Interruption** removes the pending entry; a late reply finds none and is dropped.
- **The error table** has six rows, recorded against Chromium 155, each citing its evidence:

  | Reply | Becomes |
  |---|---|
  | `-32601` (JSON-RPC "Method not found": `'Nope.nothing' wasn't found`) | `Unsupported` |
  | `-32602` "Invalid parameters" | `Rejected{InvalidArgument}` |
  | `-32602` "No target with given id found" | `Rejected{NoSuchTarget}` |
  | `-32602` "No frame for given id found" | `Rejected{NoSuchFrame}` |
  | `-32000` "Could not find node with given id" | `Rejected{NoSuchNode}` |
  | `-32001` "Session with given id not found." | `SessionEnded{detached}` |

  An integration test sends each case to a real browser and checks that the reply still matches its row, which is the first half of the drift test. `-32000` "Cannot find context with specified id", for an unknown execution context or remote object, stays `Unrecognized`, because no `RejectReason` fits it yet.
- **Tests:** 14 against a scripted browser, and 7 against Chromium 155: both transports, a failed connection, a closed target, a killed browser, a clean exit, and the error table. The Chromium suite uses `STRIDER_CHROMIUM`, or the first Chromium or Chrome on `PATH`, and is reported as skipped without one.
- **Where the build differs from the sketch above:**
  - `ProtocolSession.key` is `undefined` for the browser's own session, which CDP doesn't key;
  - a command carries its `definition`, which is where the session finds its codecs;
  - parameters that don't match their codec fail with a new reason, `Encode`, and nothing is sent. A command whose parameters are all optional, called with none, sends none;
  - transports fail with `TransportError` (`ConnectFailed` or `ConnectionLost`), where the sketch had a bare `ConnectionLost`;
  - the error table is data next to the client's code (`src/internal/cdpWire.ts`), not in `overlay/`: the client reads it at run time, nothing is emitted from it, and the integration test holds each row to its evidence;
  - subscriptions were unbounded, or sliding without a gap marker, until the ingestion pipeline was built (2026-10-20, below).

**Built** (2026-10-20): the rest of the client, for every backend.

- **Timeouts.** A command waits for its reply for at most `Protocol.CommandTimeout`, a `Context.Reference` that is 30 seconds unless set (the same as L2's default budget), and then fails with a new reason, `NoReply`. `Protocol.withCommandTimeout` sets it for an effect, and `Duration.infinity` turns it off. L1 will set it from the operation's deadline. It runs on Effect's `Clock`, so scripted tests drive it with `TestClock`.
- **Late replies.** A command whose `createsResource` trait is set keeps its pending entry when its caller is interrupted or times out, and a reply that arrives but wasn't consumed counts as late too. The reply goes to the handler in `Protocol.CurrentLateReplyHandler`, read from the caller's context when it sent the command, and runs in a fiber of the connection's. A `LateReply` carries the session, the method, the parameters, the raw result and `release`.
  - `release` sends the command's release commands, which a new overlay trait names. Each takes one parameter from the result by JSON pointer, where `*` stands for every element of a list: `createTarget` → `closeTarget`, `createBrowserContext` → `disposeBrowserContext`, `attachToTarget` → `detachFromTarget`, `addScriptToEvaluateOnNewDocument` → `removeScriptToEvaluateOnNewDocument`, the remote objects in `evaluate`, `callFunctionOn`, `getProperties`, `compileScript` and `resolveNode` → `releaseObject`, and the streams of `takeResponseBodyAsStream` and `printToPDF` → `IO.close`. Code generation checks that each release names a command, one of its parameters, and a path through the result, so a roll that moves one fails the build.
  - The default handler releases. L1 will set one that adopts the resource into its owner, or releases it. `createIsolatedWorld` has no release command; its world lasts as long as its document.
- **Validation.** `Protocol.CurrentValidation` is `"decode"` unless set; `"trust"` skips codecs that only check, and still runs those that transform, such as a sensitive member becoming `Redacted`, so trust never leaks a secret as a plain string. Whether a codec only checks is read from its schema AST once and cached. Encoding always runs.
- **Tests:** 23 against a scripted browser now, 10 more for the pipeline with a fold, and the 7 against Chromium.
- **Not built yet:** the backend adapter.

## Code generation

```
CDP JSON ────┐                              patches/   corrections, audited
BiDi CDDL ───┼─ parse ─▶ protocol model ─▶  overlay/   our annotations       ─▶ emit ─▶ generated modules
WebKit JSON ─┘           (committed)                                                   (committed)
```

| Backend | Source (vendored and pinned) |
|---|---|
| CDP | `devtools-protocol` PDL/JSON, pinned per Chromium major |
| BiDi | the spec's CDDL, plus extension specs and vendor grammars (Selenium's normalizer is the model) |
| WebKit | the `protocol.json` shipped inside each Playwright WebKit build; the upstream inspector JSON for stock WebKit |

```ts
interface ProtocolModel {                        // one committed JSON file per backend revision
  readonly backend: "cdp" | "bidi" | "webkit"
  readonly revision: string                      // Chromium major, spec commit, WebKit build
  readonly shapes: Record<ShapeId, Shape>        // keyed "Domain#Name", never by array position
}
type Shape =
  | { kind: "command"; params: ShapeId; result: ShapeId; traits: Traits }
  | { kind: "event"; params: ShapeId; traits: Traits }
  | { kind: "struct"; members: Record<string, Member>; traits: Traits }
  | { kind: "union"; by: "discriminator" | "shape" | "requestId"; cases: ReadonlyArray<ShapeId>; traits: Traits }
  | { kind: "enum"; values: ReadonlyArray<string>; traits: Traits }
  | { kind: "id"; brand: string; traits: Traits }                // CdpTargetId, BidiContextId, …
  | { kind: "list" | "map" | "scalar"; … }
interface Traits {                               // spec facts plus overlay annotations
  readonly status: "stable" | "experimental" | "deprecated"
  readonly sensitive?: true                      // decodes as Redacted
  readonly compensation?: CompensationKind
  readonly createsResource?: true                // late replies route to an owner for adoption
  readonly session?: "browser" | "target"
}
```

**Pipeline:**

- **Committed model and output.** Three parsers produce one protocol model per backend revision. It is keyed by name, so patch pointers survive browser rolls (CDP's own JSON uses arrays whose indexes shift). One emitter writes formatted modules. CI never regenerates; it checks that regeneration reproduces what is committed. A regeneration is a deliberate change whose diff names the commands and events that were renamed or removed.
- **Corrections** (`patches/`) are claims that a spec is wrong about the wire. They are JSON patches over the model, applied with Effect's `JsonPatch`. Each file says what the spec states, what the browser does, and the probe or recorded trace that showed it, so it doubles as the upstream bug report. A pointer that no longer resolves fails the run. On each browser roll an audit rebuilds without each file and lists the ones the new spec has absorbed.
- **Annotations** (`overlay/`) are our own semantics, which no upstream will absorb, so the audit skips them: id brands, compensation, resource-creating commands, session scope, sensitive members and the error matcher tables.
- **Coverage report.** Every spec item is emitted, excluded by policy or approximated, with a reason code, in a committed report. A roll's diff shows anything newly dropped. Nothing is dropped silently.

**Policy:**

- **Shape of the output.** Domain modules with per-kind branded ids, so ids never cross protocols or kinds, and `Schema.Opaque` named types.
  - Each type is a hand-emitted interface plus a codec cast to it (`export const X = Schema.suspend(() => …) as any as Schema.Codec<X>`), so the compiler never infers types from schema generics. Recursive types (DOM nodes, stack traces) are emitted in dependency order.
  - Types-only declarations are kept separate from codecs: one model, two renderers.
  - Every top-level call is `/*#__PURE__*/`, including the call a class extends, so unused domains tree-shake.
  - Commands and events are data: a method, codecs and traits. All behavior lives in the hand-written client, so a behavior change never needs a regeneration.
- **Sensitive members decode as `Redacted`**: cookie values, auth credentials, `Authorization` headers, inserted text. L0 traffic captured in diagnostics therefore can't leak secrets.
- **Measured, not gated:** typecheck time and memory, and bundle size per subpath, recorded on each regeneration.
- **Tolerance.**
  - Enums are open in both directions: known literals plus a string fallback, in output types too, so an unknown value never arrives typed as a known one.
  - Experimental fields are optional.
  - Deprecated items are excluded unless explicitly allowed.
  - BiDi unions are generated by kind: discriminated, ordered-by-shape, or correlated by request id.
- **Validation is a policy:** `decode` (JIT-compiled, the default) or `trust`. The reader decodes only the envelope; each consumer decodes params in its own fiber, so protocol drift fails one consumer rather than the connection.
- **Drift test.** Recorded traffic from the oldest and newest supported browsers must decode, and recorded error replies must classify as they did when recorded, so a browser that rewords an error fails the test instead of quietly becoming `Unrecognized`. Patched WebKit additionally checks its `protocol.json` at launch and fails with `BrowserError{IncompatibleRevision}`.

**Built for CDP** (2026-10-19). `pnpm codegen:protocol` runs the pipeline; `pnpm check` regenerates in memory and fails if anything differs from what is committed.

- **Layout.** `packages/tools/codegen/protocols/cdp/` holds the vendored source (`source/`, devtools-protocol 0.0.1696802, the revision Puppeteer 25.14 pins for Chrome 155), `patches/`, `overlay/`, and the committed `model.json` and `coverage.json`. The tool is `packages/tools/codegen`, an Effect program.
- **Output.** 56 domain modules in `packages/browser/src/cdp/`, published as `@usestrider/browser/cdp`, with 603 types, 619 commands and 223 events. The 150 deprecated items no emitted shape references are excluded, and 32 are approximated (`any`, and objects the spec leaves untyped), each recorded in `coverage.json`. They target `@usestrider/browser/protocol`, the hand-written `Protocol` module: `CommandDef`, the yieldable `Command`, `EventDef`, `ProtocolSession`, `Protocol.on` and `ProtocolError`.
- **Overlay so far:** 37 id brands, 9 sensitive members, 59 browser-session commands, input compensation, and 12 resource-creating commands, each file stating its reason. There are no corrections yet; they come from probes.
- **Measured:** the whole workspace, 68,000 generated lines included, type-checks from clean in 0.4 s and about 340 MB with TypeScript 7.
- **Where the build differs from the sketch above:**
  - named types that are neither structs nor enums are `Alias` shapes, and the overlay's `id` trait brands them, because the parser can't tell an id from a string;
  - shapes are tagged with `_tag`, as Effect's are, rather than `kind`;
  - one module per domain holds both the interfaces and the codecs, rendered by separate functions, with a separate types-only output deferred until something needs it;
  - an import that would collide with a module's own names is renamed (CDP's `SmartCardEmulation` has a type named `Protocol`).
- **Next:** the transports and the CDP client are built (Transports and Protocol client above). The error table's next rows, and the rest of the drift test, come from probes recording real traffic. BiDi's CDDL and WebKit's JSON get their parsers when those backends start; the correction audit is built with the first correction.

## Ingestion pipeline

```
transport ─► dispatcher ─► per-session ordered fold ─► publisher ─► subscriber buffers ─► subscriber workers
             (envelope,     (updates L1 state           (declarative     (bounded; lossless     (caller predicates,
              receive seq)   before publishing)          prefilters)      or sliding)            body/schema checks)
```

1. **Dispatcher.** It assigns a local receive sequence, routes replies to pending records, and routes events to their session's fold. Reply delivery never waits for consumers or enrichment.
2. **Fold.** It decodes required events and updates authoritative state *before* publishing. It never awaits commands, user code or enrichment. Cross-session rules use identity and generations, never wire order.
3. **Integrity.** A required event that won't decode, or a full core queue, marks the session `ModelUnavailable` and wakes its waiters. The session resumes only after a backend snapshot is reconciled with the buffered events; if that isn't possible, the session ends. Envelope corruption ends the connection.
4. **Buffering.** Core queues have item and byte limits, and hitting one is an integrity failure, never a silent drop. Subscribers have their own bounded buffers: lossless consumers fail with `EventOverflow`, sliding consumers get a gap marker. Traffic excluded by a declarative prefilter never consumes a subscriber's buffer. Terminal signals never need free buffer space.
5. **Enrichment** (cookies for a paused request, node descriptions) is lazy or published separately with correlation ids. It never delays obligations or the fold.
6. **`drainObserved`** waits until the fold has processed every event received *up to now* on selected sessions. It is a local processing barrier, not proof that everything a command caused has arrived.
7. **Ordering.** Order is guaranteed per session only. Handlers never run on the reader or the fold.

**Built** (2026-10-20), in the client every backend shares (`src/internal/protocolClient.ts`):

- **Dispatcher and worker.** The reader numbers every message it receives, replies included, resolves replies, applies the session lifecycle, and queues events. One worker per connection takes them in that order: it decodes and folds the events the fold names, then publishes to subscribers. One worker rather than one per session, because decoding is synchronous work on one thread either way, and per-session order follows from the global order.
- **The fold** is a backend adapter's, given when the client is made: the events it needs, `apply`, `lost`, `resync` and `ended`. Every hook runs in the worker and must not wait. `CdpConnection` has none, so its worker only publishes. A fold that fails is a bug, and ends the connection with that description rather than leaving everything waiting on a worker that's gone.
- **Integrity.** A session may have 10,000 events or 256 MiB (UTF-8 bytes of message text) queued for the worker. Going past either discards everything it has queued; a folded event that won't decode is skipped. Either way the fold's `lost` wakes the model's waiters, and its `resync` rebuilds the model in a fiber of its own and returns the receive sequence its snapshot accounts for. Events that arrive meanwhile are published, and held, within the same limits; once the snapshot is in, those after its sequence number are folded on top. A resync that fails, or that is overrun, ends the session with a new `SessionEnded` reason, `modelUnavailable`. Without a fold, an overrun only discards.
- **Subscriber buffers** are bounded. `{ lossless: n }` (default 10,000) fails with a new reason, `EventOverflow`, after delivering what it kept; `{ sliding: n }` drops its oldest event and leaves a `Protocol.Gap` with the count where it was, so a sliding stream is typed `Stream<A | Gap>`. Events discarded upstream count against both. Gaps and terminal signals take no space.
- **Prefilters** are a typed deep-partial of the event's parameters (`{ frame: { id } }`), matched against the raw parameters before buffering, so excluded events take no space and no user code runs on the worker.
- **Live means from now.** A subscription sees only events received after `subscribe` returns, even ones the worker hasn't published yet.
- **Ends in order.** A session that ends fails its pending commands at once, but its subscriptions end with `SessionEnded` only after the events received before the end; the fold hears of the end first, then subscribers, then `ended`.
- **`drainObserved`** is on every `ProtocolSession`: it waits until every event the session received before the call has been folded and published. Combine sessions with `Effect.all`.
- **`sendSequenced`**, on the internal session, returns a reply's receive sequence alongside its result, so a resync can say which events its snapshot covers.
- **Not built yet:** enrichment (step 5), which belongs to the adapter.

## Backend adapters

```ts
interface BackendAdapter {
  readonly info: BackendInfo                                     // product, version, protocol revision
  readonly capabilities: SubscriptionRef<CapabilitySet>          // static profile, refined by probed evidence
  connect(transport: Transport): Effect<AdapterConnection, BrowserError, Scope>   // ConnectionFailed, IncompatibleRevision
}
interface AdapterConnection {
  readonly model: ModelSink                                      // feeds the L1 fold: created/ended/changed facts with evidence
  readonly correlation: Effect<CorrelationTables>                // L1 ids ⇄ protocol ids, per session generation; held in a Ref
  initialize(target: TargetRef, revision: DeclarationRevision): Effect<Ready, InitializationFailed>
  apply(declaration: Declaration): Effect<Acknowledged, DeclarationError>   // compile per backend; acknowledge or fail
  resolve(obligation: Obligation, decision: Decision): Effect<Acknowledged, ProtocolError>
  dispatchInput(page: NavigableId, gesture: CompiledGesture): Effect<GestureEvidence, ProtocolError>
  evaluate(realm: RealmId, call: EvaluationCall): Effect<RemoteResult, ProtocolError>
}
```

Adapter responsibilities:

- **Correlation.** Keep L1 ids stable across protocol churn:
  - CDP: out-of-process-iframe swaps (`frameDetached{swap}` followed by an iframe target), and prerender activation, where the main frame is re-keyed.
  - WebKit: provisional pages (`didCommitProvisionalTarget`).
  - BiDi: route events to sessions client-side, because the wire carries no subscription id.
- **The initialization gate** (a `Latch`). Configure a target before its scripts run, then publish it as Ready:
  - **CDP:** `setAutoAttach{flatten, waitForDebuggerOnStart}`, applied recursively. Configure while paused (frame-tree snapshot, events buffered until the tree is known, required declarations), then `runIfWaitingForDebugger`, always run in a finalizer.
  - **WebKit:** `Target.resume`.
  - **BiDi:** native scoped declarations.

  Required failures fail initialization. The gate runs again after every session swap.
- **Declaration compilation.**
  - Preload bundles compile to one entry point per world, so the adapter owns their order.
  - Intercepts compile to reconciled backend patterns.
  - Overrides are serialized per physical scope.
  - The page clock compiles to an environment-phase script that replays the clock's operation log.
- **Obligation delivery** to the protocol (`Fetch.*`, `network.*`, `handleJavaScriptDialog`, `handleUserPrompt`, `Dialog.*`).
- **Capability evidence.** Probe only in owned, disposable targets or with read-only checks, never by mutating adopted pages. Cache results per backend revision and configuration, in a `Cache`.
- **Domain enablement** goes through an `RcMap` keyed by session and domain: the first subscriber enables a domain, and the last scope to close disables it (principle 8).

### Pause-on-start granularity

Before-author-script setup for *new* targets needs them paused at creation. Granularity differs by backend, and the access model depends on it.

| Backend | Granularity (to be confirmed by probe 22) |
|---|---|
| CDP | browser-wide auto-attach filters by target *type*; `autoAttachRelated` covers frames and workers of one target, but popups are unconfirmed |
| BiDi | not needed: declarations are scoped natively by context or user context |
| Patched WebKit | per page proxy; popup behavior unconfirmed |

The capability is `pauseScope: "context" | "related" | "opener" | "browser"`. A declaration that needs `beforeAuthorScript` on targets the available granularity can't isolate fails with `Unsupported`. Observe-only targets are never paused.

## Backends and order

Each backend ships as its own subpath export (`@usestrider/browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provides the `Browser` service, so unused protocol code is never loaded. Generated L0 commands are available raw at `@usestrider/browser/cdp` (and later `/bidi-protocol`) for power users.


1. **CDP:** launched Chromium; remote endpoints.
2. **BiDi:** Firefox, plus Chrome over chromium-bidi as a cross-check.
3. **WebKit inspector:**
   - a *patched* profile for Playwright's builds, revision-pinned because about 27% of rolls change the protocol;
   - an attach-only *stock* profile for iOS, WKWebView and the WebKitGTK inspector.
4. **Experimental BiDi profiles:** Safari Technology Preview (needs `safari:experimentalWebSocketUrl`) and WebKitGTK/WPE (about 23% of WPT).

### Capability snapshot

This is a planning inventory from the research, not a conformance result. `?` means it still needs a probe.

| Capability | CDP | BiDi Chrome | BiDi Firefox | WebKit patched | WebKit stock | Safari BiDi (STP) |
|---|---|---|---|---|---|---|
| own process / headless | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | attach-only | ✓/✗ |
| user contexts | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| isolated worlds (`inspect`) | ✓ | ✓ | ✓ | ✓ | ✗ | partial |
| pause-on-start scope | type-wide (probe 22) | declarative | declarative | per page proxy (probe 22) | partial | n/a |
| input fidelity | native | webdriver | webdriver | native | synthetic | webdriver |
| network events / interception | ✓ / req, resp, auth | ✓ / req, resp, auth | ✓ / req, resp*, auth | ✓ / req | ✓ / req, resp | ✗ / ✗ |
| body access | buffered + stream | collectors | collectors | ✓ | ✓ | ✗ |
| console | ✓ (needs Runtime) | ✓ | ✓ | ✓ | ✓ | ✗ |
| prompts / file chooser / downloads | ✓/✓/✓ | ✓/✓/✓ | ✓/✓/✓ | ✓/✓/✓ | shim/✗/✗ | ✓/✗/✗ |
| screencast / PDF / AX tree | frames/✓/✓ | ✗/✓/✗ | file/✓/✗ | frames/✗/partial | ✗/✗/partial | ✗/✗/✗ |
| evaluation with user activation | ✓ | ✓ (probe 20) | ✓ (probe 20) | ✓ | ? | ? |
| page time: virtual / injected | ✓/✓ | ✗/✓ | ✗/✓ | ✗/✓ | ✗/? | ✗/? |
| WebSocket frames | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| event-listener listing (snapshot evidence) | ✓ | via `goog:cdp` | ✗ | ? | ? | ✗ |

\* Firefox accepts a `provideResponse` body only at the request phase.

## Open questions

None. Decided:
- **Codegen route:** our own emitter over a committed protocol model, with audited corrections and a separate overlay (Code generation above). The pipeline follows Alchemy's distilled; the lessons and sources are in [research/codegen-prior-art.md](research/codegen-prior-art.md).
  - `SchemaRepresentation.toCodeDocument` was rejected because it takes no options and the representation can't carry brands, `/*#__PURE__*/` or opaque types. Effect's OpenAPI generator, which uses it, has to rewrite JSON Schema before it and swap whole entries by name after it.
  - Smithy as the model format was rejected because distilled's generator is HTTP-bound, and events, sessions and BiDi union kinds would all need custom traits.
- **Pipe transport** uses Effect's `ChildProcess` extra file descriptors behind our `Transport`:
  - one long-lived outbox stream on fd 3;
  - a single consumer on fd 4;
  - stderr drained or ignored;
  - a mandatory `forceKillAfter`.

  Where extra descriptors are unavailable (Bun, probe 12), the backend layer uses the WebSocket transport as an explicit choice, never a silent switch.
- **Validation policy** is the same in every environment, with no `NODE_ENV` switching:
  - required events and command results are always decoded, with the JIT compiler;
  - high-volume telemetry is decoded by its consumer;
  - `trust` mode is an explicit opt-in layer;
  - AOT compilation is an explicit build choice with the same semantics.
- **Effect `Socket`:** ship our own small fail-fast transport now, and propose upstream a fail-fast writer mode, switching over once it's released.
- **`ws` constructor** (2026-10-19, replacing 5.15's "our own `ws` constructor"): we don't ship one. `ws` runs only on Node and Bun, so `@usestrider/browser/protocol` can't import it, and a platform subpath of our own would bend API.md's "no platform packages of our own". Instead we propose upstream that `NodeSocket.layerWebSocketConstructor` pass `ws` options (`maxPayload`, `perMessageDeflate`) through, and document the 128 MiB limit of Node's built-in WebSocket until it ships.
