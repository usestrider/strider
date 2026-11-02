# PROTOCOL: transports, protocol clients and backend adapters (L0)

*Revision 5.25, 2026-10-19; CDP code generation, the transports and the CDP client built 2026-10-19; the client's timeouts, late replies and validation modes, the ingestion pipeline, and the CDP and BiDi adapters built 2026-10-20; WebKit code generation and the WebKit backend built 2026-10-20; who served a response built 2026-10-20; the first slice through L1 and L2 built 2026-10-22; events, popups and dialogs built 2026-10-23; the other event modules built 2026-10-23. A condensed sketch drawn from draft 4 of the native model (commit `6cc0bc1`) and the research notes, especially `research/effect-building-blocks.md`, `research/non-js-cdp-clients.md`, `research/puppeteer-and-chromium-bidi.md`, `research/webdriver-bidi.md` and `research/webkit.md`.*

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
| **Pipe** (launched Chromium) | fd 3 in, fd 4 out, NUL-framed JSON. One long-lived outbox stream feeds fd 3, because a finite stream would send EOF and disconnect the browser. Spawned with `forceKillAfter`, and stderr is drained or ignored |
| **WebSocket** (remote CDP, BiDi, attached stock WebKit) | Through the `Socket.WebSocketConstructor` in context. Headers are allowed for remote providers. The constructor sets the largest message: 128 MiB for Node's built-in WebSocket |
| **Inspector socket** (launched stock WebKit) | WebKitGTK's and WPE's inspector server over TCP, through the program's `SocketConnector`: each message a big-endian size, a flags byte, a name and GVariant parameters (`webkitInspectorSocket.ts`), carrying the Automation target's JSON and each page's |

- **One reader per connection.** Writes fail promptly after close. Effect 4.0.5's `Socket` writer *waits* for a reconnection after a disconnect, so L0 wraps it to fail instead.
- **No reconnect.** A new connection is a new model namespace (CONCEPTS.md §1).
- **A link holds what every transport promises** (`internal/link.ts`): messages in order to one consumer, then a failure carrying the loss once what came before it is delivered, and sends that fail at once after it. Stock WebKit's transports and its inspector socket are built on one too.
- **Stock WebKit's pages reach the adapter through one endpoint** (`webkitEnvelope.ts`), which both its transports share: it announces each page, puts its `pageProxyId` in the page's text and routes commands by it, and serves the `Envelope` domain. It parses no page's message; a page's ids stay its target's own, which the adapter keys by the target's session (Q195).

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
- **Ordered sends with overlapping replies.** The internal session's `sendOrdered` writes its commands to the
  transport in order as one step, which interruption doesn't split, then waits for every reply, regardless of reply
  order. A failure or interruption then stops waiting; what was written can't be taken back.
  CDP uses this for a single move/press/release click at one point, without held buttons or modifier transitions.
  Pages with child frames or HTML drag interception enabled, drags, multiple clicks, and other input sequences
  keep their sequential dispatch. The frame restriction also applies to coordinate clicks, whose target frame
  is unknown before dispatch. Generated commands and the public protocol session API are unchanged.
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

- **Timeouts.** A command waits for its reply for at most `Protocol.CommandTimeout`, a `Context.Reference` that is 30 seconds unless set (the same as L2's default budget), and then fails with a new reason, `NoReply`. `Protocol.withCommandTimeout` sets it for an effect, and `Duration.infinity` turns it off. Inside an L1 operation, the operation's deadline replaces it: each command the operation sends waits for its reply until that instant, and one that passes it is the operation's `Timeout` (`src/internal/boundedAdapter.ts`). It runs on the live clock, as the browser does, so `TestClock` never moves it.
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
| WebKit | the inspector's domain files (`webkit-stock`) and `Automation.json` (`webkit-automation`) from WebKitGTK's source |

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
- **Drift test.** Recorded traffic from the oldest and newest supported browsers must decode, and recorded error replies must classify as they did when recorded, so a browser that rewords an error fails the test instead of quietly becoming `Unrecognized`. Stock WebKit's fixture holds two protocols' traffic, its pages' inspector and its Automation target's, each decoded through its own.

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

**Built for BiDi** (2026-10-20):

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

**Built for stock WebKit** (2026-10-26):

- **Source.** The 28 domain files of `Source/JavaScriptCore/inspector/protocol/` in WebKitGTK 2.54.1's source release, as nixpkgs packages it, unchanged, in `protocols/webkit-stock/source/`; `SOURCE.md` records the release, its licenses and the files' hash. The pipeline reads every `*.json` there as a domain and parses them as one protocol, in WebKit's dialect, as a backend of its own (`webkit-stock`, revision `webkitgtk-2.54.1`).
- **Overlay:** the patched build's annotations that name what stock WebKit has: 18 id brands, 3 sensitive members and 5 resource-creating commands, each file saying it is that subset. It can make no context, page or world, and has no input to type with.
- **Corrections:** none.
- **Output:** 28 modules at `@usestrider/browser/webkit-stock-protocol`, with 188 types, 248 commands and 110 events; 12 approximated, none excluded.

**Built for WebKit's Automation protocol** (2026-10-26):

- **Source.** `Automation.json` from `Source/WebKit/UIProcess/Automation/` in WebKitGTK 2.54.1's source release, unchanged, in `protocols/webkit-automation/source/`, with the Automation code's notice (`LICENSE`, BSD-2-clause, copyright Apple Inc.) and `SOURCE.md`. Read as the stock protocol's files are, as a backend of its own (`webkit-automation`).
- **The dialect's macros.** Its conditions are WebKit's macros, `ENABLE(WEBDRIVER_BIDI)` and `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`; `possible` reads `ENABLE`, `USE`, `HAVE` and `PLATFORM` as the flags they name, `PLATFORM(IOS_FAMILY)` off as its `defined` form is.
- **Overlay:** 3 id brands (browsing contexts, frames, nodes), the cookie's value as sensitive, and `createBrowsingContext` as creating a page `closeBrowsingContext` releases.
- **Output:** 1 module at `@usestrider/browser/webkit-automation-protocol`, with 32 types, 57 commands and 4 events; none approximated or excluded.
- **Also.** A generated module's header names its own protocol's directory, not its dialect's (Q210), which corrected the stock protocol's 28 headers.

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

**Built** (2026-10-20), in the client every backend shares (`src/internal/protocolClient.ts`, with its worker in `ingestion.ts` and its subscriber buffers in `subscriberBuffer.ts`):

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

**Built for CDP** (2026-10-20):

- **The contract** (`src/internal/adapter.ts`) is the whole of what a backend gives L1.
  - **Facts:** contexts, pages and frames, documents, realms, navigations and their outcomes, request hops, WebSocket and EventSource connections, obligations, prompts, downloads, console messages and uncaught exceptions. They are in L1's ids, carry the public data classes where those exist (`NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `NetworkConnection.Frame`), and the ones that interpret traffic carry their evidence. The adapter calls the sink from its fold, in receive order, before the events are published.
  - **Ids** are minted per connection behind a prefix per kind (`N3`, `D7`, `R5`, `Q12.1`). An id this connection minted whose target has ended fails with `Gone`, since L1 can name one between its end and hearing of it; only an id this connection never minted fails with `Foreign`, a bug in L1 that `Operation.fromAdapter` raises as a defect.
  - **Operations:** contexts and pages, navigation (whose id is minted before the command is sent), realms and evaluation, input, obligations, declarations, screenshots, PDFs, cookies, permissions, response bodies, input files and download paths. Each fails with `AdapterError`, whose reasons are `Gone`, `Unsupported`, `Foreign` and `Protocol`.
  - **Remote values** are WebDriver BiDi's `RemoteValue`. CDP produces them with `serializationOptions: { serialization: "deep" }`, and nodes carry a binding (`backendNodeId` and the document) that `setInputFiles` and file choosers use.
- **Declarations** (`src/internal/declarations.ts`) are a registry every backend's gate reads.
  - Overrides take the most specific scope (page, then context, then browser), then the most recent, and releasing one in any order recomputes the effective value and applies it, or resets it.
  - Init scripts form one bundle per world, environment phase first, broader scopes first, each script in its own `try`.
  - Intercepts are the union of patterns per phase; `Fetch` is never disabled while a request is paused.
- **The adapter kit** (`src/internal/adapterKit.ts`, 2026-10-30) holds what every adapter does alike, so an adapter keeps its state in one object its per-domain modules take, rather than one closure over every table:
  - ids that remember what the connection minted, as ranges of each kind's counter, and lookups that fail an ended one as `Gone` and another connection's as `Foreign`;
  - a fact buffer: facts delivered at the fold's flush, in order, a realm reported ahead of its document held with what it logs until it is announced; waits on the model (a document's main realm) checked after every flush; and commands the fold can't wait for, run after the flush in a `FiberSet` in the connection's scope, so they end with it;
  - the navigations a command started, matched to the browser's by URL, oldest first, and one that never started reported in one step of the worker (Q233);
  - typed event handlers, which give the fold its events and their handlers from one table;
  - base64 that fails as an incompatible reply rather than giving empty bytes, an argument resolver that fails a handle or node it can't resolve as `Gone` rather than sending an empty reference, and a realm's failure that is `Gone` when its realm or session ended.
- **CDP specifics** (`src/internal/cdpAdapter.ts`, and its modules in `src/internal/cdpAdapter/`):
  - **Auto-attach.** The browser session auto-attaches pages, service workers and shared workers, filtering out `browser_ui` targets and extension pages. A launched browser pauses every new page; an attached one pauses nothing browser-wide. Every page and out-of-process frame auto-attaches its own frames and workers, paused.
  - **The gate** runs while the target is paused and is the session's first sync: `Page.enable`, `Network.enable` and lifecycle events, then `Page.getFrameTree`, whose reply's receive sequence is the snapshot point, then `Runtime.enable`, whose replayed contexts arrive after it, then auto-attach and the declarations in force. `Runtime.runIfWaitingForDebugger` runs in a finalizer. A declaration that fails emits `PageInitializationFailed` and fails `createPage`; the page still runs.
  - **Correlation.** A page's main frame shares the target's id. Out-of-process frames move their frame to the new session and back. Realms are keyed by `uniqueId`, and evaluation targets `uniqueContextId`. Navigations are keyed by loader id: a command's navigation is matched to `frameStartedNavigating` by URL, first in, first out. Requests are keyed by session and request id, with one hop per redirect.
  - **Outcomes** come only from evidence. A navigation is correlated by the loader id in `Page.frameStartedNavigating` or `Page.navigate`'s reply, a same-document one by frame and order:

    | Evidence | Outcome |
    |---|---|
    | `frameNavigated` with the navigation's loader id | `Committed`, with the document request's response hop when one was seen |
    | `frameNavigated{type: BackForwardCacheRestore}` under the restored document's old loader id | `Restored` (History and restores, below) |
    | `navigatedWithinDocument` | `SameDocument{via}` |
    | `Page.navigate` replied `isDownload: true`, or `Browser.downloadWillBegin` for the frame and the navigation's URL while it is in flight | `Download` |
    | the document response was 204 or 205 and its request failed | `NoContent` |
    | a new cross-document `frameStartedNavigating` on the same frame (the old one's request fails `ERR_ABORTED` just before, probe 4) | `Superseded{by}` |
    | the document request failed with anything but `ERR_ABORTED`, or a routed request aborted | `Failed{errorDocument: None}`; an error page (`chrome-error://chromewebdata/`) that then commits under its loader id is that navigation's document (`createdBy: ErrorPage`), never a navigation of its own, and one that commits first makes it `Failed{errorDocument: Some}` |
    | `ERR_ABORTED` and nothing else | pending until a download, a new navigation or an error page says what it was; at L1 it times out with `Timeout{postcondition}` |

    A navigation that never started (the reply has an error and no loader id) ends at once as `Failed`, through the client's ordered `run`. An abort with no other evidence stays pending.
  - **Operations** use `Target.createBrowserContext` (with `disposeOnDetach`), `Target.createTarget` (and wait for the page's gate), `Target.closeTarget` or `Page.close` (to run `beforeunload`), `Page.navigate`, `reload` and `navigateToHistoryEntry`, `Page.createIsolatedWorld`, `Runtime.callFunctionOn`, the `Input` domain (with Windows key codes for keys whose text doesn't say what they are), `Fetch`, `Page.handleJavaScriptDialog`, `DOM.setFileInputFiles`, `Page.captureScreenshot` (beyond the viewport for clips and full pages), `Page.printToPDF`, `Storage` cookies, `Browser.setPermission`, and `Network.getResponseBody`, which waits for the request to finish.
  - **Capabilities** are a static profile, with evidence: popups can be paused only when the browser was launched, and PDFs only headless.
- **Launchers** (`src/internal/launch.ts`, `src/internal/chromiumLauncher.ts`).
  - The executable comes from `executablePath` or a channel's install location, and nothing else; downloading Chrome for Testing, the default, isn't built yet, and `ExecutableNotFound` says so. (There is no default now, and nothing is downloaded: a launch names its browser only by an absolute `executablePath`, Launches name their browser and A launch takes an executable path, below.)
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
- **Launcher.** The executable is `executablePath`, or the pinned build where Playwright installs it (`PLAYWRIGHT_BROWSERS_PATH`, or Playwright's cache directory, under `webkit-2359`), and nothing else. (A launch no longer looks in Playwright's cache: A launch takes an executable path, below.) The profile is always persistent (`--user-data-dir`), so the browser has a default context, as a stock browser does, and opens one page in it. The launch compares the build's `protocol.json` with the vendored one by SHA-256 and fails with `IncompatibleRevision` if they differ or it has none, unless `checkRevision` is off: this is the drift test's launch-time half.
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
- **Not built:** the attach-only stock profile (iOS, WKWebView, the WebKitGTK inspector). It needs stock WebKit's protocol, vendored and modeled as a backend of its own (its domains differ from Playwright's: no `Playwright`, no page proxies), and an endpoint to record against, which this environment doesn't have. (Since built for WebKitGTK's and WPE's inspector: Stock WebKit, attached, below.)

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

- **CDP's `ExtraInfo` headers**, the ones the network stack adds, such as cookies. They change a request after it is reported, so they need a fact that updates it, a change to the fact contract not designed yet. (`servedBy` is on the response instead, and built: Who served a response, below.)
- **Enrichment and the domain `RcMap`** wait for what consumes them in L1, and the on-demand realm strategy for a measured need.
- **A test of prerender activation**, which headless Chromium doesn't produce. (The library never downloads a browser, Chrome for Testing included: Launches name their browser, below.)
- **The rest of the CLI.** `strider browsers` is built; the session commands of CLI.md aren't.
- **The attach-only stock WebKit profile** (Built for WebKit, above). Its endpoint is available after all: nixpkgs has WebKitGTK 2.54 and WPE (cog), whose remote inspector an environment variable turns on. What it needs is stock WebKit's own protocol, vendored as a backend of its own, a wire for it, and a smaller adapter. (Since built: Stock WebKit, attached, below, with the patched adapter's profile and a transport rather than a wire and an adapter of its own; WPE wasn't in the pinned nixpkgs after all.)

**Tests and pinned browsers** (2026-10-20). The browser integration tests run in a Nix environment that fixes the machine they see, against the builds their fixtures and the error tables' evidence were recorded from, pinned in `packages/browser/test/integration/browsers.json`: Chromium 155.0.8059.79, Firefox 158.0 and Playwright's WebKit build 2359. The standard tests run anywhere.

- **`flake.nix`** locks nixpkgs at `319e4ce` (2026-10-14), whose packages are exactly these, and asserts so: a `nix flake update` that moves a browser fails evaluation with the version it found, as does a pnpm that isn't `packageManager`'s. Chromium and Playwright's WebKit are built for Linux only in nixpkgs, so the flake is for `x86_64-linux` and `aarch64-linux`.
  - `devShells.default` is the toolchain, Node 24.21.0 and pnpm 12.9.0, for the standard checks.
  - `devShells.integration` is the machine: the toolchain, the browsers named in `STRIDER_CHROMIUM`, `STRIDER_FIREFOX` and `STRIDER_WEBKIT`, a fixed set of fonts (DejaVu and Liberation, through `FONTCONFIG_FILE`, since neither nixpkgs' Chromium nor Playwright's WebKit brings its own), `TZ=UTC`, `LANG` and `LC_ALL` `C.UTF-8`, an empty home that is deleted on exit, and `STRIDER_ENVIRONMENT=nix-integration`.
- **`pnpm test:integration`** enters that environment with `--ignore-environment`, keeping only `TERM` and `STRIDER_RECORD`, so no display, user configuration or host variable reaches the browsers, and runs `vitest.integration.config.ts`. The standard configuration excludes `test/integration/`, so `pnpm test --run` and `pnpm all` run the rest anywhere, the launchers' browser-free tests included (`test/Launchers.test.ts`).
- **Nothing skips.** The integration configuration's setup fails every test outside the environment, saying how to run them, and each browser comes only from its variable, never from `PATH` or Playwright's cache. A browser that isn't the pinned version fails its tests with the version it found: Chromium and Firefox by the version they report, WebKit by its launcher's `protocol.json` check, and by a standard test holding the pin to the build the adapter is generated from.
- **The fixtures are named from the pins**, so recording again after moving one writes new fixtures beside the old.

**Built** (2026-10-20): who served a response.

- **The field moved.** `servedBy` is on `NetworkResponse` now, not `NetworkRequest`: every backend says what answered a request with its response, and a request that fails has no answer to describe. It is `network`, `cache`, `serviceWorker`, `cacheOrServiceWorker`, `route` or `unknown`, from each response's own evidence:
  - **CDP:** `Network.requestServedFromCache` before the response, or `fromDiskCache` or `fromPrefetchCache`, is `cache`; Chromium 155 sent `requestServedFromCache` with `fromDiskCache: false` for every cache hit recorded. `fromServiceWorker` is `serviceWorker`.
  - **BiDi:** `fromCache` is `cacheOrServiceWorker`, because Firefox 158 sets it for a service worker's responses too; the capability `network.servedBy` is `partial` there, and `supported` on CDP and WebKit.
  - **WebKit:** `source` says it: `memory-cache` and `disk-cache` are `cache`, `service-worker` is `serviceWorker`, `inspector-override` is `route`. Its `unknown`, which the probes never produced, is `unknown`.
  - **Routes:** a response a route fulfilled reads as an ordinary network response on Chromium and Firefox, so each adapter marks the request when it sends the decision, before the response can arrive.
- **Nothing dropped.** WebKit's `requestServedFromMemoryCache`, a request answered from the memory cache without a load, is now a request, a `cache` response and its end; the adapter used to drop it. A script reused from the memory cache within one document produces no request at all on Chromium and WebKit, which the capability's limitations say; Firefox reports it.
- **Service workers on CDP never started.** Each one was attached twice, by the browser's auto-attach and by its page's, and the gate waited for `Runtime.enable` on each before resuming it. A service worker waiting for the debugger hasn't started, and answers `Runtime.enable` only once it has, so it waited forever: no service worker ever ran under the CDP adapter. A page's auto-attach now leaves service and shared workers to the browser's, and a worker's domains are enabled and the worker resumed in one go, as Playwright does.
- **WebKit's intercepts don't see a controlled page.** A page a service worker controls sends its requests past `Network.addInterception`, even those the worker passes to the network; a page it doesn't control is intercepted as before. WebKit's `interception.request` and `interception.response` capabilities are `partial` with that limitation. Chromium and Firefox intercept the controlled page's requests.
- **The test.** A conformance test loads a cacheable script fresh and again, fulfills a request through a route, registers a service worker and fetches a response it made, and checks what served each, by the capability's precision. It passes on all three backends; the drift fixtures are recorded again with this traffic.

**Built** (2026-10-20): launches name their browser.

- **No default, no download.** Chrome for Testing was to be the launch default, downloaded by the library; it is gone, and nothing in the library fetches, unpacks or installs a browser, at launch or by a command. A browser comes from wherever its user gets it: an operating system's package, Chrome's or Firefox's installer, a Nix package, or Playwright's installer for its WebKit builds. The integration tests already got theirs from the Nix environment.
- **The type names it.** `Browser.LaunchOptions<Channel>` is the shared `LaunchSettings` and exactly one of `executablePath` and `channel`, as a union, and each backend's `layer` and `layerConfig` require it, so `Chromium.layer({})` doesn't compile, nor does naming both. A typetest (`typetest/launch.tst.ts`) holds it. A caller the types don't reach, such as plain JavaScript, that names neither or both fails with `InvalidInput` before anything is looked up (`Launch.namedExecutable`, shared by the three launchers).
- **Each backend's channels.** Chromium's and Firefox's are `stable`, `beta` and `canary` (Firefox's being Nightly), where each installer puts them. WebKit's one is `playwright`: Playwright's browser cache at the pinned build, which the launcher used to search when given nothing and now searches only when named, still checking the build's `protocol.json`. A named browser that isn't there is `ExecutableNotFound`, naming what was searched.
- **Examples name a browser,** in the JSDoc, the scenarios, API.md and the package's README, so none teaches a default that doesn't exist.
- (There are no channels now, nor the union with them: A launch takes an executable path, below.)

**Built** (2026-10-20): a launch takes an executable path, and a command finds them.

- **Only a path.** A channel was a fixed table of install paths, and no table is right on every system: on NixOS nothing is ever at `/opt/google` or `/usr/bin`, the open-source Chromium has no channels, Firefox's `beta` searched `stable`'s paths and so launched stable, and Linux's `canary` was Chrome Dev. `channel` is gone from every backend, `Browser.LaunchOptions` is one interface again with `executablePath` required, and the launchers keep no tables. The path must be absolute: a relative one depends on the working directory, and a bare command name would be looked up on `PATH` by the process spawner. Either, or no path from a caller the types don't reach, fails with `InvalidInput`; a path where nothing is fails with `ExecutableNotFound`, and both hints name `strider browsers` (`Launch.executable`, which the three launchers share).
- **`strider browsers`,** the first `strider` command built (`src/bin/strider.ts`, `src/internal/cli.ts`, `src/internal/browsers.ts`). It looks on `PATH` under the command names Chromium, Chrome, Edge and Firefox install, at the locations their installers use (Chrome's and Edge's from Playwright 1.61's table, with Linux's Canary at `chrome-canary` and Dev at `chrome-unstable`), and in Playwright's cache for its WebKit and Chromium builds. It lists each by the path found first, on NixOS a profile's link rather than the store path it leads to, says where the path leads, asks each browser for `--version` (not on Windows, where Chrome prints nothing), and checks each WebKit build's `protocol.json` against the adapter's. Nothing is labelled by channel: the version says what a browser is. On this machine it finds Chromium 155 and a Firefox Developer Edition 159 beta on `PATH`, and pointed at nixpkgs' Playwright browsers, builds 2359 (the adapter's) and 2311 (refused).
- **A runtime for the command.** It runs on Node through `@effect/platform-node`, now an optional peer dependency that only the command needs, and says what to install without it. `pnpm strider browsers` runs it in the repository. `./bin/*` is closed in the export map, so the command isn't importable as a module.
- **Tests.** `test/Browsers.test.ts` checks the tables and runs the search over a machine made of scripts in a temporary directory: two links to one Chromium reported once, a directory named like a browser skipped, and one WebKit build that is the adapter's and one that isn't. `typetest/launch.tst.ts` holds that a launch names a path and has no channels.

**Built** (2026-10-22): the first slice through all three layers. The README's program runs on Chromium, Firefox and WebKit: a layer launches the browser, `Browser.newPage` opens a page, `goto` navigates, `getByRole(…).click()` waits for a late button and clicks it, and `Expect.toBeVisible` waits for the cart to change.

- **The model** (`src/internal/model.ts`; CONCEPTS.md §2, The fold) is the adapter's sink, one per connection. It folds contexts, pages, their active documents and readiness, navigation outcomes, the realms the engine runs in, the responses of navigation requests, and prompts, which an owned context's `dialogs` policy decides at once (`dismiss` unless the context says otherwise; `beforeunload` is accepted under `dismiss`).
- **The engine** (`src/internal/engine.ts`, `src/internal/runtime.ts`; CONCEPTS.md §8, Queries) is one self-contained function, installed in each document's utility world (`__strider_utility__`) on first use as a non-enumerable global under a registered symbol, and sent requests as JSON: `count`, `visible`, `act`, the document's `title` and an element's `role`. A request whose document ends under it, or whose realm went or lost the engine, goes again to the page's new document within the deadline.
- **Actions** (`src/internal/locator.ts`; CONCEPTS.md §5, Actions): `click`, with `trial`, `position`, `button` and `checks`. A `Timeout`'s hint explains the last reason ("Another element covers the element's action point: div.toast "Saved"", "The element is disabled", "The element kept moving: its box changed within 2 frames"); a `StrictViolation` lists the candidates with whether each is visible, and suggests `.filter({ visible: true })` when one is.
- **Pages, contexts and the browser** (`src/internal/page.ts`, `src/internal/browser.ts`). Built: `Browser.info`, `capabilities`, `newContext` and `newPage`; a context's `newPage`, `pages`, `closed` and `control`; a page's `status`, `url`, `closed`, `title`, `context`, its queries, `goto`, `reload`, `back`, `forward`, `activate` and `close`; a locator's queries, `filter`, `and`, `or`, `nth`, `first`, `last`, `describe`, `count`, `isVisible`, `all` and `click`. Navigation outcomes map onto `PageError`'s navigation reasons, a 404 is a commit, and `waitUntil` waits for the committed document's readiness under the same deadline; no outcome by the deadline is `Timeout{postcondition}`. A page and its context are owned by the scope that created them, which closes the page and removes the context.
- **Expectations**: `Expect.toBeVisible` and `toBeHidden`, re-checked at `Expect.CheckInterval` (100 ms, `withCheckInterval`), failing at the deadline with `ExpectationFailed{history}`. **`Deadline`**: `within`, `withDefaultBudget`, `remaining`, `CurrentDeadline` and `DefaultBudget` (30 seconds). **`Watchable`** is built over a `SubscriptionRef`; Effect 4 has no public way to subclass `Effect`, so a watchable is an effect value with its members attached.
- **The layers**: `Chromium.layer`, `Firefox.layer` and `WebKit.layer`, and their `layerConfig`, launch, connect with `ownership: "launched"`, build the model and provide `Browser`. `Firefox.layer` needs `Socket.WebSocketConstructor` too.
- **`NotBuilt`** (`src/internal/notBuilt.ts`): every member the interfaces declare that isn't built fails as `Effect.die(new NotBuilt({ member }))`, naming it, and so does an option that isn't (`newContext` with `storageState`, `emulation`, `permissions` or emulated focus, `goto` with `accept`, `close` with `runBeforeUnload`, an action with `modifiers`).
- **Settled while building.**
  - A page is open from its first commit. `createPage` replies once the page is ready, so `PageReady` adds nothing yet. A closed page keeps its last URL, so `url` still reads after `closed`.
  - Prompts are folded: an owned context decides its dialogs from the start.
  - `getByText` doesn't search the document's `head`.
  - A `Timeout` whose every observation was `NoMatch` has the phase `resolving`, not `waitingForCondition`: nothing was ever there to wait on.
  - Module-level declarations that aren't built stay declarations, except where a module needs the binding to load. Node and `tsc` erase a declaration, so a module that used one as it loaded, or re-exported one under another name, failed to load, and with it the root entry point: `Snapshot.Node`, which `Snapshot.Data` uses, is now a real schema, `Deferred.await` a `NotBuilt` function, and `Route.continue` a decision nothing reads yet. `test/Modules.test.ts` loads every entry point in Node itself, since Vite's transform forgives a re-export of an erased binding.
- **Found by the slice: Chromium's error pages.** A navigation that fails is reported `Failed` on `Network.loadingFailed`, and Chromium then commits its error page under the failed navigation's loader id, with `frameNavigated` and no `frameStartedNavigating`. Since history and restores were built, an ended navigation leaves the table of loader ids, so that commit found no navigation and the adapter started one for it: an extra failed navigation for every failure, which superseded any navigation started since. `goto` right after a failed `goto` failed with `NavigationSuperseded`, though Chromium went on to commit it. A failed navigation is now kept on its frame, by loader id, until the frame's next commit; its error page is its document (`createdBy: ErrorPage`) and no navigation of its own. A conformance test navigates at once after a failure, on every backend; Firefox and WebKit passed it already.
- **Tests.** `test/integration/slice/` runs one suite on all three backends through the public layers: the README's program, a button disabled then enabled, one below the fold, one covered (the timeout names the cover), two matches (`StrictViolation` at once), a failed navigation and a 404, an expectation that never holds (`ExpectationFailed` with its history), and the page and context closing with their scope. `test/integration/adapter/engine.ts` tests the engine's roles, names, text, shadow roots, chaining and actionability against a real DOM in each browser.
- **Not built yet:**
  - frames (`frame()`, `Page.frames`), and coordinates in child frames (since built: A page's contents, below);
  - the guard on the first trusted event (CONCEPTS.md §8, ReceivesPointer), modifiers, and the actions besides `click` (since built: Interacting and asserting, below);
  - the one-shot reads besides `count`, `isVisible` and `all` (`readText`, `readValue`, `readHtml`, `readAttribute`, `isEnabled`, `isChecked`), and a reason in `LocatorError` for a read with nothing to read (since built: Interacting and asserting, below);
  - the other expectations, and re-checks on the model's change signals (`Reactivity`) (since built, with re-checks in the page: Interacting and asserting, below);
  - the event modules (since built in part: Events, through Popup and Dialog, below), evaluation, snapshots, screenshots, storage, cookies, routes, init scripts, emulation, permissions and page time (routes, init scripts, emulation, permissions and page time since built: Declarations, below; evaluation, snapshots, screenshots, storage and cookies: A page's contents, below);
  - `Browser.pages`, and the default context's `pages` and `control` (since built: Attaching and access, below).

**Built** (2026-10-23): events, through `Popup` and `Dialog`. Call site 3 of API.md runs on Chromium, Firefox and WebKit: `Popup.next` subscribes before the click, the wait it hands out gives the popup's `Page`, `Dialog.handle` registers before the click that opens a `confirm` in it, and the confirm is accepted.

- **The mechanism** (`src/internal/events.ts`; CONCEPTS.md §9, Subscriptions). Each page has a channel per kind (popups, dialogs, automatic decisions) and each context one for automatic decisions. The fold publishes to a channel, which logs the event (capped by `UserContext.Options.eventLog`, now built, default 100) and offers it to each subscription whose filter it matches, into a `Queue` of its own, without suspending. `next` latches the first event its filter and `where` accept into a deferred (handed out as an `Effect` that awaits it), with the requirements captured at `next`, and fails it at the deadline in force then (`Timeout{waitingForEvent}`, with a late-subscription hint), or with `TargetGone` when its target ends. `stream` ends when its target is closed or its scope closes, and fails with `TargetGone` on another end and with `EventOverflow` past `Subscription.Capacity`. `history` reads the log.
- **Popups** (`Popup`; the model). A popup is published to its opener's channel when the adapter adds it, and its URL, unknown then, is filled in by its first navigation, which offers it again to `url`-filtered subscriptions. `url` patterns are compiled by a small matcher (`src/internal/urlPattern.ts`): a glob where `**` matches anything and `*` anything but `/`, a `URLPattern` string by the runtime's `URLPattern`, or else the exact URL; one that doesn't compile fails with `SubscriptionError{InvalidInput}`. `newPage` records its caller's scope on the page, a popup inherits it, and its release is added to it. Each page has one handle per connection, made on first use and kept in a `WeakMap` by the page's model entry (`Runtime.page`), so `Popup.next`, `Popup.history` and a context's `pages` return the same `Page`, and a context's `pages` now includes its popups, which it silently left out before.
- **Dialogs** (`Dialog`, `AutoResolution`; the model). A prompt is published as a `Dialog` (data, a Schema) and decided apart from the fold: the page's latest `Dialog.handle` runs in a `FiberSet` of its registration's scope, with `Deadline.DefaultBudget` as read at `handle`; failing, being interrupted or running out of time leaves the decision to the context's policy, which publishes an `AutoResolution` on the page and its context. A dialog nothing will decide marks the page, and `Runtime.send` and the click's dispatch race that mark, so they fail at once with `PromptBlocking{kind, text}`. An expectation on such a page fails at once too.
- **Probes.** A popup is reported as `""` (Chromium) or `about:blank` before its URL is known; Chromium and WebKit block every evaluation while a dialog is open, and Firefox doesn't; the click that opens a dialog returns only once it is decided, on all three; the opener of a popup reports `hidden` on Chromium and Firefox, and headless Chromium renders no frames for it until it is activated. The `NoRenderingOpportunity` hint now names `page.activate`.
- **Settled while building.**
  - A revised event reached subscriptions made after it was published: a popup's URL arrives with its first navigation, and on Firefox and WebKit that came after a late `Popup.next` subscribed, which then latched the old popup. Registration is now kept by sequence numbers; a subscription sees only entries published after it, revised or not. The late-subscription test caught it.
  - A target that ends normally fails its `next` waits with `TargetGone`, rather than interrupting them as their scope closing does, and a test holds it.
  - `PromptBlocking` carries the dialog's `kind` and `text`, not `Page.Prompt`: `Reason` is a leaf module, and importing `Page` or `Dialog` into it would make a load cycle.
  - `AutoResolution.policy` reads `dialogs: "dismiss"`, as `AutoResolution`'s JSDoc says.
  - `Subscription.Capacity` bounds `stream` only. `next` keeps what arrives until its first match or its deadline, so it needs no bound and can't overflow.
  - A click that times out after its input was sent now says so: `Timeout{dispatchedUnconfirmed}`, with `dispatch: MayHaveBeenSent`, where it said `waitingForCondition`. A dialog the input opened is what holds such a dispatch.
  - A dialog whose handler fails under a `"leaveOpen"` policy is one nothing will decide, and blocks as one with no handler does.
  - A handler interrupted by its scope closing isn't logged; one that fails or runs out of time is, with its cause.
- **Tests.** `test/integration/slice/events.ts` runs on all three backends through the public layers: call site 3, a popup matched by URL among two (with `page.activate` before the second click, since the opener went to the background), a late `next` and its hint, a popup closed with its opener's scope, a wait failing with `TargetGone` when its page closes, a dialog decided by the policy and reported, a failing handler, the latest handler deciding and the one before after it is removed, a stream ending when its page closes with its dialogs encoded as data, `PromptBlocking` under `"leaveOpen"`, and `EventOverflow` at a capacity of 1.
- **Not built yet:**
  - the other event modules: `Download`, `FileChooser`, `NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `BrowserWorker`, `NetworkConnection` (since built: The other event modules, below);
  - automatic decisions for file choosers (since built: The other event modules, below) and paused requests, and recording an automatic decision on the operation that was running;
  - popups of observed pages, at `observe` access, and dialogs on attached pages, which wait for attaching (since built: Attaching and access, below);
  - `FileChooser.handle`, routes, and the other declarations.

**Built** (2026-10-23): the other event modules. `Download`, `FileChooser`, `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `NetworkRequest`, `NetworkResponse`, `BrowserWorker` and `NetworkConnection` run on Chromium, Firefox and WebKit through the mechanism `Popup` and `Dialog` use, as do call sites 2, 4 + 9, 5 and 8 of API.md.

- **Attribution** (the model). The fold keeps which page each frame belongs to (`FrameAdded`) and which page and context each realm belongs to, and publishes every event to its page's channel and its context's: a request by its initiator, a console message or exception by its realm, a worker by its page or context, a connection and a download by their page. `RealmAdded`'s worker kind carries `context`: the CDP adapter has it from the worker's target, and the BiDi adapter now names a dedicated worker's page, from its owner realm, which it left out. The default context's data events are published too, and `Browser.defaultContext` is registered, so modules that take an observed context read them.
- **Delivery that takes an effect** (`src/internal/events.ts`). `next` and `stream` take an optional `Delivery`, run in the subscriber; its failure fails the wait or the stream, and a `next` whose deadline passes while it runs says so in its hint. `history` only projects.
- **Filters** (`src/internal/filters.ts`). Every module checks its filter the same way, so `history` fails with `SubscriptionError` too: `Popup.history` with a pattern that doesn't compile used to die. A filter needing a capability the backend reports `unsupported` fails with `Unsupported`, the capability's limitations as its hint.
- **Downloads** (`src/internal/download.ts`; `browser.ts`). Every context the library creates gets a temporary download directory from the layer's `FileSystem`, made before the context and removed after it, declared to the backend and recorded on `Browser.newContext`'s span. A download's status is folded from its facts; its context's end cancels one in progress, and the fold ignores what the backend says after (Firefox says nothing; WebKit says it completed). `finished`, `saveAs` and `stream` wait for completion under the deadline in force, then copy or read the file with the `FileSystem`. `cancel` is the adapter contract's new `cancelDownload`: `Browser.cancelDownload` on CDP, `Playwright.cancelDownload` on WebKit, `Unsupported` on BiDi.
- **File choosers** (`FileChooser`; `src/internal/handlers.ts`). Every context the library creates declares `FileChooser` for its pages. A chooser is published as data (`Single{}` or `Multiple{}`) and decided as a dialog is: `FileChooser.handle` and `Dialog.handle` now register through one helper, and a chooser no handler decides is canceled and published as an `AutoResolution{subject: FileChooser, policy: 'fileChoosers: "cancel"'}`, in contexts the library created. The BiDi adapter sets `unhandledPromptBehavior.file: "dismiss"`, so a canceled chooser no longer stays open in Firefox. `FileInput.local` and `FileInput.remote` are built; a relative local path is resolved with the layer's `Path`.
- **Console messages and exceptions.** Locations are 1-based on every backend: the CDP and BiDi adapters add one to their 0-based lines and columns. A thrown value that isn't an `Error` reads as an `Error` with the value as its message: the CDP adapter read `Uncaught` from the wrong field, and Firefox's `uncaught exception` became a name. Firefox's exceptions are `kind: "unknown"` (`exceptions.kind`, partial), and their stack is built from the stack trace Firefox gives.
- **Navigations** (`PageNavigation`; `src/internal/navigation.ts`, `navigated.ts`). A page's own navigation is published when it ends, with the URL it ended at: the document's, which a same-document navigation changes, or else where it was going. `PageNavigation` gained `url` on every variant. `next` settles as `goto` does, through `Runtime.settle`, since `PageNavigation` can't import `Page` without a load cycle, and waits for `waitUntil` within its deadline.
- **Requests and responses.** The model keeps each hop, at most 1,000, dropping finished ones first; a hop dropped while in flight ends `Forgotten`, so a body waiting for it is `evicted`. `NetworkRequest.toHttpClientRequest` is built. A body subscription declares `BodyCollection` at `NetworkResponse.BodyLimit` (new, 10 MiB) and delivers a `CapturedResponse`: the response's metadata, an `HttpIncomingMessage` over the owned bytes, and the decoded `body`. A redirect hop's body is `BodyUnavailable{redirect}` without asking the browser, whose adapters failed it as a foreign id.
- **Workers** (`src/internal/worker.ts`, `serialization.ts`). A worker's handle evaluates by value: arguments become BiDi local values and results come back as JavaScript values, with `NotSerializable{path}` for what can't cross; it is what `page.evaluate` will use. `page.workers` and `context.workers` are built.
- **Connections** (`src/internal/connection.ts`). A connection's frames are a channel of its own, ended by its close, which `Target.CloseReason`'s new `NetworkConnectionClosed` reports. The CDP and WebKit adapters drop control frames: WebKit reported the close handshake as two binary frames.
- **Capabilities.** New entries, per backend: `downloads.progress` (CDP), `downloads.cancel` (CDP, WebKit), `networkConnections` (CDP; WebKit partial, without EventSource; BiDi unsupported), `networkConnections.eventSource` (CDP), `workers.shared` and `workers.service` (CDP), `workers.evaluate` (CDP, WebKit), `exceptions.kind` (partial on BiDi). BiDi's `fileChooser` and `console` are `partial`, with their limitations.
- **Probes:** downloads, file choosers, console text and locations, exceptions, workers, frames, redirect bodies, EventSource and WebSocket, on the three pinned builds.
- **Settled while building.**
  - Worker capabilities are `workers.shared` and `workers.service`, which a `kind` filter names, rather than one `workers` entry. BiDi's limitation that a dedicated worker's console reaches its page is on `console`, now `partial`.
  - Firefox starts a navigation it refuses at once, such as one to a port browsers don't use, as its `about:neterror` page; the BiDi adapter now reports where it was going, the page's `u` parameter, so a filter by URL and `goto`'s correlation see it. WebKit reports nothing at all for such a navigation, so a `next` waiting for it times out. The new suite's first run found it.
  - Firefox can reply to `traverseHistory` before the restored document's realm arrives, which under the new suite's load happened in two runs of four: the traversal was never ended. The BiDi adapter now restores it when the realm arrives.
  - With no exception object, CDP gives only `Uncaught <text>`, as for a timer an evaluation set; the adapter strips the prefix. The conformance test of a thrown string found it.
  - A download's `status` never ends with `TargetGone`: its context's end makes it `Canceled`, a final value. Internal `Watchable`s gained final values, after which `changes` ends and a wait the value doesn't satisfy fails at once with `Timeout{waitingForCondition}` and a hint saying so.
  - `CapturedResponse.json` fails with `BackendFailure{IncompatibleResponse, method: "json"}` for a body that isn't JSON.
  - `BodyLimit` is compared with the encoded size the browser reports when the hop ends, which is what BiDi's collector bounds.
  - A handler that returns something that isn't its module's decision now leaves the obligation to the policy, logged; `Dialog.handle`'s died in the resolver, which left the dialog undecided.
  - A `Single` chooser handed several files is canceled by the handler's failure, and the failure is logged.
- **Tests.** `test/integration/slice/modules.ts` runs 20 tests on each backend through the public layers: call sites 2, 4 + 9, 5 and 8; a download's bytes, and its file gone with its context; cancel and progress where supported; a chooser answered, one canceled and reported, one given too many files; console messages from a page and its worker, encoded; exceptions by message and kind; a same-document navigation, a failed one, and `waitUntil: "load"`; a frame's request reaching its page; a redirect hop's body; a filter that doesn't compile; a worker evaluated in and ended; a context's service worker; a WebSocket's frames and close; an EventSource's messages; and `Unsupported` wherever a backend lacks the capability. The conformance suite checks 1-based locations, a thrown string, a worker's page and context, that a socket's control frames aren't frames, and `cancelDownload`. Integration tests: 231.
- **Not built yet:**
  - `FileInput.bytes`, which needs `setInputFiles`'s mechanism to keep its MIME type;
  - downloads and `FileInput.local` paths for a browser the layer doesn't launch, which has no `FileSystem` shared with it;
  - routes, and automatic decisions for paused requests (since built: Declarations, below); recording an automatic decision on the operation that was running;
  - observed pages and contexts as access levels (since built: Attaching and access, below), and frames' own navigations as `PageNavigation` events;
  - shared and service workers' contexts on BiDi, and their console;
  - a flake seen in the conformance suite under full load, before and after this revision: Chromium's interception tests, where a request occasionally isn't paused or isn't marked as routed. It needs a look when routes are built (since traced and fixed: Declarations, below).

**Built** (2026-10-23): interacting and asserting. Call site 1 of API.md runs up to its storage state on Chromium, Firefox and WebKit: `fill` with a `Redacted` password, the click, and `toBeVisible`. Around it, every action, the one-shot reads, `page.keyboard` and `page.mouse`, every expectation but `toMatchAria`, and `Condition`.

- **Input state** (`src/internal/input.ts`, `keys.ts`; `PageEntry.inputState`). L1 keeps each page's held keys, held buttons and pointer position, and builds every gesture from them: a click, a double click (the n-th click carrying click count n), a tap, a drag, a hover, a key press with modifiers pressed before it and released after, and held keys and buttons. `InputEvent`'s `Mouse` gained `buttons`, which the CDP adapter now sends and the WebKit adapter takes instead of tracking its own. Keys come from a US table of ours: each `key` value's `code` and text, which keys Shift changes, and a single character outside the table as a key that types it.
- **Adapters.** The CDP adapter creates each page as a window of its own (`Target.createTarget{newWindow}`), so a page in the background of its context still renders; it intercepts drags (`Input.setInterceptDrags`, sent with the first move that holds a button) and finishes an intercepted one with `Input.dispatchDragEvent`: `dragEnter`, `dragOver` on each move, and `drop` on the release. The BiDi adapter sends Enter as WebDriver's Return, not the numpad's Enter. New capabilities: `input.insertText` (BiDi partial: it types each character), `input.pointerModifiers` (WebKit unsupported) and `input.dragAndDrop` (CDP only).
- **Actions** (`src/internal/locator.ts`; the engine). Every action runs the rounds `click` runs, with its own checks and its own `action` for the engine: it answers the action point, focuses, scrolls, fills, selects, or reads whether the element is checked, and does it only in the round under the permit, so `trial` does nothing. An element of the wrong kind fails at once (`WrongElement`, `NotEditable`), a refused value is `InvalidInput`, and a missing option waits as `NoSuchOption`. `setInputFiles` checks a local path exists, then takes the element by value (`Runtime.element`) and hands its node to the adapter. `check` and `uncheck` read the state first, and read it again after the click (`StateUnchanged`).
- **The guard** (the engine's `arm` and `disarm`). Under the permit, the round that applies a pointer action arms capture-phase listeners on the window for `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, `dblclick`, `auxclick`, `contextmenu`, `touchstart` and `touchend`. The first trusted one decides; one outside the element is stopped with the rest of the gesture. After sending, L1 disarms the guard, which says whether it blocked, and a blocked gesture goes back to checking with `Covered{by}`; a failed action disarms it too.
- **Reads** (the engine's `read`): strict and immediate, with `NoMatch`, `StrictViolation` and `WrongElement`; `readText` is the engine's text.
- **Expectations** (`Expect.ts`; the engine's `expect`). A locator's matcher sends rounds of up to a second, each checking at once and then on each mutation, `input`, `change`, `focusin` or `focusout` event, and animation frame (CONCEPTS.md §9, Reactivity in the page). `toHaveURL` and `Expect.that` on a `Watchable` wait on its changes; `Expect.that` on any other effect runs it again at `Expect.CheckInterval`.
- **Devices** (`src/internal/devices.ts`). `page.keyboard` and `page.mouse` send under the page's input permit with the deadline in force; `hold` releases in its scope's finalizer, once.
- **Settled while building.**
  - **Chromium starts an HTML drag only when a move names the button held,** as a platform's drag event does: the CDP adapter now sends a move's `button` as the first button `buttons` holds. With `buttons` alone, the interception never saw a drag. The slice suite's first run found it.
  - **A page in the background of a Firefox context renders about a frame a second, not one in 150 ms:** 3 frames in 4 s, two seconds after the second page opened. The stable check needs two frames in one round, so an action there never passes; it times out, its history alternating `NotStable` and `NoRenderingOpportunity`, with the hint naming `page.activate`, after which it acts. `layout.throttled_frame_rate` in the launch prefs didn't change it, and activating before every action is ruled out (rule 23), so nothing changed; QUIRKS.md records it.
  - **Firefox on the desktop has no touch event interface:** no `TouchEvent`, `'ontouchstart' in window` is false, and an `ontouchstart` attribute never runs, though `touchstart` and `touchend` reach listeners.
  - **The fold publishes an event before the state it changes** (CONCEPTS.md §9, Subscriptions). A navigation's end was published after `goto`'s outcome was latched, so `PageNavigation.next` right after `goto` received `goto`'s own navigation; a `waitUntil` test caught it on Chromium. Popups, workers, dialogs and document readiness were reordered the same way.
  - **`Expect.that` bounds each check by its deadline,** and runs the subject under it. Under full load, a `Locator.count` inside it timed out while resolving, and the expectation failed with the subject's `Timeout` instead of `ExpectationFailed`; and a subject that never finished held the expectation past its deadline. A check still running at the deadline, or failing with it, now ends the expectation with `ExpectationFailed`, the observation "a check was still running at the deadline" last in its history. A shorter deadline inside the subject is still the subject's failure.
  - **Every expectation re-checks at each animation frame,** not only those that depend on layout, and on `focusin` and `focusout`, which `toBeFocused` needs. One evaluation per frame was simpler than sorting expectations by what they depend on.
  - **`check` and `uncheck` read the state with a one-shot read before acting,** so an element already in the state sends nothing, and one of the wrong kind fails at once; an element that isn't there yet goes on to the click's checks, which wait.
  - **`fill("")` and `clear` press Delete on the selected contents** of a typed field.
  - **A release that fails breaks the page's input state with no way to reset it** but a new page.
  - **`Condition` isn't `Pipeable`,** so `because`, which is dual, is called data-first or through `pipe`.
- **Probes:** a click's events, click counts, modifiers, keys and Enter, inserted text, background pages and windows, drags, touch, utility-world events and focus, files by value, hover and wheel, on the three pinned builds. The build added Firefox's background frame rate, its touch interface, and Chromium's drag button.
- **Tests.** `test/integration/slice/interaction.ts` runs 12 tests on each backend through the public layers: call site 1 up to its storage state; `fill` into every kind of field, `clear`, `press` and `pressSequentially` with a delay and a `Redacted` text; `selectOption`, a late option, `check` and `uncheck` with `StateUnchanged`, and `setInputFiles` with `FileUnreadable` and `WrongElement`; `dblclick`, `hover`, `tap`, and modifiers or `Unsupported` on WebKit; a pointer drag, and an HTML drag on Chromium or `Unsupported`; the guard stopping a click an overlay took and clicking again; held keys and buttons released by their scopes, one failing; every read with `NoMatch`, `StrictViolation` and `WrongElement`; every matcher after a delayed change, and a failure with its history; `toHaveURL` across a navigation, and `Expect.that` on a `Watchable`, on an effect, and on one that never finishes; the keyboard and the mouse; and two pages of one context, with `page.activate` on Firefox. The conformance suite checks the buttons held through a drag across calls, and Enter's `code`. Integration tests: 270.
- **Not built yet:**
  - frames, and coordinates in child frames (since built: A page's contents, below);
  - `Locator.snapshot`, `Locator.evaluate`, `Expect.toMatchAria`, and `nearest` and `suggestions` in `ExpectationFailed`, which need snapshots and evaluation (since built: A page's contents, below);
  - `FileInput.bytes`;
  - HTML drag on Firefox, which starts one and never drops it, and on WebKit, whose protocol has none;
  - keyboard layouts besides US;
  - resetting a page's input state after a release failed.

**Built** (2026-10-23): declarations. Call sites 6, 10 and 11 of API.md run on Chromium, Firefox and WebKit, and call site 7's route on a page of the library's own: routes at each phase, init scripts and their order, emulation, permission grants and the page clock.

- **Routes** (`src/Route.ts`, `src/internal/routes.ts`, `routeDecision.ts`; the model's `decideRequest`). A route declares an intercept covering its pattern (the glob itself, the URL, or everything for a `URLPattern`) and matches precisely with `Url.Pattern`'s rules; the model asks a paused request's page's routes, then its context's, the most recent first. Each handler runs in a fiber of its registration's scope with `Deadline.DefaultBudget` as read at `route`. Decisions are typed by phase (`Decision<in P>`) and turned into the adapter's: `continueWith` compares the changed `HttpClientRequest` with the original and sends only what changed, `fulfill` reads the `HttpServerResponse` through `toWeb`, with its cookies as `Set-Cookie` lines the adapters send as separate headers. The default decision is published as `AutoResolution{PausedRequest}` with `policy: 'routes: "continue"'`. `Intercepted.fetch` and `fetchWith` are removed; the response phase replaces them.
- **Init scripts** (`src/internal/initScripts.ts`; `declarations.ts`). L0's `InitScript` declaration gained `after`. A bundle is one block statement that records which scripts ran and runs a script only after its dependencies did, reporting a throw with `reportError`. The BiDi adapter, whose preload scripts are one per registration, keeps the record under a `Symbol.for` key. The isolated world for the caller's scripts is `__strider_isolated__`.
- **Emulation and grants** (`src/internal/emulation.ts`, `grants.ts`). An `emulate` call is one registration in a scope of its own; capability entries named for each field are checked before anything is declared. L0 gained `NetworkConditions` and `CpuThrottling` overrides (CDP, applied with offline through `Network.emulateNetworkConditionsByRule` and `overrideNetworkState`, and `Emulation.setCPUThrottlingRate`). Grants are kept per context, each name granted on its own, and recomputed by reset and grant on removal. `UserContext.Options.emulation`, `permissions` and `focus: "emulated"` are built.
- **The page clock** (`src/internal/clock.ts`). A shim installed by an environment-phase init script and by evaluation in the current documents' main worlds, keyed by a random token under `Symbol.for`; each operation is broadcast, then the script is declared again with the timeline's state and a higher version.
- **Adapters.**
  - The contract gained `requestBody(obligation)` (CDP's `postDataEntries`, or `Network.getRequestPostData` for a large one; WebKit's `postData`; BiDi's `network.getData` from a request data collector declared with each request-phase intercept) and `pausedResponseBody(obligation)` (CDP's `Fetch.getResponseBody`; `Unsupported` elsewhere). A `Fail` decision carries any `Route.AbortReason`.
  - The CDP adapter's auth intercept is fixed: the registry kept an auth intercept's patterns as response-stage ones, so Chromium paused the `401` as a response and never asked; auth patterns now pause at the request stage, where a request no request-phase intercept wants continues at once, and `Fetch.authRequired` is the obligation. A navigation a route failed with `aborted` ends. A paused request takes the resource type its network events gave it.
  - The BiDi adapter refuses a continue with a URL, a response-phase fulfill, an abort reason, a mobile viewport, an unavailable position, media, touch, disabled JavaScript, focus emulation, throttling and a CPU slowdown, as `Unsupported` under the capability that names each; a new body is sent with its own `Content-Length`.
  - The WebKit adapter refuses touch, an unavailable position, an abort reason, throttling and a CPU slowdown.
  - **Challenges** (since built, Q252): a declaration kind, `Challenges`, which every context the library creates declares unless `network.challenges` is `unsupported`, so a challenge no route answers reaches the model, which cancels it. The CDP adapter pauses every document at the request stage with `handleAuthRequests`, and its `Fetch.authRequired` is the obligation, as an auth route's is; other requests aren't paused, so a subresource's challenge isn't asked about (Q254). The BiDi adapter adds an `authRequired` intercept for every URL, the session's, since an intercept can't name a user context, and a challenge in a context that didn't declare it continues with `default`. The WebKit adapter refuses it (Q255).
  - New capability entries: `interception.responseBody`, `interception.responseFulfill`, `interception.continueUrl`, `interception.abortReason`, `interception.redirects`, `permissions.anyOrigin`, and one per emulated field (`emulation.viewport` and the rest).
- **Settled while building.**
  - **Q46 is traced and fixed.** A stress test of an intercept declared on a live Chromium page, under the suite's load, paused one request in 40 too few: `Fetch.enable` with the route's pattern replied, and the page's fetch 9 ms later went past it. Every such case came right after an enable with no patterns, apparently while the interceptor was installed again. The CDP adapter now enables `Fetch` for every page from its start, with a pattern no request matches while nothing intercepts, and never disables it; 160 runs under the same load paused every request.
  - **Chromium refuses a `Content-Length` header** in a continued request ("Unsafe header"), and the model left a request paused when the backend refused a decision for any reason but `Unsupported`. Routes no longer send it, the browser computing it, and a refused decision gets the default unless the request is gone.
  - **Effect's `bodyText` drops a request's `Content-Type`**, its body carrying its own: `continueWith` sends the body's type when the change didn't set the header, and so sends headers.
  - **WebKit reports a page's existing user world for a new document a moment after it commits**, so the engine asked to create the world again, which WebKit refuses: every engine request after a second `goto` failed. The adapter now waits for the world's report, or the document's end.
  - **Firefox's preload scripts are separate functions**, so the bundle's gating had to be the adapter's own, and a script's top-level `var` isn't global there.
  - **A challenge's scheme is lowercased**: Chromium says `basic`, Firefox `Basic`.
  - **The background-page hint**: a timeout whose rounds saw no frame and then one names `page.activate` too, since what moved was the frame rate (Q71).
  - **A dependency's removal** stops its dependents by the gate, not by removing them: they stay registered and don't run.
- **Probes:** routes at each phase, redirects, overrides, abort reasons, authentication, workers and CORS; init scripts' order, worlds and frames; every emulated field, live and later; permission names; and main-world patches against the isolated world, on the three pinned builds, and request bodies through raw BiDi.
- **Tests.** `test/integration/slice/declarations.ts` runs 20 tests on each backend: call site 7's route and its `hits`; fulfill, `continueWith` and fallthrough between a page's route and its context's; request bodies; a failing handler's `AutoResolution`; the response phase; authentication, and the challenge's response without a route; abort reasons; an invalid pattern; call site 11 with `after`, a throwing script, a path and frames; a dependency removed and refused; the isolated world; call site 6; every emulated field or its `Unsupported`, offline included; a position with its permission; grants and every origin; creation options; call site 10; fixed, offset and resumed clocks with `NotInstalled`, `WrongMode` and `Conflict`; and a context's clock across two pages. The conformance suite adds request bodies and a longer body, response bodies, authentication, a failed navigation's end, every refusal against its capability entry, and init-script gating. Integration tests: 339.
- **Not built yet:**
  - `Route.fulfill` of a file (`HttpServerResponse.file`) without the layer's platform services, and a streamed body, which is read whole;
  - a response-phase decision that changes headers or status only;
  - routes for a page's service worker, which WebKit doesn't intercept at all;
  - page time in workers, and restoring a document's clock when it is removed;
  - init scripts in workers;
  - storage state, cookies and origin storage (since built: A page's contents, below), and attaching (since built: Attaching and access, below).

**Built** (2026-10-24): a page's contents. Call sites 1 (to the end) and 16 of API.md run on Chromium, Firefox and WebKit: evaluation and handles, frames, snapshots and `toMatchAria`, captures, cookies, origin storage and storage state with IndexedDB.

- **Evaluation** (`src/internal/evaluation.ts`). One call serializes the arguments with the workers' serializer (a `JSHandle` argument crosses as itself, into its own realm), races the page's undecided dialog, and maps a throw to `EvaluationThrown` and what can't cross to `NotSerializable{path}`. `page.evaluate` and `evaluateHandle` run in the caller's isolated world, `__strider_isolated__`, `evaluateInMainWorld` in the main world with user activation inside `Page.withUserGesture` (`Page.UserGesture`, now built, with `withUserGesture` and the `FrameTree` schema). A document that ends before the call is followed to the next one; one that ends during it is `TargetGone`. A handle is released by its scope's finalizer or `release`, once; a primitive's handle holds the value. `Locator.evaluate` takes the one match now (`Runtime.element`, which now says no match, several, a stale ref or a wrong iframe) and passes it by its node binding, in the isolated world of its document.
- **Frames** (`Runtime.split`, `route`, `sendRouted`; the engine's `element` and `frame`; the model's frame tree). A `Frame` step is a boundary: the runtime splits a locator's steps at each one, finds each iframe with the engine of the document it is in, names the frame it holds with the contract's new `contentFrame`, and sends the rest to the engine of the frame's current document, which the model now folds (`PageEntry.tree`, `documentOf`). A frame not there yet is a request that matches nothing, in a round of at most 100 ms. Actions scroll each iframe on their way into view (Q110), translate the engine's point through each iframe's content-box origin with the engine's `frame` op, which checks the pointer reaches the iframe in its parent, and send input naming the frame and its origin; the guard is armed and disarmed in the frame's document. `page.frame`, `locator.frame`, `FrameLocator` with its `owner`, and `page.frames` are built.
- **Snapshots** (`src/internal/snapshot.ts`; the engine's `snapshot`, `Ref` steps and `renderText`). The engine walks its document's flat tree with the roles and names `getByRole` uses, infers interactivity from `cursor: pointer` (unless the parent shows it), `tabindex`, `contenteditable` and `onclick`, and names inferred nodes from their text, `title`, a placeholder, an `alt` or a nearby label. Each element node's ref comes from a table the engine keeps (`WeakMap` and `WeakRef`), named by a number it picks when installed. L1 stitches each iframe's frame tree under it, prefixing its refs (`f1e3`), keeps each ref's steps (`Ref` steps through the iframes' own refs), prunes for `interactiveOnly`, and renders the text. A `Ref` step in another document than its own is `StaleRef{Replaced}`, a node gone `Detached`, a ref the table never gave `OtherSnapshot`, and another table `BindingLost`. `diff` compares refs: added, removed, and role, name or states changed.
- **`toMatchAria`** (`src/AriaPattern.ts`, `src/internal/ariaPattern.ts`; the engine's `Aria` expectation and `explain`). Patterns are data the engine matches against the one match's tree with `sources: "aria"`, waiting in the page as the other matchers do; what it saw is the subtree's text. A failed locator expectation asks the engine's `explain`, given a second past the deadline: the longest matching prefix's first match as text two levels deep (`nearest`), and close names of the last step's role under it (`suggestions`, as locator code).
- **Captures** (`src/internal/captures.ts`). `screenshot` validates a JPEG quality and a clip, measures an `Element` area with the engine's `rect` op through the frames on its way, and maps the rest onto the contract's options, which gained `scale` and `omitBackground`; `pdf` turns paper names and lengths into inches and checks the scale (0.1 to 2), and the contract gained `header`, `footer` and `preferCssPageSize`. `readHtml` is the engine's `html` op. CDP reads the device pixel ratio from the page for a CSS-pixel capture (Q128); WebKit captures with `omitDeviceScaleFactor` and has a background override; BiDi refuses both (Q115).
- **Cookies and origin storage** (`src/internal/storage.ts`). The jar reads and writes through the adapter, whose `Cookie` gained `priority` and a partition's cross-site ancestor; `listFor` filters as a top-level request would; `remove` sets matches again expired; a partitioned cookie checks `cookies.partitioned` (the BiDi adapter refuses one too). `Cookie.sameSite` and `priority` are now `Option`s, and `CookieJar.toCookie` is built. `page.localStorage` and `sessionStorage` read and write from the isolated world.
- **Storage state** (`src/internal/storageState.ts`). Export lists one document per origin and partition from the context's pages and frames and reads each with `readOrigin` in its isolated world: `localStorage`, and every database from `indexedDB.databases()` with its stores' key paths, auto-increment, indexes and records, read with `getAllKeys` and `getAll` in one transaction. Records are encoded by tag, since Firefox gives the isolated world the page's objects (Q118). `StorageState`'s IndexedDB schema gained `keyPath`, `autoIncrement` and `indexes`. Import checks partitioned cookies before creating the context (`Incompatible`), sets the cookies, then, for each origin with storage, routes a seed URL of its own, navigates a page of the context there (or to a top-level page at the partition's site that frames it) and runs `writeOrigin` in the document's isolated world; the page is closed, and confirmed closed, before the context is returned (Q119). A context whose restore fails is removed.
- **Adapters.** `LocalValue` gained `Node{binding}`, which CDP and WebKit resolve into the realm called with `DOM.resolveNode` and BiDi passes as its shared id. `dispatchInput` takes the frame and its origin. `realm` waits for the main world's report on CDP and WebKit (Q120). New capability entries: `screenshot.cssScale`, `screenshot.omitBackground`, `pdf.headerFooter`, `pdf.preferCssPageSize`, `cookies.partitioned` and `snapshot.clickListeners`.
- **Settled while building.**
  - **An action scrolls each iframe on its way into view before the frame's checks,** in the routing rather than only for coordinates: Chromium renders nothing in a cross-site frame outside the viewport, so the checks never saw a frame (Q110).
  - **A round the deadline cut short adds nothing to an action's history** (Q123): under a short deadline a covered iframe was reported as `NoRenderingOpportunity`, `NoMatch` or `NotStable`.
  - **Requests to one document race the page's undecided dialog,** as requests through the page do: the guard's `disarm`, now sent to the document it was armed in, otherwise hung on Chromium and WebKit, which block evaluation while a dialog is open. The full suite caught it.
  - **`locator.frame(iframe)`** takes an iframe locator built from that locator, or applies the iframe's query under it; **`frameLocator.frame(iframe)`** takes one built from that frame locator; `page.frame` takes any of the page's. `and` and `or` across frames, and a handle used after `release`, are defects.
  - **Snapshot details:** text is a `text` node and an iframe an `iframe` node (Q124); `generation` names the engine's table, and `Suspended` is never given (Q125); a list item's name doesn't come from its content, so its text is a child, which call site 16's patterns must say.
  - **An `Element` capture of no single element is `InvalidInput`** (Q126), and an element is measured, never waited for.
  - **Origin storage and the cookie jar map what their error channels lack** onto `BackendFailure` (Q131); `readHtml` reads from the engine's world (Q133); handles are released one at a time (Q132).
  - **Firefox's isolated world reads IndexedDB through waived Xrays and copies bytes through the page's `Uint8Array`** (Q118, Q129).
  - **Sites are approximated without the public suffix list** (Q127).
- **Probes:** input over same-origin and cross-site frames, and to a frame's own context; what names an iframe's frame; screenshots of each area, scale and format; cookies as each backend reports them, an expired set, and one for another site; origin storage and IndexedDB from the isolated world; and another origin's storage written from a routed page, on the three pinned builds.
- **Tests.** `test/integration/slice/contents.ts` runs 21 tests on each backend: values, throws and `NotSerializable`; handles, their release and their realm's end; `Locator.evaluate`; a user gesture; reads, actions and expectations in a same-origin and a cross-site frame, nested frames, a frame that navigates and one added later; an iframe scrolled into view and one covered; the frame tree; the tree with inferred interactivity, refs and `StaleRef`, diffs, and a frame's tree; call site 16, a pattern that waits and one that fails with what it saw; `nearest` and `suggestions`; every screenshot area, JPEG, CSS scale and a transparent background or `Unsupported`; PDFs or `Unsupported`, and `readHtml`; cookies, `listFor`, `remove` and partitions or `Unsupported`; origin storage; and call site 1 to the end, with IndexedDB and a partitioned frame's storage. The conformance suite adds `contentFrame`, a node passed across worlds, and input sent with a frame. Integration tests: 405; one full run passed but for Q69.
- **Not built yet:**
  - click listeners in snapshots (`snapshot.clickListeners`, unsupported everywhere);
  - a frame's own evaluation (`frame.evaluate`), which the API doesn't declare;
  - a drag from one document to another on Firefox (Q111);
  - batched handle releases (Q132);
  - `Page.inspect` and `control`, `Page.capability`, and access levels in general (since built, but for `Page.capability`: Attaching and access, below);
  - attaching (since built: Attaching and access, below).

**Built** (2026-10-24): attaching and access. Call site 7 of API.md runs on Chromium and Firefox, against a browser started with two tabs that a layer attaches to; access levels run on all three backends, through a launched browser's own first tab and its default context.

- **Connecting** (`src/internal/connect.ts`; `Chromium.layerConnect`, `Firefox.layerConnect`, `Bidi.layerConnect`). An endpoint is parsed and resolved: Chromium's WebSocket URL as given, or its HTTP endpoint through `/json/version`, read with `HttpClient` over `fetch` (Q148); Firefox's remote agent with `/session` added when the URL has no path; any BiDi endpoint as given. The WebSocket gets `ConnectOptions.headers`, and the adapter connects with `ownership: "attached"`.
- **The BiDi adapter** ends a session it started in its scope's finalizer, bounded by a second (Q137), and says why a connect is refused while another client holds Firefox's one session. It maps and reports the default context before subscribing, since Firefox reports existing contexts as the subscription is answered (Q138). An attached session's prompt settings leave file choosers to the browser, and `fileChooser`'s limitation says so (Q140).
- **Access** (`src/internal/access.ts`, `refusals.ts`; `browser.ts`, `page.ts`, `locator.ts`, `handles.ts`). A page the connection created, or one in a context it created, is controlled for its life. Any other page has an observed handle (`PageImpl.observed`): its state, frames, workers, `closed`, the event modules, and `inspect` and `control`, which acquire a grant in the caller's scope (`Access.acquire`) and return a handle made under it; `inspect` installs the caller's isolated world first. A handle under a grant is guarded: each member above observe checks the grant, failing with `TargetGone{AccessReleased}` once it is released, or, for members whose errors have no `TargetGone`, with their module's `NotPermitted` (or the clock's `NotInstalled`, Q143); locators carry the grant in their owner, and `Expect`, `Dialog.handle` and `FileChooser.handle` check it through `Handles`. Declarations made through a granted handle are removed when the grant is released. `ObservedUserContext.control` grants a context, whose pages come under the same grant (Q145); a page's `context`, when its context isn't controlled, refuses with `NotPermitted` (Q144).
- **What a connection sees.** The model keeps every page in a list (`pageList`), which `Browser.pages` shows, `Page`s for the pages controlled for life and observed handles for the rest (`Runtime.observed`). The default context has `pages`, `workers` and `control`. Popups of observed pages are delivered as observed pages. A request to a page that never reported a document times out with a hint that a dialog may be open (Q139).
- **Settled while building.**
  - **Firefox renders an attached browser's background tab about once a second** (Q71), so the call site's click in the second tab never settled until the tab was brought to the front; the tests call `tab.activate` under control. API.md's call site doesn't.
  - **A released grant refuses some members with their module's `NotPermitted`,** or the clock with `NotInstalled`, since their errors declare no `TargetGone` (Q143).
  - **A page's `context` refuses with `NotPermitted`** when its context isn't controlled (Q144); the handle is what refuses, not the context's members.
  - **A launched browser's first tab is observed on every backend** (Q141), which the access tests use.
  - **Chromium's endpoint lookup is read with `fetch` provided inside the layer** (Q148).
- **Probes:** a launched browser's first tab; two tabs adopted on connect, an isolated world and an intercept on them; headless Chromium with two URLs; Chromium's HTTP endpoint; several clients; what a closed connection leaves, and Firefox's sessions; a dialog across a disconnect; and the BiDi adapter's contexts, on the pinned builds.
- **Tests.** `test/integration/slice/attaching.ts` runs on each backend: a launched browser's pages, its first tab controlled for a scope, `AccessReleased` and `NotPermitted` after it, a route removed with its grant, and `inspect`; the default context controlled for a scope, a cookie, a page it made closed with the scope, and a dialog no policy decides, which blocks reads with `PromptBlocking`. On Chromium and Firefox: call site 7 against a browser the test starts with two tabs, attached through Chromium's HTTP endpoint, and both tabs and the route's end checked by a second connection. On Firefox: a second client refused while one holds the session, and accepted after it ends. The conformance suite checks the browser's first tab is in the default context. Integration tests: 414; each of two full runs failed one test, a Chromium close under load (Q149, new) and Q69.
- **Not built yet:**
  - `WebKit.layerAttach`, for stock WebKit's remote inspector, which needs its protocol generated as a backend of its own (since built: Stock WebKit, attached, below);
  - `Page.capability` (`AxTree`, `Screencast`), with the tooling (since built: The rest of the API surface, below);
  - a dialog open on a page when a client attaches, which nothing reports (Q139);
  - ending a session a dead program left behind (Q146);
  - a persisted ledger of what a connection owns, which CONCEPTS.md §3 defers.

**Built** (2026-10-24): the rest of the API surface, capabilities and testing. Recordings, the agent toolkit and the CLI follow, below.

- **Launch profiles** (`src/internal/profiles.ts`; `LaunchProfile`). `stock`, `automation` and `concurrent` are values naming the Chromium arguments and Firefox preferences the launchers apply, kept in one module the launchers read too; a launch uses a value's own arguments and preferences, so one built by hand applies as given. Each launch opens a span (`Chromium.launch`, `Firefox.launch`, `WebKit.launch`) with the executable and the profile used.
- **Spans** (`src/internal/spans.ts`, `tracing.ts`; `Browser.SpanNameGenerator`, `TracerDisabledWhen`, `TraceProtocolCommands`; `Diagnostics.CurrentPreset`, `withPreset`). One helper opens every operation's span, at each site that opened its own before and the new ones: it names the span with `SpanNameGenerator`, skips it when `TracerDisabledWhen` says so, derives the operation's target from its `browser.page.id`, `browser.context.id` or `browser.realm.id`, and adds `browser.operation`. Declarations and locators gained their page's or context's id. A URL attribute (`url.full`, now on `goto`, and a connect's `browser.endpoint`) is shown as the preset allows: whole under `"local"`; under `"strict"`, the default, without credentials or fragment and each query value `REDACTED`. The references live apart from `Browser` so the protocol client can read `TraceProtocolCommands`, which wraps each command, where it is sent, in a span named by its method, with `browser.protocol.method` and `browser.protocol.id`. The model's log of a route decision it couldn't apply redacts its URL the same way (Q156).
- **Made files** (`src/internal/fileInput.ts`; `FileInput.bytes`). A file of bytes is made in the caller's isolated world: the bytes cross as base64, become `File`s set on the input through a `DataTransfer`, and `input` and `change` are dispatched. `setInputFiles` sets them on its one match; `FileChooser.choose` sets them on the chooser's input, by the binding the backend gave, and lets the chooser go as canceled (Q152). A list mixing them with paths is `InvalidInput` (Q153).
- **`AriaRole.all` and `isAriaRole`**: the 82 roles the type names.
- **`goto({ accept })`.** `PageNavigation` gained `BecameDownload{id, url}` and `NoContent{id, url, response}`, returned only when `accept` names them; the adapters' `NoContent` outcome now carries the navigation's response hop on every backend, which the conformance suite checks.
- **`close({ runBeforeUnload: true })`.** The adapters already prompted; the model now tells a closing page when a handler answers its `beforeunload` prompt with stay, and the close fails with `CloseCanceled`, the page open. The policy leaves, as before. Browsers prompt only after the user has interacted with the page (Q150).
- **Capabilities** (`src/internal/capabilities.ts`; `Page.capability`, `Capability.AxTree`, `Screencast`). The contract gained `accessibilityTree(page)` and `screencast(page)`, and the support tables `capability.axTree` and `capability.screencast`. Acquiring one the table marks unsupported fails with `Unsupported`, naming the backends that have it. CDP reads `Accessibility.getFullAXTree`, leaving out ignored nodes and giving their children to their parent, and streams `Page.startScreencast` frames, acknowledging each as it is read. WebKit streams `Screencast.startScreencast` through the page proxy at the viewport's size. A frame's size is read from its JPEG header. BiDi has neither (Q151), WebKit no tree. The frames end with `TargetGone` when the page closes.
- **Testing** (`src/internal/fake.ts`; `Browser.layerTest`, `TestRun.TestRun`, `VitestBrowser.layer`). `layerTest` connects an adapter with no browser behind it, folded by the same model: a context and a page emit the facts a backend's would, and the first page plays the timeline on Effect's clock (`-` 10 ms, `commit`, `load`, `resp(name)`, `dialog(kind)`, `popup`, `crash`, `|`), with `info.protocol` `"fake"` (Q154). A request for the engine, input or a capture fails with `Unsupported`. `VitestBrowser.layer` adds a `TestRun` whose `info` reads Vitest's current test each time and whose `attach` records an artifact on it (Q157); `vitest` is an optional peer dependency.
- **Settled while building.**
  - **`Page.capability` declares `TargetGone`,** for a page closed before or during acquisition, as the page's other members do, so a released grant fails it with `AccessReleased`; it declared only `CapabilityError`.
  - **A made file and a path can't be mixed in one call** (Q153).
  - **The fake's `goto` and `reload` commit at once,** and its URLs are `https://example.test/…`.
  - **BiDi's screencast exists in Firefox, as a file** (Q151).
  - **Spans lose `Effect.fn`'s call site** (Q155).
- **Probes:** files made in the isolated world, a response's status text and timings, an accessibility tree and a screencast on each backend; and, for the build, a close that runs `beforeunload` on an untouched and a clicked page, and Firefox's `browsingContext.startScreencast` over raw BiDi.
- **Tests.** `test/Tooling.test.ts` checks, without a browser: the profiles' values against the launchers', the presets' redaction, the roles, span names, attributes, suppression and redaction through `layerTest`, the fake's timeline, dialogs, popups, crash and close under `TestClock` and its `Unsupported` engine, and `VitestBrowser`'s `TestRun`. `test/integration/slice/tooling.ts` runs 7 tests on each backend: made files set and chosen, a mix refused, `accept` for a 204 and a download, a close a handler stays and one it leaves, the accessibility tree or `Unsupported`, two screencast frames or `Unsupported`, and protocol command spans under their operation only where asked. Integration tests: 435; one full run passed.
- **Not built yet:**
  - recordings: `Har.record`, `Trace.record` and their exports, and `NetworkResponse`'s `statusText` and `httpVersion` (since built: Recordings, below);
  - `BrowserToolkit`, `CapturePolicy`, `CurrentSession` and the CLI (since built: Agents and the CLI, below);
  - a file screencast on Firefox (Q151);
  - an iframe's accessibility tree, which `getFullAXTree` takes a frame for.

**Built** (2026-10-24): recordings.

- **Responses** (`NetworkResponse`; every adapter). `statusText` and `httpVersion`: CDP's `statusText` and `protocol`, BiDi's likewise, WebKit's `statusText`, and its protocol from `loadingFinished.metrics`, which the `RequestFinished` fact now carries, since WebKit says it only as the response ends (Q166): `httpVersion` is `None` there, and a HAR takes it from the end. A route's paused response has the status text CDP gives it. A hop's end now records when it was reported.
- **The headers sent** (`HopHeaders`; the CDP adapter, the model). Chromium leaves `Cookie`, `Set-Cookie` and the other headers the network adds out of `requestWillBeSent` and `responseReceived`; the adapter subscribes to their `ExtraInfo` events and reports each as the hop's own headers, an early one held until its request is sent (Q158). The model keeps them on the hop, beside the response, for recordings; the event modules keep the headers the main events give.
- **Ids** (`Adapter.makeIds`). The counters are the process's, so no two connections mint the same id (Q162).
- **HAR** (`src/internal/har.ts`, `recordings.ts`; `Har.record`). A recording subscribes to the target's requests with no bound (`Events.recorded`) in a child scope of the caller's, which `remove` closes; each request is an entry with the model's hop (`Model.hop`), followed until the hop ends, and then, unless `content` is `omit`, its body is read through the adapter. Bodies are collected for the target first, as BiDi needs. An export waits for the bodies of the hops that ended, and for the hops in flight only under `inFlightAtStop: "wait"` (Q161). Entries are HAR 1.2 with Playwright's extensions: the library's timings (Q163), the headers sent where the backend reports them apart, cookies parsed from `Cookie` and `Set-Cookie`, `redirectURL` from `Location`, the body embedded as text or base64 or named by `_file`, and `_webSocketMessages` from the target's WebSocket connections, on the latest handshake to their URL. Cookie values, `Authorization`, `Proxy-Authorization` and a URL's credentials are `REDACTED` unless included. `minimal` drops headers, cookies, timings and pages. `content: "attach"` zips `har.har` with the bodies (`effect/encoding`'s `Zip`); files are written with Effect's `FileSystem`, a relative path resolved with its `Path`, and nothing is created on the way.
- **Trace** (`src/internal/trace.ts`, `recorders.ts`; `Trace.record`). A recording registers with the span helper, which reports each operation whose ids it covers, with the span it runs in, and runs the recording's end before the caller sees the result. An operation is a step under its parent's: a recorded operation's, or a span of the caller's, which becomes a step spanning the operations recorded inside it (Q165). In-page expectations' spans now name their page. Console messages and uncaught exceptions are recorded from the target's channels; `screenshots: "perAction"` takes a PNG after each action and navigation; `screencast` acquires `Capability.Screencast` for each page of the target as it appears, or polls JPEG screenshots; `network` runs a HAR recording beside it. `exportTrace` writes a zip of `trace.trace` (`context-options`, then `before` and `after` per step, `screenshot`, `screencast-frame`, `console` and `pageError` events, in time order), `trace.network` (`resource-snapshot` lines) and the files they name, with times in milliseconds on the library's clock and URL params redacted under the preset in force at export.
- **Settled while building.**
  - **`httpVersion` is an `Option`,** `None` on WebKit (Q166).
  - **The HAR's headers on Chromium come from `ExtraInfo`** (Q158): without them a HAR has no cookies there.
  - **Ids are unique within the process** (Q162), so the span helper can tell connections apart.
  - **An export waits for the bodies of ended hops** even under `markIncomplete`: an entry otherwise lost its body to the read still running (Q161).
  - **`Har.HarErrorReason` gained `InvalidInput`,** for a `url` that doesn't compile.
  - **Request bodies aren't recorded** (Q164), and a caller's span is a step spanning what it holds (Q165).
- **Probes:** a response's status text, protocol and timings on each backend; and, for the build, the headers Chromium's main events leave out, and the bodies and favicons it keeps or doesn't across a navigation (Q159, Q160).
- **Tests.** `test/Tooling.test.ts` adds a HAR of `layerTest`'s responses and a trace whose steps nest in the caller's span, with an error. `test/integration/slice/recordings.ts` runs 4 tests on each backend: a HAR with statuses, protocols, a JSON body, the library's timings, a cookie set and sent, and `Authorization` redacted and then included; a minimal HAR of one URL zipped with its body; a trace of an `Effect.fn` with a click under it, its screenshot, a console message, an uncaught exception and the page's network entry; and screencast frames, native or `Unsupported` on BiDi, and polled everywhere. Integration tests: 447; one full run failed one test, Firefox's traversal from its JSON viewer (Q69).
- **Not built yet:**
  - DOM snapshots in traces (`domSnapshots`, which fails as `NotBuilt`): they need Playwright's capture script, vendored and pinned, in the page's main world;
  - request bodies in a HAR (Q164), and a HAR's body for a document Chromium forgot (Q160);
  - holding a CDP response until its `ExtraInfo`, so events carry the headers sent (Q158);
  - `BrowserToolkit`, `CapturePolicy`, `CurrentSession` and the CLI (since built: Agents and the CLI, below).

**Built** (2026-10-24): agents and the CLI.

- **The toolkit** (`src/internal/tools.ts`, `toolkit.ts`; `BrowserToolkit`, `CapturePolicy`). The seventeen tools are `effect/ai` `Tool`s defined once, with Schemas for parameters, results (`{ outcome, sinceLast }`) and failures (`BrowserToolkit.ToolFailure`), and failure mode `"return"`. `make` binds them to a context through a session that names its pages, keeps each one's latest snapshot, its waits (`w1`) and its registrations (`r1`), and records the context's and each named page's event channels with no bound (`Events.recorded`) for the digest: navigations, popups (named as they come), dialogs and the policy's decisions, downloads, uncaught exceptions, console errors, responses of 400 or more, and requests that failed other than by cancellation, which a hop's end now records. Secrets are revealed at dispatch and put back as `%name%` in every result. Under `CapturePolicy.strict` screenshots fail with `NotPermitted`, snapshot text inside an editable field is masked, and console text is left out.
- **The CLI** (`src/internal/cli/`, `src/bin/strider.ts`; `CurrentSession`). As CLI.md's Built section says: a client that forwards a session's command over its Unix socket without loading Effect; a daemon per session, started detached, that parses commands with `effect/cli` into the toolkit's tools and the session's commands, serves them over `NodeSocketServer` one connection each, and ends at `stop`, its idle timeout or its owner's exit; segments; `state save` with mode 0600 and `--state` and `--fork` from `StorageState.Json`; `export test`; and `sessions` and `prune` in the client's process. The package compiles without Node's types, so the CLI uses Node's built-ins through an interface of its own (Q172).
- **Settled while building.**
  - **The tools that act bring their page to the front first** (Q167); the toolkit has no `activate`.
  - **`BrowserToolkit.toolkit` is typed by its tools,** and `ToolFailure` is public.
  - **The CLI's socket carries JSON lines, not `effect/rpc`** (Q171); `--attach`'s backend is read from the endpoint (Q168); the session's context is its own, so `control` isn't built (Q169); and a page a segment opens ends with it (Q173).
- **Tests.** `test/integration/slice/toolkit.ts` runs 2 tests on each backend: a page driven as a model would, with names, refs and locator strings, a secret filled and never echoed, the digest's console error and 404 once each, a wait for a popup across calls, a dialog decision and a route, and failures as data (a bad target, a ref from another page's snapshot, a missing page and a missing secret); and what each capture policy sends. `test/integration/Cli.test.ts` runs `strider` as processes on the pinned Chromium and Firefox: a session driven by page and target, through waits, a route, a dialog decision, a screenshot, a segment and a missing page, saved state, an exported test and `stop`; a session forked from another's state, and a daemon killed outright, listed and pruned; and the mistakes a command can make, with their exit codes, and the idle timeout. `test/Tooling.test.ts` checks the tool definitions, the masking, the argument scan and the exported locators. Integration tests: 456; of two full runs, one passed and one failed Firefox's traversal from its JSON viewer (Q69).
- **Not built yet:**
  - an MCP server command; `McpServer.toolkit(BrowserToolkit.toolkit)` serves the tools to a program today;
  - `strider control` (Q169), and a session's `downloads/` as its context's download directory;
  - transferring a page a segment opened into the session (Q173);
  - `history`'s `--level` and `--failed`.

**Built** (2026-10-25): lifetimes and flakes. The two flakes the full runs kept showing are traced under synthetic load and fixed, and so are the other quirks of this step.

- **The stress harness.** One integration test in eight or ten processes at once, each with its own browser, beside a dozen busy loops: a throwaway script, not kept, whose runs QUIRKS.md records.
- **Firefox's JSON viewer** (`LaunchProfile.automation`). `devtools.jsonview.enabled` is `false`, so a JSON response's document is the JSON as served. Q69 was the viewer's own path: a traversal that leaves the viewer before it has loaded gets no `navigationStarted`, the page is fetched again, and no document is reported. Under load, 12 of 32 runs of the history test failed with the viewer on, and none of 48 with it off (Q15, Q69).
- **A close Chromium drops** (the CDP adapter, `closePage`). Chromium answers a `Target.closeTarget` that arrives as a navigation commits and never acts on it: the page stays attached, alive and listed (Q149; 4 of 48 stress runs, and 10 of 120 closes over raw CDP). The adapter first sends `Page.getNavigationHistory` on the page's session, which Chromium refuses with "Not attached to an active page" during the swap and accepts once it is over, and which the browser answers with a dialog open or the page's script stuck. A `runBeforeUnload` close's `Page.close` goes through the same retry. With it, 100 of 100 stress runs passed, and raw CDP dropped no close in 120.
- **The swap's refusals** (the CDP adapter, `whileSwapping`). A command refused with "Not attached to an active page" is sent again at once, at most three times, instead of every 50 ms for a second (Q6).
- **Releases wait** (`Model.release`). A page released by its scope, or a popup by its opener's, is closed and then waited for, under the default budget, so a page created right after can't meet a browser still closing it (Q119, Q135).
- **Request tables** (`src/internal/retired.ts`; every adapter). A finished request stays answerable while there is room for 1000, and the oldest is forgotten after; before, the tables kept every request for the connection's life (Q177). A redirect's earlier hop ids stay, so a body read for one answers `Unsupported{body.redirect}` (Q39).
- **An event stream's body** (`NetworkResponse`). A response whose content type is `text/event-stream` is `BodyUnavailable{streaming}` at once (Q40).
- **Input** (`Input.recover`; `devices.ts`, `locator.ts`). After a held input's release failed, the next gesture sends that release again first, and runs if it gets through (Q84). A drag Chromium announces after its gesture's release is canceled with `dragCancel` before the next gesture (Q88).
- **File choosers** (`Handlers.Staged`). A decision the library carries out itself, as made files are, is counted in `handled` when the handler decides, and carried out after (Q152).
- **Firefox's clips** (the BiDi adapter, `screenshot`). A clip inside the viewport is captured with the `viewport` origin, offset by the scroll position (Q114).
- **Settled while building.**
  - **Q149 isn't a lost event.** Chromium sends no event at all: it drops the close.
  - **Q177 is new,** found while fixing Q39.
- **Probes:** closes sent as a navigation commits, with and without a page command first, and which page commands answer with an alert open.
- **Tests.** The conformance suite asks for a redirect hop's body. `test/integration/slice/modules.ts` adds an event stream's body, and `contents.ts` a clip below a short page in quirks mode; `tooling.ts` reads a chooser handler's count without waiting. `test/Input.test.ts` checks `Input.recover`. Integration tests: 462, all passing in one full run.

**Built** (2026-10-25): pages that render in the background.

- **Firefox's pages** (the BiDi adapter, `createPage`; `LaunchProfile.automation`). A page the library creates opens as a window (`browsingContext.create({ type: "window" })`), as Chromium's have since Q70, and `automation` sets `browser.link.open_newwindow: 2`, so a popup, or a link that opens a page, opens as a window too. A page behind another then keeps rendering, where a tab rendered about once a second (Q71).
- **Firefox's `null` user contexts** (`patches/navigationInfo-userContext.json`). Windows brought out a deviation: Firefox names no user context in the navigation events of the transient tab a new window opens, nor in `contextDestroyed` for a window whose user context was removed. Undecodable, each made the adapter rebuild its model from `getTree` mid-navigation, which broke navigation in windows. A correction makes both members nullable, and the adapter places no context it can't attribute (Q178).
- **Chromium's popups** (`locator.ts`). No switch keeps an opener rendering behind a popup opened as a tab over it. The `NoRenderingOpportunity` hint names `newContext({ focus: "emulated" })` beside `page.activate` (Q19).
- **The CLI** (`cli/daemon.ts`, `cli/exportTest.ts`). The session's context emulates focus on Chromium and WebKit, `start` says `focus emulated`, and an exported test makes its context the same way (`ExportTest.focusFor`).
- **Settled while building.**
  - **Firefox's windows needed a protocol correction** (Q178): the first full run with windows failed most of Firefox's adapter tests.
- **Probes:** the events of a window's creation and of its user context's removal, over raw BiDi and through the adapter's recorded traffic.
- **Tests.** `test/integration/slice/events.ts` adds a popup's opener acted on without `activate`: on Firefox as launched, on Chromium and WebKit with focus emulated, and on Chromium without it a timeout whose hint names focus emulation. `interaction.ts` acts on a page behind another on every backend without `activate`. The CLI test checks the session's focus and the exported context. Integration tests: 465, all passing in one full run.

**Built** (2026-10-25): network headers and bodies on Chromium.

- **Held responses** (the CDP adapter). A response whose `responseReceived` says `hasExtraInfo` waits for its `responseReceivedExtraInfo`, holding the hop's end if that comes first (an image's or a favicon's did), and is reported with the headers received, `Set-Cookie` among them; the current hop remembers them (`received`), and a redirect's next hop starts without. Only a response from the network waits: one from a cache, a service worker or a route can say `hasExtraInfo` and get no `ExtraInfo`, as a cache hit announced by `requestServedFromCache` did. A failure, a navigation's end or commit, and the request's retirement (Q177) release a held response with the headers it has (Q158).
- **Durable bodies** (the CDP adapter; `Registry.bodyLimit`). Where a body collection is declared, the page's session gets `Network.configureDurableMessages` with the collection's limit per body and ten times it in all, on the declaration and on each new target in scope, so a document's body outlives the next navigation (Q160).
- **The swap's refusals, again** (the CDP adapter, `whileSwapping`). The three resends of Lifetimes and flakes, above, ran out once in a full run, on a back/forward-cache restore, which refuses for longer than a commit: a refused command is now sent again as each refusal comes back, paced by the browser's answers alone (Q6).
- **Settled while building.**
  - **Durable messages are configured where bodies are collected,** not for every page the adapter attaches, so a page nobody reads bodies from keeps none in the browser.
  - **Only the network's responses are held:** `hasExtraInfo` isn't reliable, as a cache hit proved.
  - **WebKit forgets a left document's body too** (Q179); it stays without one.
- **Tests.** `test/integration/slice/recordings.ts`'s HAR test reads a response's `Set-Cookie` on every backend, and the body of a document the page left at once, on Chromium and Firefox. A full run found Q180, a crash another client causes that goes unreported under load, which fails as often without this step. Integration tests: 465, all passing in the last full run.

**Built** (2026-10-25): the API before a release.

- **`TargetGone` wherever it can happen** (`Page`, `UserContext`, `CookieJar`, `PageClock`, `Dialog.handle`, `FileChooser.handle`, `Har.record`, `Trace.record`, `Browser.newPage`; `internal/access.ts`, `guarded.ts`). As Target.ts says it is for every operation on a target. Declarations, cookies and the clock pass a target that went through as `TargetGone`, where they made it a `BackendFailure`; a context's own setup still reports one as its failure. A released grant fails every guarded member with `TargetGone{AccessReleased}`, so the table of module refusals is gone (Q143, Q131).
- **Origin storage's deadline is a `Timeout`** (`dispatchedUnconfirmed`), not a `BackendFailure` (Q131).
- **A capture's element** (`captures.ts`; `PageError`). None is `Locator.NoMatch`, several `StrictViolation` with the candidates (Q126).
- **`Watchable.Ended`** (`Watchable`, `internal/watchable.ts`). A wait on a value that settled on one it can't satisfy fails with the final value, not a `Timeout` (Q62).
- **`AutoResolution.policy`** is `ContextOption{ name, value }` or `Default` (Q63, Q105).
- **`NetworkResponse.MalformedBody`** for `json` of a body that isn't JSON (Q64).
- **`Condition` is `Pipeable`** (Q85).
- **Console text** (`internal/consoleFormat.ts`; the CDP and WebKit adapters). The Console Standard's formatter, applied to the arguments CDP and WebKit report; Firefox applies its own (Q33).
- **Settled while building.**
  - **`Dialog.handle`, `FileChooser.handle`, `Har.record`, `Trace.record` and `Browser.newPage` declare `TargetGone` too:** they refused a released grant the same way, or open a page in a context.
  - **Objects in console text read as each browser describes them,** not one way: WebDriver BiDi serializes an `Error` without its message, so one rendering would have dropped Chromium's. And Firefox's text can't be reformatted: it arrives as one argument, with `%f` written as printf writes it (Q33; reported in `upstream/`).
  - **`AutoResolution.policy`'s option is `ContextOption`,** not `Option`, which reads as Effect's.
- **Tests.** `test/ConsoleFormat.test.ts` checks the formatter; `modules.ts` formats a call on every backend, waits for a canceled download to complete and gets `Ended`, and reads the new policies; `contents.ts` expects `NoMatch` for a capture of no element; `attaching.ts` expects `TargetGone{AccessReleased}` from a released route and cookie jar. Integration tests: 468, all passing in one full run, a file at a time.

**Built** (2026-10-26): CLI sessions and agents. The library has no dependency but `effect` since `@usestrider/vitest` was split out, just before this step.

- **Tabs and control** (`internal/toolkit.ts`, `tools.ts`; `BrowserToolkit.MakeOptions.browser`). `tabs` lists `Browser.pages` the session hasn't named; `control` takes one, by id or by a URL pattern that matches exactly one, with `ObservedPage.control` in a scope forked from the toolkit's; `release` closes that scope. The CLI's `tabs`, `control` and `release` are these tools (Q169).
- **`find`** walks the page's latest snapshot, taking one if there is none, for nodes whose name contains the query, or equals it with `exact`, narrowed by role. A match without a ref of its own reports its nearest element with one, with the path of named elements it is in.
- **History filters.** `history`'s `level` uses `ConsoleMessage`'s filter. `failed` lists responses of 400 or more and requests whose hop ended `Failed` without being canceled, in time order: the digest's rule.
- **Downloads** (`UserContext.Options.downloads`; `internal/browser.ts`). `"deny"` declares `Downloads{Deny}`, and `{ directory }`, which must be absolute, `Downloads{Allow}` there. The CLI's sessions download into their own directory (Q25).
- **Transfers** (`Model.transfer`, `Model.release(page, by)`; `CurrentSession.keep`). A scope releases a page only while it still owns it, so a page transferred to the session's scope outlives the segment that opened it (Q173).
- **`strider mcp`** (`internal/cli/mcp.ts`). `McpServer.layerStdio` with `McpServer.toolkit(Tools.toolkit)`, each handler forwarding a `Tool` request to the session's daemon, which runs it and answers with `ToolResult`, the result encoded by the tool's Schema, decoded again here. Every log goes to standard error (`Logger.LogToStderr`). Tools without parameters use `Tool.EmptyParams`.
- **The ledger** (`Ledger`; `internal/launch.ts`, `browser.ts`; `strider prune`). The launchers record each browser with its profile, and each temporary profile and downloads directory, through `Ledger.CurrentLedger`, which records nothing unless `Ledger.layer` provides it; each is forgotten after it is gone. The daemon provides it on `$XDG_STATE_HOME/strider/ledger`. `prune` with no name reads the records, takes a program as gone when its process id is dead or, where `/proc` says when it started, is another process's, and with `--yes` kills what runs from a recorded profile, found by its command line, and removes recorded directories (Q146).
- **Settled while building.**
  - **The toolkit's reach beyond its context is an option** (`browser`), not a given.
  - **Firefox user contexts on an attached browser aren't in the ledger** (CONCEPTS.md §3, Ownership ledger).
  - **An MCP client's tool calls go through the daemon's socket as their own request,** `Tool`, beside the CLI's `Command`, so the client's calls are recorded for `export test` as the CLI's are.
- **Tests.** `test/Sessions.test.ts` checks the ledger's records, `strider mcp`'s arguments and an exported controlled tab. `test/integration/slice/toolkit.ts` finds a ref, filters history and takes a launched browser's own tab on every backend. `test/integration/Cli.test.ts` takes a tab, finds, filters, keeps a segment's page, downloads into the session, serves MCP to a client over stdio, and lists and reclaims what a killed daemon's ledger names. Integration tests: 472, all passing in one full run, a file at a time.

**Built** (2026-10-26): the network.

- **Headers sent** (`NetworkRequest.headersSent`; `Model.HopEntry.sentKnown`; the adapters' `HopHeaders`). The model completes a hop's `sentKnown` with its first request-phase `HopHeaders`, or as the hop ends. The CDP adapter reports the request `ExtraInfo`, or the request event's headers once a `responseReceived` without `hasExtraInfo` says none will come; the BiDi adapter reports the request event's, which have the cookies; the WebKit adapter reports the response's `requestHeaders`, or the event's where a redirect's response has none (Q158, Q181). `headersSent` waits under the operation's budget, and a hop the model no longer keeps gives the event's headers.
- **Request bodies** (`Adapter.requestBody(hop)`; `pausedRequestBody` is the paused request's, renamed; `Declaration.BodyCollection.bodies`; `internal/har.ts`). A body collection names the bodies it keeps, `"request"`, `"response"` or both, and `Declarations.bodyLimit` takes the kind. CDP keeps each hop's body as its event carried it where a collection of requests covers the page and it fits, and reads one not carried with `Network.getRequestPostData` for the last hop only (Q182); BiDi adds `"request"` to the collector's data types and keeps each hop's `bodySize`, so a hop that sent none isn't asked (Q183); WebKit keeps each hop's `postData` (Q184). A HAR always collects requests' bodies, and responses' unless `content` is `omit`; its recorder reads each hop's request body as the hop ends, and a trace's doesn't. The export writes `postData` only when `include` names `"requestBodies"`: text for a textual type, with `params` for a form; otherwise base64 with `_encoding` when embedded, or a file `<hop>-request.<ext>` beside the HAR when attached; `bodySize` always (Q164).
- **HAR replay** (`Route.fromHar`; `internal/harReplay.ts`; `Har.ReadFailed`). Reads the file with Effect's `FileSystem` and, when it starts with a zip's signature, decodes it with `Zip.decode` for `har.har` and the files it names; the log is decoded by a Schema of what replay reads. A handler matches method and URL exactly, then the body where both have one, and takes the latest. It fulfills with the entry's status, headers and decoded body, without `Content-Encoding`, `Content-Length`, `Transfer-Encoding` or a redacted `Set-Cookie`; aborts for an entry without a response; and answers no match with `notFound`.
- **`URLPattern` intercepts** (`internal/routes.ts`, `covering`). The fixed prefix runs to the first `:name`, group, modifier, `\`, `#` or `*`, is cut before any character a URL would encode, and has its origin rewritten by `URL`; one that ends inside the origin keeps the scheme (Q106).
- **Response-phase changes** (`Route.continueWith(ResponseChange)`; `Adapter.Decision.ContinueResponse`). CDP sends `Fetch.continueResponse` with `responseCode` and `responseHeaders`; BiDi `network.continueResponse` with `statusCode` and `headers`; WebKit fails `Unsupported` under the new capability entry `interception.responseHeaders` (Q93). Several `Set-Cookie` values go as separate headers, as a fulfilled response's do.
- **WebKit's left documents** (`webkitAdapter.ts`, `RequestEntry.kept`). As a document's load finishes, where a collection of responses covers the page, the adapter reads its body at once into a `Deferred`, which `responseBody` awaits (Q179).
- **Settled while building.**
  - **`Route.fromHar` is an `Effect` that makes the handler:** `page.route(pattern, yield* Route.fromHar(path))`. It reads the HAR as it is made, so a missing or malformed file fails there, not as every request's handler failure, logged and continued.
  - **A body collection names the bodies it keeps,** so a HAR with `content: "omit"` still keeps requests' bodies without Firefox collecting every response's.
  - **A request body on Chromium is kept from its event** where a collection covers the page, since `Network.getRequestPostData` can't read an earlier hop's, and only a body the event didn't carry is read by id.
  - **A redirect is replayed as a redirect,** which WebKit doesn't follow (Q90), rather than collapsed into the response it led to.
  - **The response-phase change's headers replace the server's whole,** as both protocols do.
  - **WebKit's headers sent come with the response,** not at once: its request event leaves `Cookie` out (Q181).
- **Tests.** `test/Network.test.ts` checks `URLPattern` intercepts, `postData` as each export writes it, and replay's matching, reading of a zip told by its signature, and failures. `test/integration/slice/recordings.ts` records a form, a `307` and a file on every backend and checks the headers sent have the page's cookie, then replays a HAR by body and, but on WebKit, through a redirect; its HAR test now reads a left document's body on every backend. `declarations.ts` changes a response's status and headers, unchanged on WebKit, and matches a `URLPattern` route. Integration tests: 484, all passing in one full run, a file at a time.

**Built** (2026-10-26): pages.

- **Frames' navigations** (`PageNavigation.Filter.frames`; `Model.NavigationEvent.frame`). The model follows a frame's navigations from start to end as it does a page's, and publishes them on the page's channel naming the frame; a subscription keeps the page's own unless it asks for `"all"`. Every `PageNavigation` has `frame`, the page's id for its own; `settle` takes it.
- **Init scripts and the clock in dedicated workers** (`InitScript.Options.workers`, `PageClock.InstallOptions.workers`; `Declarations.workerBundle`; the capability entry `initScripts.workers`). A worker's bundle is the main world's scripts declared for workers, in the documents' order. The CDP adapter resumes a dedicated worker that gets one with a `beforeScriptExecution` instrumentation breakpoint set and runs the bundle where it pauses, then disables the debugger (Q187); the WebKit adapter runs it before `Worker.initialized`. BiDi refuses. The clock's shim does without animation frames where a worker has none, and its operations reach the pages' dedicated workers' realms.
- **Iframes in the accessibility tree** (`cdpAdapter/capture.ts`, `frameTree`). Each frame's tree is read with `getFullAXTree({ frameId })` on the session that owns the frame; an `Iframe` node's element is described (`DOM.describeNode`) for the frame it holds, whose tree goes under it.
- **Keyboard layouts** (`Keyboard.Layout`, `UserContext.Options.keyboardLayout`; `internal/keyboardLayouts.ts`, generated by `strider-codegen keyboards` from CLDR release 43's Windows layouts in `packages/tools/codegen/keyboards`; `keys.ts`, `Input.type`). A character's strokes are its key with the layout's Shift and AltGr, the dead key then its other key, or a key with an empty `code`; AltGr is the `AltGraph` key, never a flag. Named keys are the same on every layout. The BiDi adapter leaves out `AltGraph` and `Dead` key events (`input.keyboardLayout`, `partial`).
- **Synthetic drag** (`Locator.DragOptions.html`). With `"synthetic"`, `dragTo` resolves both elements, requires one document, and calls a function in the isolated world that dispatches the drag's events with one `DataTransfer`, after removing the guard the checks armed; the outcome (`dropped`, `refused`, `canceled`) is on the span. `"native"`'s `Unsupported` hint names it.
- **Handles by group** (`evaluation.ts`, `Evaluation.groupOf`; `internal/objectGroups.ts`; `EvaluationCall.group`). A scope's handles in a realm share a group named for it, released as the scope closes with one `releaseHandles` call; an adapter releases a group given whole in one `Runtime.releaseObjectGroup`, and other handles alone. WebKit's results join the group of the object a call is made on, so the adapter makes an object in the group and calls on it with its helper as an argument (Q185); BiDi disowns a realm's handles in one `script.disown`.
- **Settled while building.**
  - **Chromium's workers run their scripts at a breakpoint,** not while paused at start, where their global has no timers yet (Q187).
  - **One capability, `initScripts.workers`, names both:** the clock in workers is an init script.
  - **The clock reaches workers only when asked,** `install(mode, { workers: true })`, so a clock installed without it still works on Firefox.
  - **Layouts come from CLDR release 43's Windows data,** the last with per-platform layouts; Keyboard 3.0's has only `fr` of these. Dead keys are typed too.
  - **Capitals hold Shift on every layout, `us` included:** before, `type("A")` sent `A` without Shift.
  - **Firefox follows a layout's keys only** (`input.keyboardLayout`, `partial`; Q189), and WebKit's key events don't carry modifiers (Q188).
- **Found by the full run.** The WebKit adapter could create a world twice for a page just made, its target's setup and a first locator at once (Q190); both now take a world that exists as made.
- **Tests.** `test/Keys.test.ts` checks strokes on each layout; the codegen package's `test/Keyboards.test.ts` the parser. `modules.ts` follows a frame's navigation; `declarations.ts` runs a script and a controlled clock in a worker, adjusted; `tooling.ts` finds a same-site and a cross-site iframe's buttons in the accessibility tree; `interaction.ts` types `zY@ê` on `de` and drags with `html: "synthetic"` on every backend; `contents.ts` counts the release commands as a scope closes. Integration tests: 499, all passing in one full run, a file at a time.

**Built** (2026-10-26): traces.

- **DOM snapshots** (`Trace.Options.domSnapshots`; `internal/capture.ts`, `trace.ts`; research/playwright-trace-snapshots.md). The capture is a self-contained function installed beside the engine in each document's utility world under its own symbol, with four members: `frames` (the document's iframes whose frame isn't known yet, by value, so each has a node binding the adapter's `contentFrame` names), `mark` (each iframe and its frame's id, written as its `src`), `target` (the action's element and whether its value is a secret) and `capture`. Each recording's captures in a document are one stream, so references stay within it; a frame whose capture fails is left out and its next capture made with no references. The recorder captures every current document of the action's page, a page with a prompt open aside, before and after each action and navigation (`Recorders.begin` now runs before the operation, and is an `Effect`); a locator's actions provide their steps and whether their value is `Redacted` (`Recorders.CurrentSubject`), which resolve the target before the action and, if it wasn't there yet, after. The export writes `frame-snapshot` events with the action's `callId` and `phase`, each changed linked stylesheet once, by its text's SHA-1, as `resources/<sha1>.css`, and secret values redacted under the strict preset.
- **Video** (`Capability.Video`; `Adapter.video`; the capability entry `capability.video`). The BiDi adapter starts `browsingContext.startScreencast` with the context's downloads directory as `destinationFolder`, stops it as the scope closes, and gives the path `stopScreencast` answers; an attached Firefox and a context without a downloads directory are refused. A trace's native screencast records it on Firefox, and the export stops it once, reads the file through the layer's `FileSystem` and adds a `video` event, its size read from the WebM's `PixelWidth` and `PixelHeight`.
- **The contract's check** (`strider-codegen trace-contract <playwright checkout>`; `packages/tools/codegen/trace-contract.json`). The four Playwright files the capture's contract was read from, at v1.64.1, by SHA-256.
- **Settled while building.**
  - **The capture runs in the engine's world,** an isolated world of the library's, beside the engine, whose element lookups it uses for the target, rather than the caller's.
  - **A canvas isn't captured as image data:** the viewer draws canvases from the action's screenshot by their box, which is what the capture writes (Q192).
  - **Every same-origin linked sheet is an override,** read from `cssRules` on each capture, by reference while unchanged, since nothing says which ones the page changed.
  - **Firefox's video goes where the context downloads,** through `destinationFolder`, not the browser's downloads folder, which could be the user's own; a trace's video ends at its first export (Q193).
  - **Snapshots are `before` and `after`,** not also `action`.
- **Checked in the viewer.** A trace from the test below was opened in trace.playwright.dev by a CLI session, which read the rendered snapshot through a frame locator (research/playwright-trace-snapshots.md, Checked in the viewer).
- **Also.** CDP's `capability.axTree` entry no longer says "the main frame's document", which iframes in the accessibility tree made untrue (Pages, above).
- **Tests.** `recordings.ts` records a page with a `<style>`, an adopted sheet, an open shadow root, an iframe, a filled input and a `Redacted` password, then clicks, and expands every reference as the viewer does: the button before and after the click, the target, the values and the redaction under each preset, the shadow root, the sheets, and the iframe's own snapshot; on Firefox, a native screencast is a WebM video. `tooling.ts` records a video on Firefox, and expects `Unsupported` elsewhere. Integration tests: 508, all passing in one full run, a file at a time.

**Built** (2026-10-26): stock WebKit, attached.

- **The protocol** (Code generation, Built for stock WebKit): `@usestrider/browser/webkit-stock-protocol`, generated from WebKitGTK 2.54.1's source.
- **The transport** (`internal/webkitStockTransport.ts`; `connect.ts`, `webkitInspector`). It reads the inspector server's list at `/`, HTML whose Inspect buttons name each page's WebSocket (Q196), opens a WebSocket per page, and presents them as one transport in Playwright's envelope, so the WebKit wire and adapter serve both builds:
  - a page is a page proxy, `<connection>-<target>`, announced by `Playwright.pageProxyCreated` in the default context, and ended by `pageProxyDestroyed` when its WebSocket closes while the list still answers; a list that can't be read loses the connection;
  - `Playwright.enable` is answered as Playwright's build answers it, the pages open announced before the reply, and the list is read every 250 ms after; any other command with no page proxy is answered `Method not found`, which the wire reads as `Unsupported`;
  - each target's frame, loader and request ids are qualified with its page proxy's id and its own (Q195), on the paths the adapter reads, never by walking a message, and unqualified in the commands sent to it.
- **The adapter's stock profile** (`webkitAdapter.ts`, `Options.profile: "stock"`). The events stock WebKit has, three in its own shapes: load events without `frameId`, and `targetDestroyed` without `crashed`. No `Playwright.getInfo`, so `Browser.info` is `WebKit (stock)`, its version `unknown` (Q203); every page is adopted; a page's later targets are paused with `Target.setPauseOnStart` and resumed after their setup; no viewport is set. The capability table is the patched build's with what stock WebKit lacks (`stockCapabilities`), and the operations it lacks refuse with `Unsupported`. Its own:
  - `navigate` runs `location.href = url` in the main frame's current document, or in a child frame's main-world realm, once the page's first snapshot is in; it refuses a referrer, and a fragment of the document shown (Q200);
  - a document's failed request ends its navigation: `BecameDownload` when the response said `attachment`, `NoContent` after a 204 or 205, otherwise `Failed` with the error (Q198); the error page, `about:blank`, claims no `goto` elsewhere, and one that starts while a `goto` waits fails it (Q199);
  - `screenshot` is `Page.snapshotRect`, PNG at the device's scale;
  - cookies are `Page.getCookies`, `setCookie` and `deleteCookie`, through any open page;
  - an adopted page's `document.readyState` is asked as its first target is set up (Q201).
- **The engine's world** (`Runtime.engineWorld`, `Runtime.ownWorld`). Where `isolatedWorlds` is `unsupported`, the engine, the trace capture, `inspect`'s setup and the storage reads run in the main world (Q194); a caller's `evaluate` is refused.
- **Refused input says nothing was sent:** an action whose `dispatchInput` fails `Unsupported` reports `dispatch: NotSent`, on every backend.
- **`WebKit.layerAttach(endpoint, options?)`** takes an `http:` or `https:` endpoint; `options.headers` go with the list's requests and each handshake.
- **The test machine.** `flake.nix` pins WebKitGTK 2.54.1 (`browsers.json`, `webkitgtk`) and names its MiniBrowser in `STRIDER_WEBKITGTK` and Xvfb in `STRIDER_XVFB`. `test/integration/stockWebKit.ts` starts Xvfb on a display it picks (`-displayfd`), and the MiniBrowser with its inspector on a free port, a profile and XDG directories of its own, and scripts allowed to open windows (Q202).
- **Settled while building.**
  - **One adapter with two profiles,** not an adapter of its own: of the events the patched adapter reads, three differ in shape, so the stock profile swaps its events, capabilities and a few operations, and the transport presents stock WebKit's pages in Playwright's envelope.
  - **Only WebKitGTK's and WPE's inspector server is read:** ios-webkit-debug-proxy lists its pages another way, and nothing here could test it.
  - **Input is refused, not shimmed.** CONCEPTS.md planned synthetic input for stock WebKit; untrusted events aren't the input they'd stand for, so input is `Unsupported` and a page's own script can dispatch events. CONCEPTS.md now says so.
  - **The engine runs in the page's world** (Q194): stock WebKit can make no world.
  - **The CLI's `--attach` doesn't reach it** (Q168; CLI.md, Built).
  - **The MiniBrowser runs under Xvfb,** a display server, since it has no headless mode (Q202).
- **Tests.** `test/StockWebKit.test.ts` reads a list whose page wrote a socket's path into its title, and qualifies a target's ids on their paths and nowhere else: not in a header's name, not in an evaluation's value. `test/integration/StockWebKit.test.ts` attaches to a MiniBrowser: call site 7 on two tabs whose ids are numbered alike, with a route the page's own click goes through, and both tabs left for a second connection; navigations across processes, to a 404, a redirect, a refused connection, a blocked port, a 204, a download, a fragment and a reload; console messages, a fulfilled route, an init script in the main world, cookies, storage and a full-page screenshot; the capability table and the refusals of `newPage`, a click (`NotSent`), `evaluate` and a JPEG; a page the browser opens, found, and the browser's exit, as `ConnectionLost`. Integration tests: 513, all passing in one full run, a file at a time.

**Built** (2026-10-26): the inspector server's socket and the Automation protocol, which the adapter's launched profile drives, below.

- **GVariant** (`internal/gvariant.ts`). Encodes and decodes from type strings, with GVariant's alignment and framing offsets: the basic types, strings, variants, maybes, arrays, tuples and dictionary entries, as `boolean`, `number`, `bigint`, `string`, `{ type, value }`, `null` and arrays. Encoding is little-endian; decoding takes either; malformed data throws `GVariantError`.
- **The socket** (`internal/webkitInspectorSocket.ts`). A frame is the body's size in four big-endian bytes, a flags byte (bit 0, little-endian), the message's name, a nul and its parameters. `connect` takes an Effect `Socket` the program made, so the library opens no connection of its own, and gives `send`, the server's messages as a stream, and `closed`. It reads `DidStartAutomationSession`, `SetTargetList`, `SendMessageToFrontend` and `DidClose`, and writes `StartAutomationSession`, `Setup`, `SendMessageToBackend` and `FrontendDidClose`; a message it doesn't know is skipped, a frame that doesn't parse loses the connection.
- **The protocol** (Code generation, Built for WebKit's Automation protocol).
- **The debugger's cost** (Q207). With the debugger attached, a benchmark page's JavaScript ran about 80% slower, and a symbolic breakpoint can't read a prompt's default value. By the maintainer's decision, the adapter learns no dialog's kind, and reports one as `Dialog.Unknown` (Q206).
- **Settled while building.** **The socket is the program's,** an Effect `Socket`: Effect has no service that opens a TCP connection to a port chosen at run time, so `WebKit.layer` will need one the program provides, which `NodeSocket.makeNet` satisfies.
- **Tests.** `test/WebKitInspectorSocket.test.ts` encodes and decodes the GVariant specification's examples, frames `StartAutomationSession` as the MiniBrowser accepted it, reads the frames it sent however they're split, and connects to a server that plays them. `test/integration/WebKitAutomation.test.ts` starts a session with the MiniBrowser in automation mode, which names itself and the pinned version, opens a page and, once its first document has loaded (Q211), navigates it, clicks it (`isTrusted`), types `hé@`, takes a screenshot, answers a `confirm`, and evaluates in the same page as an inspector target on the same socket. Integration tests: 514. In the full run, a file at a time, the other 513 passed and the new test failed for Q211; after the fix, it passes alone, five times out of five, and beside the stock WebKit tests.

**Built** (2026-10-26): stock WebKit, launched in automation mode.

- **`WebKit.layer` with the MiniBrowser** (`internal/webkitAutomation.ts`). An executable named `MiniBrowser` is launched with `--automation` and `WEBKIT_INSPECTOR_SERVER` on a random port, tried again on another while its stderr says the port is taken (Q216), with the XDG directories in a temporary one; the program's `SocketConnector` connects, and the session starts. `headless: true` is `InvalidInput`.
- **`SocketConnector`** (`@usestrider/browser/protocol`; `SocketConnector.layer`, `fromSocket`). The shape of Effect-TS/effect#8735's `effect/socket/SocketConnector`, provisional. The CLI's daemon provides it from `NodeSocket.makeNet`, and an exported test does for stock WebKit.
- **A process per context** (`Group`). The default context's process announces its first window, as every backend's first tab (Q141), and opens one more, minimized, as its anchor; a context's process keeps its first window as its anchor. A process claims its first window before anything else, since the first page asked for takes it (Q213). A context's removal ends its process; the default context's end loses the connection.
- **Every process's pages, one transport.** Each `WebPage` target is a page proxy in Playwright's envelope, `<process>-<target>`, in its process's context, with ids qualified as when attached (Q195); `Playwright.enable` announces the pages open.
- **The adapter's launched profile** (`webkitAdapter.ts`, `Options.automation`):
  - a page made by `createBrowsingContext`, a window, waited for until its first document loads (Q211), and reported `Created`; a page another opened is reported `Opened`, with no opener (Q212);
  - a page's handle paired with its target by `performance.timeOrigin`, read through both (Q219), after which its declared viewport is applied and its dialogs watched;
  - navigation by `navigateBrowsingContext` with no load strategy, a child frame's by script; history refused (Q215);
  - input as interaction sequences of the mouse, keyboard and wheel, each step naming its interaction, never a touch source (Q214); text by `InsertByKey`;
  - dialogs found by `isShowingJavaScriptDialog` every 100 ms, reported `unknown` with their message, and answered by accepting, dismissing, or setting a prompt's text first, which fails for a dialog that wasn't one (Q206);
  - the viewport as the window's size, less the toolbar measured once per process; JavaScript off by `Page.overrideSetting`; media without forced colors;
  - a file input's files by `setFilesForInputFileUpload`, the element found by its path through Automation;
  - cookies through a page of the context.
- **`Dialog.Unknown`** (`Dialog`, `AutoResolution`, `Page.Prompt`, `Reason.PromptBlocking`; the adapter's prompt kind `unknown`). A dialog with its message, `accept`, `dismiss` and `respond(text)`; `acceptAll` accepts it and `dismissAll` dismisses it.
- **A context's defaults** (`browser.ts`). Where `downloads` or `fileChooser` is `unsupported`, a new context makes no download directory and arms no chooser; asked for, they fail (Q220).
- **The CLI.** A session that launches the MiniBrowser doesn't emulate focus: its pages are windows.
- **Settled while building.**
  - **GNOME Web isn't launched.** It needs a D-Bus session, opens no second page in automation mode, and aborts as one closes (Q217), so it is deferred.
  - **History is refused,** not driven: stock WebKit's inspector misreports a traversal (Q215).
  - **The time zone and locale aren't context options:** a context's options reach the adapter after its process starts, and the MiniBrowser takes no language from anywhere (Q218).
  - **Screenshots stay the inspector's** `snapshotRect`, since Automation's takes no rectangle.
  - **A page's opener is unknown** (Q212), and a popup isn't paused.
  - **`strider browsers` doesn't find the MiniBrowser yet** (since built: Playwright's WebKit build removed, below).
- **Tests.** `test/integration/StockWebKitLaunched.test.ts` launches the MiniBrowser through `WebKit.layer` on an X server the test names in `DISPLAY`: its name and version and first tab; a click the page trusts, `fill` and `press`; a screenshot; a `confirm` and a `prompt` as `Unknown`, one answered with text; two contexts as processes with their own cookies, one at a 640 by 480 viewport; a fulfilled route and a file input; the capability table and the refusals of `back` and `evaluate`. The WebKit slices provide `SocketConnector`. Integration tests: 519, all passing in one full run, a file at a time.

**Built** (2026-10-26): the conformance suite and the slices on stock WebKit, and its drift fixture.

- **The runs against Playwright's build go.** `test/integration/adapter/WebKit.adapter.test.ts` and `test/integration/slice/WebKit.slice.test.ts` launch the MiniBrowser, on an X server of their own; `test/integration/WebKit.test.ts`, Playwright's build's protocol tests, stays until the build goes.
- **Expectations by capability.** The conformance suite and the slices read a backend's capability table (`supports`, `slice/capabilities.ts`) where a case depends on what it can do, and check its refusal, under that capability's name, where it can't. Six entries are new on every backend: `prompts.kind`, `popups.opener`, `close.runBeforeUnload`, `network.headersSent`, `input.touch` and `storageState.partitioned`, which stock WebKit lacks or has in part; and four that only stock WebKit's table had are now in every table, `navigation.sameDocument`, `navigation.traverse`, `frames.contentFrame` and `screenshot.format`, so a test can ask any backend.
- **What the suites found, built** (`webkitAdapter.ts`, launched profile, unless said):
  - an override stock WebKit can't apply is refused under its capability, never ignored: a mobile or scaled viewport, the locale, the time zone, the user agent, and when attached, every one; a declared viewport's window is restored when it's released; downloads are refused under `downloads`;
  - the error page after a failed load is the failed navigation's document (`ErrorPage`), as Chromium's is (Q1, Q199);
  - a frame locator's frame, found through Automation and matched by its document (Q228), so frames work, a file input's in a frame too;
  - one `dispatchInput` is one interaction sequence, so a double click is one, the wheel's state is cumulative, and a newline is Enter (Q223); input that opens a dialog returns once it's decided (Q224);
  - a request's body read as stock WebKit's text, not base64 (Q221);
  - Automation's results that aren't JSON, and its empty frame handle, read as none (Q227);
  - the engine's timers are the page's own where a clock shares its world (Q222; `clock.ts`, `engine.ts`);
  - `dragTo` and files made in the page run the library's own function in the page's world where there is no other (`locator.ts`, `fileInput.ts`), and a node passed to a function is its binding as it is, since stock WebKit's `DOM.resolveNode` takes a node id only (Q229);
  - cookies set through Automation's `addSingleCookie`, on the process's anchor window, since the inspector's `setCookie` ends the Automation session (Q230), so a context with no page open, as a storage state's, has them set at once;
  - a trace's polled frames are PNG where screenshots are (Q231; `trace.ts`);
  - `close({ runBeforeUnload: true })` refused by the backend fails with `PageError{Unsupported}` (`page.ts`), not a defect;
  - `Popup`, `Download` and `FileChooser` subscriptions fail at once with `SubscriptionError{Unsupported}` where the backend can't report them (`Popup.ts`, `Download.ts`, `FileChooser.ts`), as filters already did.
- **The stock fixture** (`test/fixtures/traffic/webkitgtk-2.54.1.ndjson`, `browsers.json`'s `webkitgtk.fixture`). The conformance suite records the pages' traffic and the Automation target's (`WebKitAutomation.Settings.wrapAutomation`), less the `Playwright` domain its transport makes up; the drift test decodes it through both stock protocols. `WebKitAutomation.test.ts` triggers stock WebKit's error replies and checks their rows: four from Playwright's build, which stock WebKit gives alike, and a new one, Automation's `WindowNotFound`, as `NoSuchTarget`.
- **Settled while building.**
  - **What the suites found:** frames, input sequences, dialogs during input, the clock, request bodies, nodes passed to functions and cookies each needed work (above), and six capabilities are new.
  - **Cookies are what a context's pages are sent** (Q225), and a request's headers as sent have no `Cookie` (Q226): both `partial`.
  - **A frame's partitioned storage is restored at its site's default port** on stock WebKit, which keys it by origin (Q232): `storageState.partitioned` is `partial`. Recording the origin beside the site is built: Storage partitions by origin, below.
  - **`Popup` is refused, not served,** on stock WebKit (Q212), since nothing names an opener.
- **Tests.** On the MiniBrowser, `test/integration/adapter/WebKit.adapter.test.ts` runs the conformance suite and the engine's tests (37) and `test/integration/slice/WebKit.slice.test.ts` the slices (125), all passing; `WebKitAutomation.test.ts` adds the error replies' classification, and `test/Drift.test.ts` decodes the stock fixture beside the other three. Integration tests: 520. In the last full run, a file at a time, 519 passed; Firefox's test of a navigation after a failure failed, as it did twice more alone just after, and in none of 13 runs alone since (Q233).

**Built** (2026-10-26): Playwright's WebKit build removed.

- **What went:** `WebKit.layer`'s launch of Playwright's build and its `protocol.json` check (`internal/webkitLauncher.ts`, `internal/webkitBuild.ts`); `WebKitConnection`, the raw connection to its pipe; the adapter's Playwright profile, about a thousand lines: contexts and pages through the `Playwright` domain, input, dialogs, emulation, downloads, file choosers, screencasts, permissions and isolated worlds, and their events; the generated `@usestrider/browser/webkit-protocol` and `packages/tools/codegen/protocols/webkit`; the pin (`browsers.json`'s `webkit`, `flake.nix`'s `playwright-driver`, `STRIDER_WEBKIT`), its fixture (`webkit-playwright-2359`) and its tests (`test/integration/WebKit.test.ts`); and `strider browsers`'s look in Playwright's cache, for every backend.
- **The adapter is stock WebKit's,** attached, or launched with `Options.automation`, on the stock inspector's generated modules, with an envelope of our own (`internal/webkitEnvelope.ts`: `Envelope.enable`, `pageProxyCreated` and `pageProxyDestroyed`) where Playwright's domain carried the transports' pages. Its capability tables are written out, attached and launched, rather than derived from the patched build's; an override is refused by the capability it's applied under (`overrideCapability`), and `BypassCsp`, which nothing public declares, as `override.BypassCsp`.
- **`WebKit.layer`** launches a MiniBrowser and nothing else: another executable fails with `InvalidInput`.
- **The error table** keeps the rows stock WebKit or the transports produce, each recorded against WebKitGTK 2.54.1 and checked by `WebKitAutomation.test.ts`, a case per row; the patched build's `Cannot find page proxy` for a command's parameter, and `Node not found` from `DOM.describeNode`, go.
- **`strider browsers`** looks for a MiniBrowser where WebKitGTK's and WPE's packages put one, on Linux, and in Nix profiles, and reads its version from the path it leads to (Q234). `Found.matchesAdapter`, which said whether a Playwright build's `protocol.json` was the adapter's, goes, and so does the `playwright` source.
- **Settled while building.**
  - **`WebKitConnection` goes** without a stock replacement: stock WebKit's L0, the socket and its Automation session, stays internal until its public shape is designed.
  - **The envelope is ours,** `Envelope` where the transports had kept Playwright's domain names.
  - **`strider browsers` doesn't run a MiniBrowser for its version** (Q234).
- **Tests.** `test/Launchers.test.ts` checks what the stock launch takes and refuses; `test/Browsers.test.ts` finds a Nix profile's MiniBrowser and its version; `WebKitAutomation.test.ts` checks every row of the error table; the stock fixture is recorded again. Integration tests: 517, all passing in one full run, a file at a time; the 3 of `WebKit.test.ts` went with the build.

**Built** (2026-10-26): storage partitions by origin.

- **`StorageState.OriginState.topLevelOrigin`,** an optional key: for a partitioned origin, the origin of the top-level document it was read under. A state saved before has none, and decodes as it did.
- **Export** records it from the page each origin is read under; an origin is still read once per top-level site. **Restore** writes a partitioned origin from a frame of a page at it, or, with none, at the site's default port, as before (`internal/storageState.ts`).
- **`storageState.partitioned`** is `supported` on stock WebKit, whose partitions are keyed by origin (Q232), saying that a state with no top-level origin is restored at the site's default port.
- **Tests.** The slices' call site 1 checks the restored frame's storage on every backend again, and passes on all three; `test/Errors.test.ts` decodes a state saved without the key, and one with it. Integration tests: 517, all passing in one full run, a file at a time.

**Built** (2026-10-26): the open quirks' checks.

- **A TLS fixture** (`test/integration/adapter/harness.ts`, `tlsSite`): an HTTPS server on `127.0.0.1` with a self-signed certificate the Nix environment's OpenSSL makes as the scope starts (`STRIDER_OPENSSL`), deleted as it ends. The conformance suite navigates to it on every backend: the navigation fails, reported for the URL it was going to. Chromium fails it `net::ERR_CERT_AUTHORITY_INVALID` with its error page, Firefox `MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT`, reported where it was going (Q2), and stock WebKit "Unacceptable TLS certificate" with its error page.
- **Settled while building.**
  - **The fixture found stock WebKit without TLS** in the integration environment, until `GIO_EXTRA_MODULES` named `glib-networking`'s modules (Q237): every HTTPS load had failed before a certificate was checked.
  - **The integration environment has no sound card** (`ALSA_CONFIG_PATH`, an empty configuration): the first full run with the fixture failed the slices' Firefox video tests, which had passed that day, because Firefox's `startScreencast` hung the browser while its audio reached the desktop's PipeWire (Q236).
  - **Q233's cause was found:** the conformance test's assertion, printing the navigations it saw, caught Firefox replying to `browsingContext.navigate` for a port it refuses (`deniedPortAccess`) with an error, and reporting the navigation's start and its error page after. The BiDi adapter's `neverStarted`, which reports a navigation whose command failed, took its expectation outside the adapter's serialized step, so an event handled in between started the navigation again under a new id. It now takes and reports it in one step: the test failed twice in 12 runs alone before, and in none of 15 after.
  - **Q238 is new:** the second full run's WebKit HAR missed the body of the document the page left at once, which 5 runs alone didn't repeat.
  - **Q72 needed no check against Playwright's client:** stock WebKit resolved it.
  - **Q82 and Q103 are measured by the comparison scripts** (below).
  - **Q180 stays open,** as the maintainer decided, and **Q14** waits for Firefox.
- **Tests.** The conformance suite's TLS test, on every backend. Integration tests: 520, all passing in one full run, a file at a time; it was the third: the first failed the slices' Firefox video tests (Q236), and the second Q233's test and the WebKit HAR test (Q238).

**Built** (2026-10-26): the package checks, and CI's checks.

- **`strider-utils pack-check`** (`packages/tools/utils/src/pack-check.mjs`, `pnpm pack-check` after `pnpm build`) packs `@usestrider/browser` and `@usestrider/vitest` in a temporary directory and checks each tarball: every subpath its `exports` offers exists, the `./*` pattern's expanded as Node resolves it, so a `null` key such as `./internal/*` leaves its files out; a `.d.ts` beside every `.js`, and a source beside it, since output whose source is gone is an earlier build's; its `bin`; none of the workspace's tests, scenarios, fixtures or data; and no `dependencies`, only peers. It then installs both in a project of their own with only their peers, and the peers' peers, laid out flat as npm lays it out; imports every subpath under Node; type-checks an import of each under `module` and `moduleResolution` `nodenext`, without `skipLibCheck` or `exactOptionalPropertyTypes`; runs `strider --help`; and runs it again with `@effect/platform-node` moved away, which must fail saying to install it.
- **`pnpm build` starts from nothing:** `strider-utils clean` removes the published packages' `dist` and their build information first, since `tsc -b` never deletes an output whose source is gone, and without the build information it would think the deleted output current.
- **What the check found on its first run,** both fixed:
  - **A local build would have published an earlier build's output** (Q239): `dist/bidi-protocol/` held `browser.js`, `session.d.ts` and the rest beside `Browser.js` and `Session.d.ts`, from before the generated modules were renamed, and a project type-checking them saw two files differing only in case.
  - **The backends' `declare module` keys failed to type-check in a project without `exactOptionalPropertyTypes`** (Q240): `BackendMetadata` extended `Metadata`, whose index admits no `undefined`, which an optional key's type has there. It has an index of its own now, which does.
- **`.github/workflows/checks.yml`,** on every pull request and every push to `main`, and on demand: `pnpm install --frozen-lockfile`, `pnpm all`, `pnpm build` and `pnpm pack-check`, each in the Nix environment's default shell (`nix develop`), so Node and pnpm are the flake's. A newer push to a branch cancels its older run.
- **`.github/workflows/integration.yml`,** nightly at 03:17 UTC and on demand: a first job reads the last completed run of the workflow on `main`, and a scheduled run stops there where it tested the commit `main` is at; otherwise `pnpm test:integration --no-file-parallelism` runs, the browsers coming from the Nix binary cache, and a failed run keeps its log as an artifact for 14 days. Ubuntu 24.04 confines unprivileged user namespaces to programs AppArmor names, which the Nix store's Chromium and Firefox aren't, so the job allows them first (`kernel.apparmor_restrict_unprivileged_userns=0`).
- **The actions** are GitHub's `checkout` and `upload-artifact`, and Cachix's `install-nix-action`, which installs Nix with flakes on; each is pinned by its commit, its release named beside it.
- **Settled while building.**
  - **`@effect/platform-node` is an optional peer,** and the `strider` command says to install it when it's missing, since `@usestrider/vitest` moved out. The package check holds both.
  - **`pnpm all` doesn't run the package check:** it needs `pnpm build`'s output and an install, so it's its own command, which CI runs after the build.
  - **The type check is TypeScript 7's,** the workspace's own: a consumer on TypeScript 5 isn't checked.
  - **A failed integration run keeps its log only:** the integration tests attach nothing through `TestRun`, which is for a program's tests, so there are no test artifacts to keep.
  - **No store cache:** each run downloads the toolchain, and the integration run its browsers, from the Nix binary cache; a cache would need a third party's action more.
- **Tests.** `pnpm pack-check` passes after a clean `pnpm build`, and failed before the two fixes, naming each file; `pnpm all` passes. The workflows run once pushed. The integration tests didn't run again: nothing a browser runs changed.

**Built** (2026-10-26): the comparison scripts.

- **`packages/scenarios`,** private, never published: ten scenarios, each written with Strider and with Playwright as each library's documentation would write it (`src/scenarios.ts`, between `#region` markers the report copies): the README's program, a login reused through storage state, a popup with a dialog, a route blocking analytics, an upload from bytes, a response's body, the navigation a click causes, a HAR recorded and replayed, and two pages of a public demo site, The Internet's login and its dynamic controls. Each scenario's first run is its outcome, compared with what it should read, and the next ten, the libraries taking turns going first, its wall time.
- **Playwright is `playwright-core` 1.64.1,** the package's dependency alone. It installs no browser and launches the integration environment's Chromium by its `executablePath`; no Playwright build is downloaded or run, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` has nothing to skip.
- **`pnpm scenarios`** enters the integration environment, as `pnpm test:integration` does, and writes `packages/scenarios/RESULTS.md` with the date, the browser, both libraries' versions and the machine, which `dprint` leaves as written, as it does `INDEX.md`. `--runs` sets the timed runs, and `--only` runs one scenario without the measurements.
- **The demo sites are recorded once,** by `pnpm scenarios --record`, which visits them live and records each with `Har.record`, cookies and requests' bodies included, into `.data/scenarios/`; every other run replays them, each library with its own HAR replay (`Route.fromHar`, `routeFromHAR`), aborting what the recording lacks, and fails without them, saying to record them.
- **The measurements:** Q82, as the renderers' CPU time per second, read from `/proc` for the processes the run started, while each library waits for an element a page animating 200 of its 3000 elements shows after 3 seconds, and while each leaves it alone as long; Q103, as a page with 300 images loaded to its `load` event, with no route and with a route matching nothing; and the tells a page's own script reads (`navigator.webdriver`, the user agent, whether a console argument's `stack` is read as `Runtime.enable` would read it, `window.chrome`, plugins, languages, the window's and screen's sizes, notification permission, the WebGL renderer, and the globals the page didn't make), with the arguments each launched Chromium with.
- **What it found** (RESULTS.md, 2026-10-27):
  - **Strider took longer** in 8 of the 10 scenarios, 1.4 to 2.4 times, and to launch, 201 ms to 130 (Q242); where the time goes is the next thing to find.
  - **Q82 costs the page a little:** 287 ms of renderer CPU a second while Strider's expectation waited, to 256 idle; Playwright's wait, 246 to 253.
  - **Q103 costs a load what a route costs Playwright:** 106 ms with Strider's interceptor always installed, 73 with Playwright's none, and 111 once a Playwright route is declared.
  - **The tells were the same** but for the window: Strider's headless window is 780 by 580 on an 800 by 600 screen, its page 87 pixels shorter, as a window with a toolbar's is; Playwright's viewport, 1280 by 720, is its window and its screen too. Neither made a global in the page's world, and neither enabled `Runtime` where the probe saw it. Playwright launches Chromium with `--no-sandbox`; Strider keeps the sandbox.
  - **Writing the scenarios found Q241,** an element of no opacity hidden to Strider's actions, which TodoMVC's checkbox is, and **Q243,** `getByRole` without Playwright's state filters, such as `level`.
- **Settled while building.**
  - **No API reference site here:** the documentation site (`t3/documentation-site`) builds one with Astro.
  - **The recordings aren't committed:** they hold the demo sites' own files, Apache-2.0 and MIT, which the repository would redistribute with their notices; the licence work is deferred, so each machine records once.
  - **One demo site, not a list:** The Internet. TodoMVC's demo, the other at first, is hosted by Playwright, so its scenario became The Internet's dynamic controls (2026-10-27).
  - **No `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`,** which `playwright-core` doesn't need.
- **Tests.** The scenarios are a script a person runs, not tests; `pnpm all` type-checks them. Every outcome read what it should with both libraries.

### Pause-on-start granularity

Before-author-script setup for *new* targets needs them paused at creation. Granularity differs by backend, and the access model depends on it.

| Backend | Granularity (probe 22) |
|---|---|
| CDP | frames and workers: per page, by auto-attach on the page's session. Popups: **browser-wide only**: neither `autoAttachRelated` nor the opener's auto-attach attaches them (confirmed 2026-10-20, Chromium 155) |
| BiDi | not needed: declarations are scoped natively by context or user context (built 2026-10-20) |
| Stock WebKit | a page's targets after `Target.setPauseOnStart` start paused, the provisional targets of cross-site navigations among them, each resumed on its own (`Target.resume`); workers wait for `Worker.initialized`; new pages and popups aren't (built 2026-10-26) |

The capability is `pauseScope: "context" | "related" | "opener" | "browser"`. A declaration that needs `beforeAuthorScript` on targets the available granularity can't isolate fails with `Unsupported`. Observe-only targets are never paused.

## Backends and order

Each backend ships as its own subpath export (`@usestrider/browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provides the `Browser` service, so unused protocol code is never loaded. Generated L0 commands are available raw at `@usestrider/browser/cdp`, `/bidi-protocol`, `/webkit-stock-protocol` and `/webkit-automation-protocol` for power users.


1. **CDP:** launched Chromium; remote endpoints.
2. **BiDi:** Firefox, plus Chrome over chromium-bidi as a cross-check.
3. **WebKit, stock:**
   - launched: WebKitGTK's and WPE's MiniBrowser in automation mode, driven by WebKit's Automation protocol and looked into through the inspector, on the inspector server's socket, a browser process per context (built 2026-10-26 for WebKitGTK 2.54.1);
   - attached: the inspector server over HTTP, for looking (built 2026-10-26); iOS and WKWebView, behind Safari's own inspector, list their pages another way, which isn't read;
   - Playwright's patched builds aren't driven (removed 2026-10-26): a patched browser is a dependency and a fingerprint.
4. **Experimental BiDi profiles:** Safari Technology Preview (needs `safari:experimentalWebSocketUrl`) and WebKitGTK/WPE (about 23% of WPT).

### Capability snapshot

This is a planning inventory from the research, not a conformance result. `?` means it still needs a probe.

| Capability | CDP | BiDi Chrome | BiDi Firefox | WebKit patched (removed) | WebKit stock (attached; launched) | Safari BiDi (STP) |
|---|---|---|---|---|---|---|
| own process / headless | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | attach-only; ✓/✗ (built) | ✓/✗ |
| user contexts | ✓ | ✓ | ✓ | ✓ | ✗; a browser process each (built) | ✗ |
| isolated worlds (`inspect`) | ✓ | ✓ | ✓ | ✓ | ✗ | partial |
| pause-on-start scope | per page for frames and workers; browser-wide for popups (probe 22) | declarative | declarative | per page proxy (probe 22) | a page's later targets; not new pages (built) | n/a |
| input fidelity | native | webdriver | webdriver | native | ✗ (refused; built); native, Automation's (built) | webdriver |
| network events / interception | ✓ / req, resp, auth | ✓ / req, resp, auth | ✓ / req, resp*, auth | ✓ / req | ✓ / req (built) | ✗ / ✗ |
| body access | buffered + stream | collectors | collectors | ✓ | ✓ | ✗ |
| console | ✓ (needs Runtime) | ✓ | ✓ | ✓ | ✓ | ✗ |
| prompts / file chooser / downloads | ✓/✓/✓ | ✓/✓/✓ | ✓/✓/✓ | ✓/✓/✓ | ✗ (a dialog blocks unreported)/✗/✗; `Unknown`/✗ (file inputs ✓)/✗ (built) | ✓/✗/✗ |
| screencast / PDF / AX tree | frames/✓/✓ | ✗/✓/✗ | file/✓/✗ | frames/✗/partial | ✗/✗/✗ | ✗/✗/✗ |
| evaluation with user activation | ✓ | ✓ (probe 20) | ✓ (probe 20) | ✓ | ? | ? |
| page time: virtual / injected | ✓/✓ | ✗/✓ | ✗/✓ | ✗/✓ | ✗/? | ✗/? |
| WebSocket frames | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| event-listener listing (snapshot evidence) | ✓ | via `goog:cdp` | ✗ | ? | ✗ | ✗ |

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
