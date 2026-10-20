# PROTOCOL: transports, protocol clients and backend adapters (L0)

*Revision 5.25, 2026-10-19; CDP code generation, the transports and the CDP client built 2026-10-19; the client's timeouts, late replies and validation modes, the ingestion pipeline, and the CDP and BiDi adapters built 2026-10-20; WebKit code generation and the WebKit backend built 2026-10-20; who served a response (review 09) built 2026-10-20. A condensed sketch drawn from draft 4 of the native model (commit `6cc0bc1`) and the research notes, especially `research/effect-building-blocks.md`, `research/non-js-cdp-clients.md`, `research/puppeteer-and-chromium-bidi.md`, `research/webdriver-bidi.md` and `research/webkit.md`.*

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
- **Tests:** 14 against a scripted browser, and 7 against Chromium 155: both transports, a failed connection, a closed target, a killed browser, a clean exit, and the error table. The Chromium suite uses `STRIDER_CHROMIUM`, or the first Chromium or Chrome on `PATH`, and is reported as skipped without one. (Since 2026-10-20 the browser suites run only in the Nix environment, with `pnpm test:integration`, against the pinned builds: Tests and pinned browsers, below.)
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
- **Not built yet:** the backend adapter, which came next (Backend adapters, below).

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
- **Next:** the transports and the CDP client are built (Transports and Protocol client above). The error table's next rows, and the rest of the drift test, come from probes recording real traffic (both built since: Built, below). BiDi's CDDL and WebKit's JSON get their parsers when those backends start (both now have them: Built for BiDi and Built for WebKit, below); the correction audit is built with the first correction (built with BiDi's first two: Built, below).

**Built for BiDi** (2026-10-20), after review 08 (candidate 12):

- **Source.** WebDriver BiDi's CDDL is extracted from the editor's draft at `w3c/webdriver-bidi` `f922e6a` into `remote.cddl` and `local.cddl`, as the spec's own script does, minus HTML comments. The Permissions spec's module (`w3c/permissions` `0051a83`) is a third source, `permissions.cddl`; `SOURCE.md` records how each was extracted and its hash.
- **Parser** (`packages/tools/codegen/src/Cddl.ts`). It accepts the subset of RFC 8610 the specs use and fails on anything else:
  - a group with `method` and `params` is a command (sent by clients) or an event (sent by browsers);
  - a command's result is the rule named after it plus `Result`, which is how every command section of the spec pairs its types; the Permissions spec gives its command no return type, so that source's commands return `EmptyResult`;
  - a map is a struct, or a union of structs when its group has choices, including inline choices beside fixed members, which are multiplied out; an included group is flattened, optional if included with `?`;
  - a choice of strings is an open enum, a single literal stays exact, and decimal and integer ranges are told apart by how they are written.
- **Model and emitter.** The model gains literals, unions, tuples and string-keyed maps.
  - The emitter quotes member names that aren't identifiers (`"any-hover"`) and renames reserved words (`Session.new_`).
  - It redacts sensitive members of any type: a BiDi cookie's value is a `network.BytesValue`, which header values share, so the member is redacted whole.
  - It capitalizes module names (`BrowsingContext`).
  - It decodes a union's loose members last: the spec lists `log.GenericLogEntry`, whose `type` is any text, before the console and JavaScript entries, and decoding in that order kept only the generic entry's fields.
- **Overlay:** 17 id brands, 7 sensitive members (cookie values, credentials, typed keys), 8 resource-creating commands with their releases (one releases into a list: `session.unsubscribe`), and input compensation.
- **Corrections**, the first two, both recorded from Firefox 158: `browsingContext.contextCreated` comes without the `hasPlannedNavigation` the draft requires, and the `navigationStarted` that closing a page with `promptUnload` starts comes without a `url`.
- **Output:** 12 modules at `@usestrider/browser/bidi-protocol`, with 342 types, 69 commands and 24 events.

**Built for WebKit** (2026-10-20), for Playwright's WebKit build:

- **Source.** The `protocol.json` that Playwright's WebKit build 2359 (WebKit 26.6) ships, as nixpkgs packages it for Playwright 1.63.0; `SOURCE.md` records where it came from, its licenses and its hash. It is CDP's format with a few more keys, so CDP's parser reads it, in WebKit's dialect (`Cdp.parse(revision, protocols, "webkit")`).
- **The dialect's two differences:**
  - Items can be compiled in only under build flags (`condition`). An item only an iOS build compiles is dropped, since Playwright never builds WebKit for iOS; that removes the second definition of four `DOM` commands, which the spec gives once per platform family. Any other condition may hold in some build, so its item is kept and the condition recorded: the JSDoc says "Only in builds compiled with …", and a build without it answers `Unsupported`.
  - A `$ref` can name a primitive type, which WebKit's generator resolves (`Runtime.PropertyDescriptor.isPrivate` is a `$ref` to `boolean`).
- **Overlay:** 21 id brands (targets, workers and downloads have bare string ids, with no type to brand); 9 sensitive members (cookie values, credentials, typed text); 8 resource-creating commands, with `Playwright.deleteContext`, `Playwright.closePage` and `Runtime.releaseObject` as their releases (`Page.createUserWorld` has none: a world lasts as long as its page); input compensation; and the `Playwright` domain marked as sent on the browser session.
- **Corrections:** none so far; the adapter's probes record what the wire does (Backend adapters, Built for WebKit).
- **Output:** 33 modules at `@usestrider/browser/webkit-protocol`, with 206 types, 308 commands and 128 events.

**Built** (2026-10-20): the correction audit and the rest of the drift test.

- **The correction audit.** `pnpm codegen:audit` (`strider-codegen audit <backend> [--check]`) rebuilds each backend's model once without each correction, and lists the ones whose absence changes nothing: the spec has absorbed them, so they can go, and `--check` fails until they do. A correction another one builds on is needed. It runs on each roll; today BiDi's two corrections are both needed, and CDP and WebKit have none.
- **Recording.** With `STRIDER_RECORD` naming a directory, the integration tests record what each browser sends (`test/integration/record.ts`): three distinct samples of each event, of each command's result, and of each error reply with what its table made of it, leaving out messages over 32 KiB, which are screenshots and bodies. The recordings are committed, one per browser (`test/fixtures/traffic/`: Chromium 155, Firefox 158, Playwright's WebKit 2359), about 150 KB together.
- **Replay.** `test/Drift.test.ts` runs without a browser: every recorded event and result must decode through the generated codecs, and every recorded error reply must classify as it did when it was recorded. So a regeneration that drops or tightens a member a browser sends fails, and so does a table edit that reclassifies a reply. A method with no generated definition fails unless the coverage report excludes it by policy: Chromium 155 still sends four deprecated events nothing subscribes to (`Page.frameScheduledNavigation`, `frameClearedScheduledNavigation`, `downloadWillBegin` and `downloadProgress`), which the first recording found.
- **The drift test is now whole for the browsers recorded:** the replay, the integration tests that hold each error row to the live browser, and the WebKit launch's `protocol.json` check. The oldest supported version of each browser will be recorded beside the newest when there is more than one.

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

**Built for CDP** (2026-10-20), after [review 08](reviews/08-l0-adapters.md):

- **The contract** (`src/internal/adapter.ts`) is the whole of what a backend gives L1.
  - **Facts:** contexts, pages and frames, documents, realms, navigations and their outcomes, request hops, WebSocket and EventSource connections, obligations, prompts, downloads, console messages and uncaught exceptions. They are in L1's ids, carry the public data classes where those exist (`NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `NetworkConnection.Frame`), and the ones that interpret traffic carry their evidence. The adapter calls the sink from its fold, in receive order, before the events are published.
  - **Ids** are minted per connection behind a prefix per kind (`N3`, `D7`, `R5`, `Q12.1`). An id this connection never minted fails with `Foreign`.
  - **Operations:** contexts and pages, navigation (whose id is minted before the command is sent), realms and evaluation, input, obligations, declarations, screenshots, PDFs, cookies, permissions, response bodies, input files and download paths. Each fails with `AdapterError`, whose reasons are `Gone`, `Unsupported`, `Foreign` and `Protocol`.
  - **Remote values** are WebDriver BiDi's `RemoteValue`. CDP produces them with `serializationOptions: { serialization: "deep" }`, and nodes carry a binding (`backendNodeId` and the document) that `setInputFiles` and file choosers use.
- **Declarations** (`src/internal/declarations.ts`) are a registry every backend's gate reads.
  - Overrides take the most specific scope (page, then context, then browser), then the most recent, and releasing one in any order recomputes the effective value and applies it, or resets it.
  - Init scripts form one bundle per world, environment phase first, broader scopes first, each script in its own `try`.
  - Intercepts are the union of patterns per phase; `Fetch` is never disabled while a request is paused.
- **CDP specifics** (`src/internal/cdpAdapter.ts`):
  - **Auto-attach.** The browser session auto-attaches pages, service workers and shared workers, filtering out `browser_ui` targets and extension pages. A launched browser pauses every new page; an attached one pauses nothing browser-wide. Every page and out-of-process frame auto-attaches its own frames and workers, paused.
  - **The gate** runs while the target is paused and is the session's first sync: `Page.enable`, `Network.enable` and lifecycle events, then `Page.getFrameTree`, whose reply's receive sequence is the snapshot point, then `Runtime.enable`, whose replayed contexts arrive after it, then auto-attach and the declarations in force. `Runtime.runIfWaitingForDebugger` runs in a finalizer. A declaration that fails emits `PageInitializationFailed` and fails `createPage`; the page still runs.
  - **Correlation.** A page's main frame shares the target's id. Out-of-process frames move their frame to the new session and back. Realms are keyed by `uniqueId`, and evaluation targets `uniqueContextId`. Navigations are keyed by loader id: a command's navigation is matched to `frameStartedNavigating` by URL, first in, first out. Requests are keyed by session and request id, with one hop per redirect.
  - **Outcomes** follow review 08's evidence table. A navigation that never started (the reply has an error and no loader id) ends at once as `Failed`, through the client's ordered `run`. An abort with no other evidence stays pending.
  - **Operations** use `Target.createBrowserContext` (with `disposeOnDetach`), `Target.createTarget` (and wait for the page's gate), `Target.closeTarget` or `Page.close` (to run `beforeunload`), `Page.navigate`, `reload` and `navigateToHistoryEntry`, `Page.createIsolatedWorld`, `Runtime.callFunctionOn`, the `Input` domain (with Windows key codes for keys whose text doesn't say what they are), `Fetch`, `Page.handleJavaScriptDialog`, `DOM.setFileInputFiles`, `Page.captureScreenshot` (beyond the viewport for clips and full pages), `Page.printToPDF`, `Storage` cookies, `Browser.setPermission`, and `Network.getResponseBody`, which waits for the request to finish.
  - **Capabilities** are a static profile, with evidence: popups can be paused only when the browser was launched, and PDFs only headless.
- **Launchers** (`src/internal/launch.ts`, `src/internal/chromiumLauncher.ts`).
  - The executable comes from `executablePath` or a channel's install location, and nothing else; downloading Chrome for Testing, the default, isn't built yet, and `ExecutableNotFound` says so.
  - The profile is a temporary directory unless the caller owns one. The `automation` profile's arguments turn off what a page can't observe (first run, sync, updates, component extensions); `concurrent` adds the throttling switches.
  - The pipe is the transport, or a port read from `DevToolsActivePort`. stderr is kept for `ProcessExited`.
- **Tests:** a conformance suite of 23 tests (24 since history was added) written against the contract, with a local site (`test/integration/adapter/`), and 6 more for Chromium alone. They cover:
  - pages, frames and out-of-process frames, orphans, and popups with init scripts before author script;
  - outcomes: commit, same-document, no content, failure, redirect hops;
  - evaluation, input, prompts, interception, overrides and their release;
  - console and exceptions, screenshots and PDFs, bodies, cookies and permissions, file choosers, downloads, workers and WebSockets;
  - closing pages, removing contexts, `beforeunload`, the browser dying, a crash, an attached browser, and the launcher's errors.
- **Where the build differs from the sketch above:**
  - `initialize` isn't a method: every new target runs the gate, and `PageReady` or `PageInitializationFailed` reports how it went;
  - `model: ModelSink` is the `sink` given to `connect`, and `correlation` stays inside the adapter;
  - capabilities are named entries of `Browser.CapabilitySet` (`pauseOnStart.popups`, `interception.auth`, …);
  - `PageCrashed` is a reason for `NavigableRemoved`, not a fact of its own.
- **Not built yet:**
  - the `RcMap` for domains beyond the base set (`Page`, `Network`, `Runtime`), which nothing consumes yet;
  - the on-demand realm strategy (no `Runtime.enable`);
  - merging `ExtraInfo` headers into request snapshots (`servedBy` is built since: Who served a response, below);
  - enrichment;
  - a test of prerender activation, which headless Chromium 155 doesn't produce; back/forward-cache restores, which it didn't in the first probe, it does between plain pages, and are built and tested since (History and restores, below).

**Built for BiDi** (2026-10-20), for Firefox and any BiDi endpoint (`src/internal/bidiAdapter.ts`, `src/internal/bidiWire.ts`, `src/internal/firefoxLauncher.ts`, and the public `BidiConnection`):

- **Wire.** One session per connection: every event belongs to it, and the adapter routes events by the context in their parameters. `params` is always sent, even empty. An error reply with no id answers a message the browser couldn't read, which is a bug here, so it ends the connection. The error table matches the spec's codes; Firefox reports a command it doesn't implement as `unknown command`, so `unsupported operation` had no row until a browser sent it (it has one since: History and restores, below).
- **Connecting.** The adapter starts a session with `unhandledPromptBehavior: ignore`, so prompts and file dialogs wait for a decision, and subscribes to `browsingContext`, `script`, `network`, `log` and `input`. It adopts the contexts `browsingContext.getTree` shows. That tree is also its resync after an integrity failure, which a recorded Firefox event that didn't decode exercised before the correction for it.
- **No pause.** Declarations are native: preload scripts and overrides registered for a context, a user context or every context apply before a new context's scripts. `pauseScope` is `"context"`, a new page is ready as it appears, and popups get their user context's declarations.
- **Correlation.** Contexts are navigables, BiDi's navigation ids map to ours (a command's navigation is matched by URL), requests are hops by request id and redirect count, and realms are keyed by BiDi's id. Firefox creates a new document's realm before `navigationCommitted`, sometimes after a transient one: a main-world realm created for a context whose document already had one is held for the next commit, and one destroyed before it is never reported. The initial `about:blank` realm survives into the first same-origin document, as in Chromium (probe 2).
- **Outcomes.** As on CDP: commit (an `about:neterror` page is `Failed` with its error document), same document (`fragmentNavigated`, `historyUpdated`), download (`downloadWillBegin` names the navigation), no content (a 204 and a fetch error), failure, and supersession by a new navigation. A navigation command whose reply is an error may still have started one, whose events report its outcome.
- **Operations** map onto `browsingContext`, `script` (sandboxes for isolated worlds, created by evaluating in them; handles owned with `resultOwnership: root` and released with `disown`), `input.performActions` (pointer, key and wheel sources, WebDriver's key codes, typed keys redacted), `network` (intercepts, data collectors), `emulation`, `storage`, `browser.setDownloadBehavior` and `permissions.setPermission`.
  - **Intercepts** are compiled to URL patterns that cover each glob (scheme, host and port), and the glob is checked by the adapter; a paused request nothing matches continues at once. BiDi can't scope an intercept to a user context, so one scoped that way intercepts browser-wide and filters here (CONCEPTS.md §6).
  - **Bodies** need a `BodyCollection` declaration before the request starts, a new declaration kind, which compiles to `network.addDataCollector` (CDP needs none).
  - **Permissions** are granted per origin; BiDi has no reset, so the adapter sets the ones it granted back to `prompt`.
- **Not supported, and said so:** a navigation referrer, media-feature overrides and focus emulation on Firefox 158, which answers `unknown command` (now `AdapterError{Unsupported}` named by the method), and WebSocket frames, which BiDi has no events for.
- **Findings** (PROBES.md, Results): Firefox sends `contextDestroyed` for frames orphaned by a navigation (probe 8); `userActivation` grants activation only during the call (probe 20); a dedicated worker's console messages come attributed to its owner's realm; `document.open()` shows as `historyUpdated` and a repeated `domContentLoaded`, which the adapter reports as a new generation (probe 17).
- **Tests:** the conformance suite's 23 tests (24 since) pass against Firefox 158 as they do against Chromium; 5 Firefox tests check the launcher, the raw connection, every error-table row against the browser, and both corrections.

**Built for WebKit** (2026-10-20), for Playwright's WebKit build (`src/internal/webkitAdapter.ts`, `src/internal/webkitWire.ts`, `src/internal/webkitUtility.ts`, `src/internal/webkitLauncher.ts`, and the public `WebKitConnection`):

- **Wire.** Three levels of session on one pipe.
  - The browser's own session takes the `Playwright` domain.
  - A page proxy (one page, in the UI process) adds `pageProxyId` to the envelope and takes `Dialog`, `Emulation`, `Input`, `Screencast` and `Target`.
  - An inspector target (the page in a web process) is reached by wrapping each command in `Target.sendMessageToTarget`, and its messages come back wrapped in `Target.dispatchMessageFromTarget`. A worker is one more level, through `Worker.sendMessageToWorker`.

  A session's key is the ids on its path as a JSON array (`["5","page-6"]`), so no id is mistaken for a separator. A wrapper is a command of its own: it takes the negated id of the command it carries (the browser accepts negative ids), its success is ignored (a new `Ignore` envelope in the client), and its failure becomes the carried command's error, since that command never arrived. `pageProxyCreated`, `targetCreated` and `workerCreated` attach sessions; `pageProxyDestroyed`, `targetDestroyed` and `workerTerminated` end them, and `didCommitProvisionalTarget` ends the target it swaps out as `swapped`. The client gained `children`, the sessions attached under a session, which `WebKitConnection.targets` reads: a page's first target is announced before `Playwright.createPage` replies.
- **The error table** has eight rows, recorded against build 2359: an unknown domain or method at any level (`-32601`); arguments that can't be processed (`-32602`); a page proxy that is gone, which is `SessionEnded{detached}` when the envelope names it (`-32602`) and `Rejected{NoSuchTarget}` when a parameter does (`-32000`); a target that is gone (`SessionEnded{detached}`); an unknown frame; and an unknown node, by node id or by object. An unknown execution context or remote object stays `Unrecognized`, as on CDP.
- **Launcher.** The executable is `executablePath`, or the pinned build where Playwright installs it (`PLAYWRIGHT_BROWSERS_PATH`, or Playwright's cache directory, under `webkit-2359`), and nothing else. The profile is always persistent (`--user-data-dir`), so the browser has a default context, as a stock browser does, and opens one page in it. The launch compares the build's `protocol.json` with the vendored one by SHA-256 and fails with `IncompatibleRevision` if they differ or it has none, unless `checkRevision` is off: this is the drift test's launch-time half.
- **Connecting.** `Playwright.enable` announces the pages that already exist before it replies; they are adopted. Every target created after it starts paused (`isPaused`), the startup page's doesn't.
- **The gate.** Each session is synced before its events are folded.
  - A page proxy enables `Dialog` and applies what the page proxy carries: JavaScript, focus and the permissions granted to its context.
  - A target enables `Page`, `Network` and `Console`, takes `Page.getResourceTree` (the snapshot), then enables `Runtime`, whose contexts arrive after it, and `Worker`. It applies the declarations in force (the target's overrides, the bootstrap script, interception, the file chooser, the isolated worlds the page has asked for) and the viewport for a page's first target, and resumes it with `Target.resume`, in a finalizer.
  - A worker enables `Runtime` and `Console`, then `Worker.initialized` lets it run.
- **Correlation.**
  - A page proxy is the page. A cross-site navigation loads in a provisional target, whose main frame has a new frame id: the snapshot maps that id onto the page's main frame, and `didCommitProvisionalTarget` makes it the page's. Loader ids survive the swap, so the navigation is followed across it, and the provisional process's own empty document is never reported.
  - Realms are execution contexts, keyed by session and context id. WebKit never reports one destroyed: a document's realms end when another document commits in its frame, when the frame goes, or with their target.
  - Navigations are keyed by loader id. A command's navigation takes the loader id from `Playwright.navigate`'s reply, or is matched by URL to the first document request, whichever comes first; a load that failed before the reply is ended when it arrives.
  - A console message is attributed to the realm of its first object argument (WebKit's object ids name their context); one with only primitive arguments is attributed to the main frame's main realm, a limitation the capability profile states.
- **Outcomes.** Commit; same document (`navigatedWithinDocument`, a fragment when only the fragment differs); download (`Playwright.downloadCreated` names the page, and a navigation there to that URL becomes it); no content (a 204's load fails); failure (`Playwright.provisionalLoadFailed`, which also covers a request the browser refused to send); supersession by a new navigation.
- **Evaluation.** WebKit calls functions only on an object and serializes only JSON, so each realm gets a helper, installed on first use from an expression whose value it is, kept in a closure where the page can't reach it. Every call runs through it: it deserializes arguments from `RemoteValue` (handles pass as remote objects), awaits if asked, and returns BiDi's `RemoteValue` as JSON text, or the value itself for a handle. The nodes a value holds come back in a batch, as remote objects, which are their bindings: `DOM.setInputFiles` takes one. `emulateUserGesture` grants activation for the call.
- **Operations** use `Playwright.createContext` (with `setIgnoreCertificateErrors` for `acceptInsecureCerts`, which CDP can't scope), `createPage` and `closePage` (with `runBeforeUnload`), `Playwright.navigate`, `Page.reload`, `goBack` and `goForward` (one entry at a time; other deltas are `Unsupported`), `Page.createUserWorld`, the `Input` domain on the page proxy (Windows key codes, as on CDP; `Page.insertText` on the target), `Network.addInterception` with each glob compiled to an anchored regular expression, `Dialog.handleJavaScriptDialog`, `DOM.setInputFiles` after `Playwright.grantFileReadAccess`, `Page.snapshotRect` for screenshots, `Playwright` cookies, `Emulation.grantPermissions` per page proxy, `Network.getResponseBody`, and `Playwright.setDownloadBehavior`.
- **Declarations, where WebKit differs.**
  - Init scripts are one bootstrap script per target (`Page.setBootstrapScript`), main world only: an init script for an isolated world is `Unsupported`.
  - The viewport is a resize of the view, with nothing to clear, so the adapter measures the size the view had before its first resize, and restores that.
  - The locale (`Playwright.setLanguages`) and geolocation are per context. A web process takes its languages when it starts, so a locale declared for pages that already exist is `Unsupported`; declared first, it applies to every page created after.
  - A document caches `navigator.userAgent` the first time it is read, so a user-agent override reaches a document that has read it only at its next navigation; requests carry it at once.
- **Not supported, and said so:** PDFs, interception of authentication (WebKit answers challenges from credentials set in advance), a response-phase `Fail`, and the per-page locale and geolocation above.
- **Hazards** (PROBES.md, Results): `Playwright.navigate` with a frame id the page doesn't have, and `Dialog.handleJavaScriptDialog` with no dialog open, abort the browser. The adapter navigates only frames it has seen and not seen go, and answers only a dialog it has seen open and not seen close; a frame that goes between that check and the command is a race it can't close.
- **Tests:** the conformance suite's 24 tests pass against build 2359 as they do against Chromium and Firefox; 6 WebKit tests check the launcher and its revision check, the raw connection, every error-table row (with unknown methods at every level), a cross-site navigation followed across targets, `document.open()`, and a crash.
- **Not built:** the attach-only stock profile (iOS, WKWebView, the WebKitGTK inspector). It needs stock WebKit's protocol, vendored and modeled as a backend of its own (its domains differ from Playwright's: no `Playwright`, no page proxies), and an endpoint to record against, which this environment doesn't have.

**Built** (2026-10-20): history and back/forward-cache restores, on every backend, which no test had covered.

- **The test.** A conformance test reloads and moves through history: back, forward and past the end, each navigation started as a `traversal` or a `reload` and ending `Committed` or `Restored` in the document it names. It failed on two backends at first.
- **CDP.** Chromium 155 restores a plain page from the back/forward cache. It creates the restored document's context before `frameNavigated{type: BackForwardCacheRestore}`, which commits under that document's original loader id.
  - An ended navigation now leaves the table of navigations by loader id, which it never did, so the restore's commit no longer found the long-ended navigation that first loaded the document; it takes the traversal in flight.
  - A main-world context created while a traversal is in flight waits for the commit, and what it logs meanwhile waits with it, so the restored document's realm is reported as that document's, after it.
  - Chromium answers a page's commands with "Not attached to an active page" for a moment while it swaps documents, as just after a commit. A history command refused for that never ran, so it is sent again, every 50 ms for up to a second.
- **BiDi.** Firefox 158 restores without `navigationCommitted`, `domContentLoaded` or `load`: the old realm goes and a new one comes. `traverseHistory` replies once the traversal is done, and a normal traversal commits before that, so a traversal still in flight at the reply, with a new main-world realm waiting, restored its document. Leaving its JSON viewer before it has loaded, Firefox doesn't even start one: then the waiting realm's `location.href` says where the page went. Either way the adapter commits the restored document, from the document the navigable last had at that URL, and ends the traversal `Restored`, reporting the realm's console messages after it.
- **Firefox's `unsupported operation`.** `browsingContext.reload` with `ignoreCache`, `true` or `false`, is "not supported yet", which gave BiDi's table its fifth row, `Unsupported`. A reload now sends `ignoreCache` only to bypass the cache, and a navigation command the browser doesn't support fails as `Unsupported` instead of ending its navigation `Failed`.
- **WebKit.** This build keeps no back/forward cache: going back loads the page again. A reload or traversal the adapter starts is now reported as one, as it is on BiDi; CDP's come from the browser's own navigation type.

**Not built, across backends** (2026-10-20). With these, the protocol layer is otherwise built for CDP, BiDi and patched WebKit:

- **CDP's `ExtraInfo` headers**, the ones the network stack adds, such as cookies. They change a request after it is reported, so they need a fact that updates it, a change to the fact contract that waits for a review. (`servedBy` was listed here too; review 09 put it on the response instead, and it is built: Who served a response, below.)
- **Enrichment and the domain `RcMap`** wait for what consumes them in L1, and the on-demand realm strategy for a measured need.
- **A test of prerender activation**, which headless Chromium doesn't produce, and **downloading Chrome for Testing**, which the Chromium launcher's `ExecutableNotFound` says isn't built.
- **The attach-only stock WebKit profile** (Built for WebKit, above). Its endpoint is available after all: nixpkgs has WebKitGTK 2.54 and WPE (cog), whose remote inspector an environment variable turns on. What it needs is stock WebKit's own protocol, vendored as a backend of its own, a wire for it, and a smaller adapter.

**Tests and pinned browsers** (2026-10-20). The browser integration tests run in a Nix environment that fixes the machine they see, against the builds their fixtures and the error tables' evidence were recorded from, pinned in `packages/browser/test/integration/browsers.json`: Chromium 155.0.8059.79, Firefox 158.0 and Playwright's WebKit build 2359. The standard tests run anywhere.

- **`flake.nix`** locks nixpkgs at `319e4ce` (2026-10-14), whose packages are exactly these, and asserts so: a `nix flake update` that moves a browser fails evaluation with the version it found, as does a pnpm that isn't `packageManager`'s. Chromium and Playwright's WebKit are built for Linux only in nixpkgs, so the flake is for `x86_64-linux` and `aarch64-linux`.
  - `devShells.default` is the toolchain, Node 24.21.0 and pnpm 12.9.0, for the standard checks.
  - `devShells.integration` is the machine: the toolchain, the browsers named in `STRIDER_CHROMIUM`, `STRIDER_FIREFOX` and `STRIDER_WEBKIT`, a fixed set of fonts (DejaVu and Liberation, through `FONTCONFIG_FILE`, since neither nixpkgs' Chromium nor Playwright's WebKit brings its own), `TZ=UTC`, `LANG` and `LC_ALL` `C.UTF-8`, an empty home that is deleted on exit, and `STRIDER_ENVIRONMENT=nix-integration`.
- **`pnpm test:integration`** enters that environment with `--ignore-environment`, keeping only `TERM` and `STRIDER_RECORD`, so no display, user configuration or host variable reaches the browsers, and runs `vitest.integration.config.ts`. The standard configuration excludes `test/integration/`, so `pnpm test --run` and `pnpm all` run the rest anywhere, the launchers' browser-free tests included (`test/Launchers.test.ts`).
- **Nothing skips.** The integration configuration's setup fails every test outside the environment, saying how to run them, and each browser comes only from its variable, never from `PATH` or Playwright's cache. A browser that isn't the pinned version fails its tests with the version it found: Chromium and Firefox by the version they report, WebKit by its launcher's `protocol.json` check, and by a standard test holding the pin to the build the adapter is generated from.
- **The fixtures are named from the pins**, so recording again after moving one writes new fixtures beside the old.

**Built** (2026-10-20, after [review 09](reviews/09-served-by.md)): who served a response.

- **The field moved.** `servedBy` is on `NetworkResponse` now, not `NetworkRequest`: every backend says what answered a request with its response, and a request that fails has no answer to describe. It is `network`, `cache`, `serviceWorker`, `cacheOrServiceWorker`, `route` or `unknown`, from each response's own evidence:
  - **CDP:** `Network.requestServedFromCache` before the response, or `fromDiskCache` or `fromPrefetchCache`, is `cache`; Chromium 155 sent `requestServedFromCache` with `fromDiskCache: false` for every cache hit recorded. `fromServiceWorker` is `serviceWorker`.
  - **BiDi:** `fromCache` is `cacheOrServiceWorker`, because Firefox 158 sets it for a service worker's responses too; the capability `network.servedBy` is `partial` there, and `supported` on CDP and WebKit.
  - **WebKit:** `source` says it: `memory-cache` and `disk-cache` are `cache`, `service-worker` is `serviceWorker`, `inspector-override` is `route`. Its `unknown`, which the probes never produced, is `unknown`: where the build differs from the review, which mapped everything onto five values.
  - **Routes:** a response a route fulfilled reads as an ordinary network response on Chromium and Firefox, so each adapter marks the request when it sends the decision, before the response can arrive.
- **Nothing dropped.** WebKit's `requestServedFromMemoryCache`, a request answered from the memory cache without a load, is now a request, a `cache` response and its end; the adapter used to drop it. A script reused from the memory cache within one document produces no request at all on Chromium and WebKit, which the capability's limitations say; Firefox reports it.
- **Service workers on CDP never started.** Each one was attached twice, by the browser's auto-attach and by its page's, and the gate waited for `Runtime.enable` on each before resuming it. A service worker waiting for the debugger hasn't started, and answers `Runtime.enable` only once it has, so it waited forever: no service worker ever ran under the CDP adapter. A page's auto-attach now leaves service and shared workers to the browser's, and a worker's domains are enabled and the worker resumed in one go, as Playwright does.
- **WebKit's intercepts don't see a controlled page.** A page a service worker controls sends its requests past `Network.addInterception`, even those the worker passes to the network; a page it doesn't control is intercepted as before. WebKit's `interception.request` and `interception.response` capabilities are `partial` with that limitation. Chromium and Firefox intercept the controlled page's requests.
- **The test.** A conformance test loads a cacheable script fresh and again, fulfills a request through a route, registers a service worker and fetches a response it made, and checks what served each, by the capability's precision. It passes on all three backends; the drift fixtures are recorded again with this traffic.

### Pause-on-start granularity

Before-author-script setup for *new* targets needs them paused at creation. Granularity differs by backend, and the access model depends on it.

| Backend | Granularity (probe 22) |
|---|---|
| CDP | frames and workers: per page, by auto-attach on the page's session. Popups: **browser-wide only**: neither `autoAttachRelated` nor the opener's auto-attach attaches them (confirmed 2026-10-20, Chromium 155) |
| BiDi | not needed: declarations are scoped natively by context or user context (built 2026-10-20) |
| Patched WebKit | every target created after `Playwright.enable` starts paused: new pages, popups and the provisional targets of cross-site navigations, each resumed on its own (`Target.resume`); workers wait for `Worker.initialized` (built 2026-10-20) |

The capability is `pauseScope: "context" | "related" | "opener" | "browser"`. A declaration that needs `beforeAuthorScript` on targets the available granularity can't isolate fails with `Unsupported`. Observe-only targets are never paused.

## Backends and order

Each backend ships as its own subpath export (`@usestrider/browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provides the `Browser` service, so unused protocol code is never loaded. Generated L0 commands are available raw at `@usestrider/browser/cdp`, `/bidi-protocol` and `/webkit-protocol` for power users.


1. **CDP:** launched Chromium; remote endpoints.
2. **BiDi:** Firefox, plus Chrome over chromium-bidi as a cross-check.
3. **WebKit inspector:**
   - a *patched* profile for Playwright's builds, revision-pinned because about 27% of rolls change the protocol (built 2026-10-20 for build 2359);
   - an attach-only *stock* profile for iOS, WKWebView and the WebKitGTK inspector (not built: Built for WebKit, above).
4. **Experimental BiDi profiles:** Safari Technology Preview (needs `safari:experimentalWebSocketUrl`) and WebKitGTK/WPE (about 23% of WPT).

### Capability snapshot

This is a planning inventory from the research, not a conformance result. `?` means it still needs a probe.

| Capability | CDP | BiDi Chrome | BiDi Firefox | WebKit patched | WebKit stock | Safari BiDi (STP) |
|---|---|---|---|---|---|---|
| own process / headless | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | attach-only | ✓/✗ |
| user contexts | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| isolated worlds (`inspect`) | ✓ | ✓ | ✓ | ✓ | ✗ | partial |
| pause-on-start scope | per page for frames and workers; browser-wide for popups (probe 22) | declarative | declarative | per page proxy (probe 22) | partial | n/a |
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
