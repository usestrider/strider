# PROTOCOL: transports, protocol clients and backend adapters (L0)

*Revision 5, 2026-10-18. A condensed sketch drawn from draft 4 of the native model (commit `6cc0bc1`) and the research notes, especially `research/effect-building-blocks.md`, `research/non-js-cdp-clients.md`, `research/puppeteer-and-chromium-bidi.md`, `research/webdriver-bidi.md` and `research/webkit.md`.*

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
| **WebSocket** (remote CDP, BiDi, iOS) | Our own `ws` constructor with `maxPayload` of about 256 MiB and no `perMessageDeflate`. Headers are allowed for remote providers |

- **One reader per connection.** Writes fail promptly after close. Effect 4.0.5's `Socket` writer *waits* for a reconnection after a disconnect, so L0 wraps it to fail instead.
- **No reconnect.** A new connection is a new model namespace (CONCEPTS.md §1).

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
- **Drift test.** Recorded traffic from the oldest and newest supported browsers must decode, and recorded error replies must classify as they did when recorded, so a browser that rewords an error fails the test instead of quietly becoming `Unrecognized`. Patched WebKit additionally checks its `protocol.json` at launch and fails with `IncompatibleBrowserRevision`.

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

## Backend adapters

```ts
interface BackendAdapter {
  readonly info: BackendInfo                                     // product, version, protocol revision
  readonly capabilities: SubscriptionRef<CapabilitySet>          // static profile, refined by probed evidence
  connect(transport: Transport): Effect<AdapterConnection, ConnectError, Scope>
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
- **The initialization gate.** Configure a target before its scripts run, then publish it as Ready:
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
- **Capability evidence.** Probe only in owned, disposable targets or with read-only checks, never by mutating adopted pages. Cache results per backend revision and configuration.

### Pause-on-start granularity

Before-author-script setup for *new* targets needs them paused at creation. Granularity differs by backend, and the access model depends on it.

| Backend | Granularity (to be confirmed by probe 22) |
|---|---|
| CDP | browser-wide auto-attach filters by target *type*; `autoAttachRelated` covers frames and workers of one target, but popups are unconfirmed |
| BiDi | not needed: declarations are scoped natively by context or user context |
| Patched WebKit | per page proxy; popup behavior unconfirmed |

The capability is `pauseScope: "context" | "related" | "opener" | "browser"`. A declaration that needs `beforeAuthorScript` on targets the available granularity can't isolate fails with `Unsupported`. Observe-only targets are never paused.

## Backends and order

Each backend ships as its own subpath export (`effect-browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provides the `Browser` service, so unused protocol code is never loaded. Generated L0 commands are available raw at `effect-browser/cdp` (and later `/bidi-protocol`) for power users.


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
- **Effect `Socket`:** ship our own small fail-fast transport and `ws` constructor now, and propose upstream a fail-fast writer mode and `ws` option passthrough, switching over once they're released.
