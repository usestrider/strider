# Effect v4 building blocks and effect-cdp review

Sources: `effect@4.0.5` (`/tmp/effect-pkg/x/package/src`), `@effect/platform-node@4.0.5`, `@effect/platform-node-shared@4.0.5` (pulled in as a dependency because platform-node re-exports from it), `@effect/platform-bun@4.0.5`, `@effect/vitest@4.0.5` (`/tmp/effect-extra/*`), `effect-cdp@0.2.0` tarball (`/tmp/ecdp/x/package`) and its GitHub HEAD `1c94cd8` (`/tmp/prior-art/effect-cdp`). Each claim is either **verified**, meaning a script in `/tmp/effect-scratch/t*.mjs` ran it against the 4.0.5 dist, or **read**, meaning it comes from reading the source.

## Summary

- **Module paths changed.** Effect 4.0.5 has no `effect/unstable/*` path. Imports such as `effect/unstable/socket` from the release candidates now fail with `ERR_MODULE_NOT_FOUND` (verified). The modules ship at `effect/socket`, `effect/process`, `effect/rpc`, `effect/ai` and so on. Instability is now marked per export with `@stability unstable` JSDoc. Socket, ChildProcess, RPC, AI and Persistence are all unstable. Scope, FiberMap, RcMap, PubSub, Stream and most of Schema are stable.
- **Transport is ready to use, with some care.**
  - WebSocket works through `Socket.fromWebSocket` / `makeWebSocket`.
  - Chrome's pipe transport (`--remote-debugging-pipe`) works through `ChildProcess.make(..., { additionalFds: { fd3: { type: "input" }, fd4: { type: "output" } } })`, then `handle.getInputFd(3)` / `handle.getOutputFd(4)`.
  - The big gotcha: 4.0.5's `Socket` is built for reconnecting. A write made while disconnected **suspends until the next connection** rather than failing (verified). For CDP this means a command sent after the browser dies hangs forever. We need our own transport layer that fails fast.
- **The concurrency kit covers everything the lifecycle tree needs**, and the semantics are verified:
  - `Scope.fork` creates child scopes that detach from their parent when closed.
  - Finalizers run in reverse order (LIFO), and can run in parallel with the `"parallel"` strategy.
  - `Scope.close` cannot be interrupted.
  - `Effect.callback` cleanup removes pending entries when a command is interrupted.
  - PubSub supports `replay`, and Queue supports typed `fail` and `end`.
- **Three verified race and loss traps**:
  - `Stream.fromPubSub` and `Stream.callback` subscribe lazily, inside a forked fiber. A fork followed by a trigger can miss events.
  - A *dropping* PubSub drops for **every** subscriber once a single subscriber falls behind.
  - `Queue.offerUnsafe` silently drops events when a bounded buffer is full.
- **Schema has codegen and speed built in**:
  - `SchemaRepresentation.fromJsonSchemaMultiDocument` plus `toCodeDocument` turns JSON Schema into Effect Schema source code (verified on a CDP fragment).
  - `SchemaJITCompiler/enable` cut decode time for a realistic `Network.requestWillBeSent` from about 0.90 µs to about 0.15 µs per message (verified).
  - Type-check cost is small under TypeScript 7. A string-keyed `send()` over all 681 effect-cdp commands checks in 20 ms.
- **RPC** (`RpcGroup` / `RpcClient.Protocol`) can technically carry CDP commands, and even multiplex sessions as separate client IDs. It doesn't model unsolicited events, the RPC module is unstable, and an Interrupt/Ack layer adds nothing over CDP. My recommendation: don't build the core on it. It does make sense for a browser-pool service we expose remotely.
- **effect-cdp should not be used as a base.**
  - It is broken on 4.0.5: it imports `effect/unstable/socket` and calls the release-candidate Socket API.
  - Its event bus is global and lossy, and events are untyped (`RawCdpEvent`).
  - Sessions are not tied to a Scope.
  - Its `reconnect` option does nothing, and connection errors are swallowed.
  - Its call sites are clumsy: the service and session ID are passed positionally into every helper.
  - The codegen (cycle detection plus `Schema.suspend`) is the only part worth borrowing (MIT).
- **Recommendation: write our own protocol layer** around yieldable command values, typed event descriptors, eager subscriptions and Scope-backed sessions. The remote side closes those scopes when a target or connection dies.

## Part A: Effect v4 inventory

### Inventory table

All rows are `effect@4.0.5` unless the path names another package. Signatures are copied verbatim, with option bags shortened using `…`.

| Primitive | Module | Key signatures (verbatim) | Semantics / gotchas |
|---|---|---|---|
| Socket | `effect/socket/Socket` (unstable) | `interface Socket { readonly reader: Effect.Effect<Reader, SocketError, Scope.Scope>; readonly writer: Effect.Effect<Writer, never, Scope.Scope> }` · `interface Reader<A …> { readonly pull: Effect.Effect<NonEmptyReadonlyArray<A>, SocketError>; readonly upgrade: … }` · `interface Writer { readonly write: (chunk: Uint8Array \| string \| CloseEvent) => Effect.Effect<void, SocketError>; readonly writeAll: … }` | Pull-based reads. Every termination fails `pull` with `SocketError{reason: SocketCloseError{code}}`, but buffered frames are still delivered first (verified). Each reader acquisition dials again. The writer is detached from the connection: **writes wait on a latch until the next connection** (verified: they hang after close). |
| WebSocket | same | `makeWebSocket = (url: string \| Effect.Effect<string>, options?: { openTimeout?, protocols?, headers?, highWaterMark? }): Effect.Effect<Socket, never, WebSocketConstructor>` · `fromWebSocket = <RO, WS extends WebSocketLike>(acquire: Effect.Effect<WS, SocketError, RO>, options?): Effect.Effect<Socket, never, Exclude<RO, Scope.Scope>>` · `class WebSocketConstructor extends Context.Service<WebSocketConstructor, (url: string, options?: WebSocketConstructorOptions \| undefined) => WebSocketLike>` | Pauses `ws` at a 64 KiB high-water mark. Non-pausable sockets (browsers, undici) buffer without limit by default. `openTimeout` defaults to 10 s. Construction never fails, so connection errors only appear when the reader is acquired. |
| Node / Bun WebSocket | `@effect/platform-node/NodeSocket`, `@effect/platform-bun/BunSocket` | `layerWebSocketConstructor`, `layerWebSocketConstructorWS`, `layerWebSocket(url, options)` | The Node layer **prefers `globalThis.WebSocket` (undici)** and only uses `ws` when a headers object is passed. You can't set `maxPayload` or `perMessageDeflate`. Puppeteer and Playwright set `maxPayload` to 256 MB, so we should supply our own `WebSocketConstructor` that wraps `ws`. |
| Duplex | `@effect/platform-node-shared/NodeSocket` | `fromDuplex = <RO>(open: Effect.Effect<Duplex, Socket.SocketError, RO>, options?: { openTimeout?, tlsServer? }): Effect.Effect<Socket.Socket, never, Exclude<RO, Scope.Scope>>` | Backpressure is end to end (the stream is never resumed). **Releasing the writer scope calls `end()`**, a half-close. Acquiring the writer once per send would half-close a pipe on the first command. |
| ChildProcess | `effect/process` (unstable) | `StandardCommand extends Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, ChildProcessSpawner \| Scope.Scope>` · `CommandOptions.additionalFds?: Record<\`fd${number}\`, AdditionalFdConfig>` · `AdditionalFdConfig = { type: "input"; stream?: Stream.Stream<Uint8Array, PlatformError> } \| { type: "output"; sink?: Sink.Sink<…> }` · handle: `getInputFd: (fd: number) => Sink.Sink<void, Uint8Array, never, PlatformError>`, `getOutputFd: (fd: number) => Stream.Stream<Uint8Array, PlatformError>` · `KillOptions { killSignal?: Signal; forceKillAfter?: Duration.Input }` | Extra file descriptors are supported. Gaps are filled with `"ignore"`. See the pipe gotchas below. Commands are yieldable values, and `make` also accepts a template literal. |
| Spawner | `effect/process/ChildProcessSpawner`; Node implementation in `@effect/platform-node-shared/NodeChildProcessSpawner` (Bun re-exports it) | `spawn(command: Command): Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope>` | `detached` defaults to **true** on POSIX, so the child gets its own process group. When the scope closes it sends SIGTERM to that group, waits 1 s, then **awaits the exit indefinitely** unless `forceKillAfter` is set. A non-zero exit kills the group. |
| Scope | `effect/Scope` (stable) | `make: (finalizerStrategy?: "sequential" \| "parallel") => Effect<Closeable>` · `fork: (scope: Scope, finalizerStrategy?) => Effect<Closeable>` · `addFinalizerExit: (scope, finalizer: (exit: Exit<any, any>) => Effect<unknown>) => Effect<void>` · `close: <A, E>(self: Closeable, exit: Exit<A, E>) => Effect<void>` · `provide`, `use` | There is **no `Scope.extend`**; use `Scope.provide`. See the verified semantics below. |
| Deferred | `effect/Deferred` | `make`, `await`, `succeed`, `fail`, `done`, `doneUnsafe`, `isDoneUnsafe`, `makeUnsafe` | `doneUnsafe` and `makeUnsafe` are for synchronous use from callbacks. |
| FiberMap / Set / Handle | `effect/FiberMap` etc. (stable) | `run: <K, A, E>(self: FiberMap<K, A, E>, key: K, options?: { onlyIfMissing?; propagateInterruption?; startImmediately? }) => <R, XE extends E, XA extends A>(effect) => Effect<Fiber<XA, XE>, never, R>` (plus a data-first form) | Running under the same key interrupts the previous fiber, and `onlyIfMissing` returns the existing fiber instead (verified). These are the natural owners for per-target background loops. |
| RcRef / RcMap | `effect/RcRef`, `effect/RcMap` | `RcMap.make<K, A, E, R>(options: { lookup: (key: K) => Effect<A, E, R>; idleTimeToLive?: Duration.Input \| ((key: K) => Duration.Input); capacity?: number }): Effect<RcMap<K, A, E>, never, Scope \| R>` · `get: <K, A, E>(self, key) => Effect<A, E, Scope>` · `invalidate` | Resources are reference-counted and released after the idle time to live (verified). `invalidate` while a resource is in use defers release until the last user's scope closes (verified). Setting `capacity` adds `Cause.ExceededCapacityError` to the error type. |
| ScopedRef | `effect/ScopedRef` | `fromAcquire: <A, E, R>(acquire) => Effect<ScopedRef<A>, E, Scope \| R>` · `set: (self, acquire) => Effect<void, E, Exclude<R, Scope>>` | Swaps a resource and releases the old one. Useful for switching the current page or the current realm. |
| SubscriptionRef | `effect/SubscriptionRef` | `changes`, `get`, `set`, `update`, `modifyEffect` and others | `changes` emits the current value and then each update (verified). Good for frame-tree and page-list state. |
| PubSub | `effect/PubSub` (stable) | `bounded<A>(capacity: number \| { capacity: number; replay?: number })`, `unbounded<A>(options?: { replay?: number })`, `dropping(…)`, `sliding(…)` · `subscribe: <A>(self) => Effect<Subscription<A>, never, Scope>` · `end: <A>(self, value: A) => Effect<boolean>` | Replay works (verified: `replay: 2` gives late subscribers `[2,3]`). There is **no error channel**. `end` takes a sticky final value. `shutdown` interrupts subscribers. With **dropping, one idle subscriber drops for everyone** (verified). |
| Queue | `effect/Queue` (stable) | `Queue<A, E>`; `end = <A, E>(self: Enqueue<A, E \| Done>) => Effect<boolean>`; `fail(self, error)`; `failCause`; `shutdown`; `interrupt`; `offerUnsafe(self, a): boolean` | `end`: buffered items drain first, then `take` fails with `Cause.Done`, and `Stream.fromQueue` ends cleanly. `fail`: the error surfaces typed in `Stream.fromQueue` after buffered items (verified). `shutdown` interrupts waiting takers. `offerUnsafe` returns `false` when the queue is full, even under the `"suspend"` strategy. |
| Stream | `effect/Stream` (stable) | `callback<A, E, R>(f: (queue: Queue<A, E \| Cause.Done>) => Effect<unknown, E, R \| Scope>, options?: { bufferSize?; strategy? }): Stream<A, E, Exclude<R, Scope>>` · `broadcast(self, { capacity, strategy?, replay? }): Effect<Stream<A, E>, never, Scope \| R>` · `share(self, { capacity, strategy?, replay?, idleTimeToLive? })` · `groupByKey(self, f, { bufferSize?, idleTimeToLive? }): Stream<readonly [K, Stream<A>], E, R>` · `partition(self, filter, { capacity? }): Effect<[passes, fails], never, R \| Scope>` · `fromPubSub`, `fromSubscription`, `toPubSub(self, { capacity, replay?, shutdownOnEnd? })` | `callback` is unbounded by default. Its `f` runs in a **forked** fiber, so a listener is not registered until after the first yield (verified). `share` is reference-counted: the upstream starts with the first consumer and stops after the last. |
| Pool | `effect/Pool` | `make({ acquire, size, concurrency?, targetUtilization? })`, `makeWithTTL({ acquire, min, max, timeToLive, timeToLiveStrategy? })`, `get: (self) => Effect<A, E, Scope>` | **KeyedPool is gone in v4.** Use an `RcMap` of `Pool`s or a `LayerMap` instead. |
| Semaphore / Latch | `effect/Semaphore`, `effect/Latch`, `effect/PartitionedSemaphore` (new) | `Semaphore { withPermits(n), withPermit, withPermitsIfAvailable, take, release, resize, releaseAll }` · `Latch { open, release, await, close, whenOpen, isOpen }` | `PartitionedSemaphore<K>` gives fair permits per key, for example a per-target input lock. |
| Timeouts | `effect/Effect` | `timeout: (duration: Duration.Input) => <A, E, R>(self) => Effect<A, E \| Cause.TimeoutError, R>` · `timeoutOption` · `timeoutOrElse({ duration, orElse })` | These **wait for the inner effect to finish being interrupted** (verified: an uninterruptible 50 ms effect with a 5 ms timeout returns after 50 ms). There is no `disconnect` in v4. |
| Effect.fn | `effect/Effect` | `fn: fn.Traced & { (name: string, options?: SpanOptionsNoTrace): fn.Traced }` · `fnUntraced: fn.Untraced` · `fn.Return<A, E = never, R = never> = Generator<Effect<any, E, R>, A, any>` | Optional trailing pipeline arguments `(effect, ...args) => …` let you attach timeouts or spans without wrapping. |
| Tracing / metrics | `effect/Effect`, `effect/Tracer`, `effect/Metric`, `effect/observability` | `withSpan`, `withSpanScoped`, `makeSpanScoped: (name, options?) => Effect<Span, never, Scope>`, `linkSpans`, `annotateCurrentSpan` · `SpanOptionsNoTrace { attributes?; links?; parent?; root?; kind?: "internal" \| "server" \| "client" \| "producer" \| "consumer"; sampled?; level?: LogLevel }` · `Tracer.MinimumTraceLevel` · `Metric.counter/histogram/gauge/timer` · `Otlp*`, `PrometheusMetrics`, `effect/devtools` | The span `level` lets us emit one span per CDP command at Debug level and filter it out by default. |
| Clock / TestClock | `effect/Clock`, `effect/testing/TestClock` | `TestClock { adjust(duration); setTime(ts); withLive(effect) }` · `layer(options?: { warningDelay? })` | `@effect/vitest` `it.effect` provides TestClock and TestConsole, so **timeouts never fire in tests against a real browser**. Use `it.live` or `withLive` there. `@effect/vitest@4.0.5` requires vitest 5. |
| Request | `effect/Request`, `effect/RequestResolver` | `Request.TaggedClass(tag)`, `RequestResolver.make(runAll: (entries, key) => Effect<void, …>)`, `batchN`, `setDelay`, `Effect.request(self, resolver)` | Mostly irrelevant to CDP, which has almost no batch endpoints. Possible uses: deduplicating `DOM.describeNode`, or `Accessibility.getPartialAXTree` fan-in. |
| Schema | `effect/Schema` | `Class`, `TaggedClass<Self>()(tag, fields)`, `TaggedError<Self>()(tag, fields)`, `Error<Self>(id)(fields)`, `Opaque<Self, Brand = {}>()(schema)`, `TaggedUnion(casesByTag)`, `toTaggedUnion`, `brand`, `Literals`, `fromJsonString`, `UnknownFromJsonString`, `Json`, `toStandardJSONSchemaV1` | `Opaque` gives a nominal type name with no runtime class. That is ideal for 1,500 generated protocol types: readable hovers and plain objects at runtime. |
| Codegen | `effect/SchemaRepresentation`, `effect/JsonSchema` | `fromJsonSchemaMultiDocument(document: JsonSchema.MultiDocument<"draft-2020-12">, options?: { onEnter?; patterns?: "error" \| "ignore" \| "apply" }): readonly [Schema.Top, ...Array<Schema.Top>]` · `toRepresentations(asts, options?): MultiDocument` · `toCodeDocument(document: MultiDocument): CodeDocument` (`{ codes, references: { nonRecursives, recursives }, artifacts }`) · `JsonSchema.fromSchemaDraft07` and related | Verified: a hand-converted CDP fragment produced `Schema.Literals([...]).annotate({identifier})` and `$ref` definitions in dependency order. Objects without `additionalProperties:false` become `StructWithRest(..., [Record(String, Json)])`. IDs come out as plain `Schema.String` with no brand, so brands need an `onEnter` step or post-processing. |
| Schema compilers | `effect/schema/SchemaJITCompiler/enable` (side effect), `effect/schema/SchemaAOTCompiler` | `compile = (targets: ReadonlyArray<Target>): string` (emits an ES module with `install(asts)`) | JIT: about 6× faster decoding (0.90 → 0.15 µs per `requestWillBeSent`, against 0.82 µs for `JSON.parse`). AOT is for content security policies (CSP) or Workers that forbid `new Function`. |
| RPC | `effect/rpc` (unstable) | `class Protocol extends Context.Service<Protocol, { run: (clientId: number, f: (data: FromServerEncoded) => Effect<void>) => Effect<never>; send: (clientId: number, request: FromClientEncoded, transferables?) => Effect<void, RpcClientError>; supportsAck: boolean; supportsTransferables: boolean; codecFor: RpcSerialization.CodecFor }>` · `Rpc.make(tag, { payload?, success?, error?, defect?, stream?, primaryKey? })` · `RpcClient.make(group, { spanPrefix?, generateRequestId?, flatten? })` · `makeNoSerialization` · `RpcSerialization.jsonRpc` | See the RPC assessment below. |
| AI | `effect/ai` (unstable) | `Tool.make(name, { description?, parameters?, success?, failure?, failureMode?, dependencies?, needsApproval? })` · `.annotate(Tool.Readonly \| Destructive \| Idempotent \| OpenWorld \| Title \| Meta, v)` · `Toolkit.make(...tools)`; `toolkit.toLayer(handlers \| Effect<handlers>)` · `LanguageModel.generateText({ prompt, toolkit?, toolChoice?, concurrency?, disableToolCallResolution?, toolCallValidation? })` · `McpServer.toolkit(toolkit)`, `McpServer.layerStdio({ name, version, protocols, … })`, `layerHttp` | Tool annotations map onto MCP hints (`readOnlyHint` and so on). `needsApproval` accepts a boolean or a function of the parameters, which suits destructive browser actions. One toolkit can serve both an in-process `LanguageModel` and an MCP server. |
| Persistence | `effect/persistence/KeyValueStore` | `toSchemaStore = <S extends Schema.Constraint>(self: KeyValueStore, schema: S): SchemaStore<S>` · `layerFileSystem`, `layerMemory`, `layerSql`, `layerStorage` | Storage for typed `storageState` (cookies and localStorage) across runs. |
| State / misc | `effect/Data`, `Match`, `TxRef`, `Effectable`, `ErrorReporter`, `ExecutionPlan`, `LayerMap`, `Graph` | `Data.taggedEnum`, `Match.tagsExhaustive`, `Effect.tx` with `TxRef`, `Effectable.Class<A, E, R>` (abstract `asEffect()`), `Effect.abortSignal: Effect<AbortSignal, never, Scope>`, `Effect.acquireDisposable` | There is no FSM module. Model lifecycles as `SubscriptionRef<TaggedEnum>` plus `Match`. `Effectable.Class` makes data yieldable (verified in `t9-yieldable.mjs`). |

### Verified semantics and gotchas

**Scope** (`t1-scope.mjs`):
- Sequential finalizers run in LIFO order (3,2,1).
- `"parallel"` runs all finalizers concurrently: three sleeps of 30/20/10 ms finished in about 30 ms.
- `close` is idempotent.
- A child created by `Scope.fork` **removes itself from its parent's finalizer map when closed**, so the parent goes back to `Empty`. A long-lived browser with thousands of short pages won't leak finalizers.
- Forking from a closed parent gives an already-closed child.
- `addFinalizer` on a closed scope runs the finalizer immediately.
- A finalizer that dies does not stop later finalizers; `close` then exits with `Failure`.
- Finalizers receive the `Exit` the scope was closed with.
- `Scope.close` is uninterruptible: interrupting a fiber in the middle of a close waited for the slow finalizer.
- Finalizer strategy is per scope, not per finalizer. For "close pages in parallel, then kill the process", give the browser a sequential scope that owns a parallel `pages` sub-scope.

**Subscription races** (`t2-queue.mjs`):
- `Stream.fromPubSub(ps).pipe(Effect.forkChild)` followed by an immediate publish **missed both events**.
- Subscribing eagerly first (`PubSub.subscribe` then `Stream.fromSubscription`) works.
- `forkChild({ startImmediately: true })` also works for `fromPubSub`, but **not** for `Stream.callback`, whose listener is registered by an internally forked fiber after the next yield.

The design rule that follows: every "wait for event X caused by command Y" API must establish the subscription inside an `Effect` that finishes before Y is sent.

**Dropping PubSub** (`t7-pubsub-drop.mjs`): `PubSub.dropping(2)` with one fast subscriber and one idle subscriber. The fast subscriber saw `[1,2]` and then everything else was dropped for it too, because capacity is shared and set by the slowest subscriber. A `sliding` PubSub keeps the fast subscriber lossless and the idle one sees only the last N.

**`Stream.callback` buffering** (`t8-callback.mjs`): the default is unbounded. With `bufferSize: 2`, `offerUnsafe` returned `[true,true,false,false,false]` and the extra events disappeared silently. `Stream.fromEventListener` has the same behavior.

**Interruption and timeouts** (`t3-misc.mjs`):
- An `Effect.callback` cleanup function runs when the fiber is interrupted. This is the correct pending-command pattern: one entry before the interrupt, zero after.
- `Effect.timeout` fails with `Cause.TimeoutError` (the `_tag` is `TimeoutError`, which was `TimeoutException` in v3) and also runs the cleanup.

**Socket** (`t6-socket.mjs`, using a fake `WebSocketLike`):
- A write made before connecting suspends, then is flushed after `open`.
- Frames that arrive while nobody is pulling are batched.
- Buffered frames are delivered before the close error (`SocketCloseError code=1006`).
- **A write after the connection closed suspended with no error.** The writer waits on a latch for a reconnection.
- Do not route CDP commands through `Socket.writer` without racing it against a connection-closed signal.

**Child process pipe transport** (read, not run: the tarball rules allow importing only effect itself):
1. `getInputFd(3)` is a `NodeSink.fromWritable` whose `endOnDone` defaults to true. Running a finite stream into it **ends fd3**, and Chrome treats end of file on its command pipe as a disconnect. Run a single long-lived `Stream.fromQueue(outbox)` into it and end it only on shutdown.
2. `getOutputFd(4)` is one `PassThrough` per descriptor, so it allows exactly one consumer. CDP pipe frames end with `\0`, so we must split on NUL ourselves.
3. stdout and stderr default to `"pipe"` and are piped eagerly into a `PassThrough`. If nobody reads `handle.stderr`, a chatty Chrome (`--enable-logging=stderr`) can fill the operating-system pipe and block. Set `stderr: "ignore"`, inherit it, or drain it into a log.
4. Always set `forceKillAfter`. Otherwise a Chrome that ignores SIGTERM hangs the finalizer after the 1 s grace period, because it is followed by an unbounded `Deferred.await(exitSignal)`.
5. Because `detached: true` creates a new process group, a SIGKILLed Node parent leaves Chrome orphaned. With the pipe transport the kernel closes fds 3 and 4 and Chrome exits when its pipe disconnects. I believe this is the behavior Playwright relies on, but I have not verified it. With the WebSocket transport we need a watchdog.
6. Bun's spawner re-exports the Node implementation on `node:child_process`. I couldn't verify whether Bun supports extra stdio pipes there.

**Schema performance** (`t5-bench.mjs`): interpreted decoding costs about the same as `JSON.parse` itself, roughly 0.9 µs per event. The JIT removes about 80% of the decode cost. At CDP message rates (thousands per second at most) validation is affordable either way. Bundle size and IDE hovers matter more than runtime.

**RPC assessment.** What we'd gain:
- A typed client derived from schemas.
- Per-call spans (`spanPrefix`) and client middleware, which could stamp the session ID or a default timeout.
- `RpcTest` for in-memory testing.
- `Protocol.run(clientId, …)` and `send(clientId, …)` can host many clients on one protocol, so "one `RpcClient` per CDP session" maps onto session multiplexing reasonably well.

What we'd lose or have to work around:
- CDP events are unsolicited `{method, params, sessionId}` messages. `RpcClient` only routes `Exit` and `Chunk` messages by request ID, so a separate demultiplexer is needed anyway.
- `RpcClient` sends `{_tag:"Interrupt"}` messages that the protocol must swallow, because CDP has no cancel.
- CDP `{code, message, data}` errors must be turned into encoded `Exit`s.
- `RpcSerialization.jsonRpc` is JSON-RPC 2.0 and server-oriented, not CDP.
- Trace headers are dropped.
- A 681-member `RpcClient<Rpcs>` mapped type gives poor hovers.
- The whole module is `@stability unstable`.

effect-cdp's ADR-001 reached the same conclusion. Where RPC does fit: a remote browser-pool or agent service exposing *high-level* operations (open page, run steps, snapshot) to other processes.

## API ergonomics: Effect v4 idioms and role models

This is the top priority. Each idiom below names a 4.0.5 module that does it well.

1. **Public operations use `Effect.fn("Module.op")`; internals use `Effect.fnUntraced`.** Every public verb (`Page.goto`, `Locator.click`) gets a span and a readable stack frame for free. Use the trailing pipeline arguments for cross-cutting behavior instead of wrapping in `Effect.gen`: `Effect.fn("Page.goto")(function*(url) {…}, Effect.timeout("30 seconds"))`. Use `Effect.fn.Return<A, E>` for explicit return types on exported functions. *Role model:* the `ai-docs` DevTools example (`Effect.fn("DevTools.changedTypeScriptFiles")`).
2. **Services use `class X extends Context.Service<X>()("pkg/X", { make })` with `static layer = Layer.effect(this, this.make)`.** The `<Self>()(id, { make })` overload infers the service shape from `make`, so the shape is written once. Use `X.use(f)` / `X.useSync(f)` for one-liners at call sites. *Role models:* `Socket.WebSocketConstructor` and the `ChildProcessSpawner` service.
3. **Offer both instance methods and module-level accessors.**
   - `HttpClient` exposes `client.get(url)` *and* `HttpClient.get(url): Effect<…, HttpClientError, HttpClient>`.
   - For us, singletons (Browser, connection) get module accessors with the service in `R`.
   - Multi-instance handles (Page, Frame, Locator) get methods, because two pages in `R` can't be told apart.
4. **Dependencies are captured at construction, so methods have `R = never`.**
   - `Socket.fromWebSocket` captures `fiber.context` (via `Effect.withFiber`) at build time.
   - `HttpClient` methods return `Effect<…, E, never>`.
   - Our `page.goto(url)` should be `Effect<Navigation, NavigationError>` with no `R`.
   - Platform services (`ChildProcessSpawner`, `FileSystem`, `WebSocketConstructor`) should appear only in the launcher layer's `R`, never at call sites.
5. **Commands are data and also effects.** `ChildProcess.StandardCommand extends Effect.Effect<ChildProcessHandle, PlatformError, ChildProcessSpawner | Scope>`, and it accepts a template literal (`` make`chrome --headless` ``). `Context.Service` keys and `Schema.TaggedError` instances are also yieldable. `Effectable.Class` makes this cheap: `yield* Page.navigate({ url })` worked against a fake session (`t9-yieldable.mjs`), and interruption removed the pending entry.
6. **Dual and pipeable combinators transform values.** Use `Function.dual` for data-last combinators on clients, effects and streams (`HttpClient.retryTransient`, `HttpClient.mapRequest`, `ChildProcess.pipeTo`, `RcMap.get`), and make handle types `Pipeable`. Rule of thumb: verbs that *do something* to one handle are methods. Things that *decorate or configure* (`withTimeout`, `on(session)`, `withRetry`) are dual combinators.
7. **Errors carry a reason.**
   - `HttpClientError { reason: TransportError | StatusCodeError | … }` and `SocketError { reason: … }` are recovered with `Effect.catchReason("CdpError", "TargetClosed", f)` / `catchReasons` / `unwrapReason`.
   - Callers write one tag in their signatures but can still be precise.
   - Keep domain errors (JavaScript exception, navigation failed) separate from transport and protocol errors.
8. **Defaults come from `Context.Reference`, not option bags.**
   - `Tool.Readonly`, `Tracer.DisablePropagation` and `HttpClient.TracerDisabledWhen` all follow this pattern.
   - Define `Cdp.DefaultTimeout = Context.Reference<Duration.Input>("…", { defaultValue: () => "30 seconds" })` and override it locally with `Effect.provideService`.
   - Accept `Duration.Input` (strings like `"5 seconds"`) everywhere, never `Duration.Duration`.
9. **Avoid `Scope` ceremony** by choosing lifetimes deliberately:
   - (a) **Parent-owned by default.** Like `FiberMap.run` and `forkIn`, `context.newPage()` registers the page's finalizer in the context's scope and returns `Effect<Page, E>` with no `Scope`. `page.close` closes early.
   - (b) **Opt-in narrowing.** Provide `newPageScoped` or `Browser.withPage(f)` (an `acquireUseRelease`) for code that wants strict nesting.
   - (c) **`HttpClient`'s trick** ties response lifetimes to `FinalizationRegistry`, with a 5 s timer fallback and an opt-in `HttpClient.withScope`. That's fine for cheap remote handles (JS handles, object groups) but **wrong** for pages, which are heavy and need deterministic cleanup.
   - (d) **Layers for long-lived things** (`Browser.layer`), and `LayerMap` for keyed instances.
   - Reserve `Scope` in `R` for subscriptions and handles whose lifetime the caller must control (`session.subscribe`, `realm.handle`).
10. **Eager hot streams.** `Stream.share` and `broadcast` return `Effect<Stream, never, Scope>`: the subscription exists once the effect completes. Use the same shape for race-free event APIs, and add a `waitFor(event, { trigger })` combinator so callers never have to fork.
11. **Platform choice at the edge.** Effect exposes `Socket.layerWebSocket` plus `NodeSocket.layerWebSocketConstructor` and `BunSocket.…` variants, rather than a separate `layerNode` / `layerBun` for every feature. *Role model:* `KeyValueStore.toSchemaStore(store, schema)`, a typed projection over an untyped service, which is what we want for event demultiplexing.

## Part B: effect-cdp 0.2.0 in depth

**Shape.** About 600 lines of core code (`Cdp.ts`, `CdpConnection.ts`, `internal/{dispatcher,pending,send,eventBus,socketBridge}.ts`), plus helpers (`helpers/{Page,Network,Runtime,DOM,Form,Target}.ts`), `layers/AuthWebSocket.ts` (for `ws` headers and Cloudflare `fetch` upgrades) and generated domains. The published dist matches the HEAD layout.

**Compatibility is broken.** The code imports `effect/unstable/socket` and uses the release-candidate (rc.112) API: `socket.run(handler)`, and `socket.writer` returning a function. On 4.0.5 the import fails (`ERR_MODULE_NOT_FOUND`, verified), and the 4.0.5 Socket has `reader` and `writer` objects instead. The peer range `>=4.0.0-rc.112 || >=4.0.0` is therefore wrong. It also declares `engines.node >= 26`.

**Transport.** WebSocket only; there is no pipe transport and no launcher.
- `socketBridge.ts` pushes frames into an **unbounded** queue with `Queue.offerUnsafe`, so the socket gets no backpressure.
- The dispatcher decodes each frame with `Schema.decodeEffect(Schema.fromJsonString(Schema.Json))`, a deep JSON validation.
- It then deep-walks `params` again (`isJson`), and command results are decoded a third time against the result schema. That is three full traversals per message.
- `TextDecoder.decode(chunk, { stream: true })` is used across *messages*. That is wrong for a message-oriented transport, though harmless in practice.

**Correlating commands with responses** (`pending.ts`, `send.ts`):
- State is a `Ref<HashMap<id, {deferred, sessionId, method}>>`.
- The send sequence is `nextId` → `register` → write (scoped writer acquisition) → `Deferred.await(...).pipe(Effect.ensuring(pending.cancel(id)))`.
- Interrupting during the await removes the entry, and the late response is ignored. Good.
- Interrupting **during the write** leaks the entry until `drainAll`, because the `ensuring` isn't attached yet. That happens when the socket hasn't opened yet, or when an outer `Effect.timeout` fires.
- The per-command `timeout` only covers the await.
- `CdpConfig.defaultTimeout` is declared but **never read**, so commands without an explicit timeout can hang forever.
- The library never documents that interruption only stops the waiting. The browser still runs the command: `Runtime.evaluate({awaitPromise})` keeps running, and a late `callFunctionOn` result leaks a remote object.
- `Input.*` sequences can be torn apart by interruption, leaving the mouse button down.

**Session multiplexing:**
- `cdp.session(id)` just stamps `sessionId` onto outgoing commands and filters the global event stream.
- Sessions have no Scope, no attach or detach lifecycle, and nothing closes them.
- `SessionRegistry` is exposed as `cdp.registry`, but nothing ever calls `attach`, so it is dead code.
- `Target.detachedFromTarget` and "No session with given id" fail that session's pending commands (good). Event streams **never end** on detach or disconnect: `events` is `Stream<RawCdpEvent>`, which has no error channel.

**Events and backpressure:**
- Events are untyped: `RawCdpEvent { method: string; params: Json; sessionId? }`. Generated event schemas exist, but every helper repeats `Stream.filter(e => e.method === X.method)` plus a manual decode.
- The bus is a single global `PubSub.dropping(eventBufferSize)`. Every session stream subscribes to it, so delivery fans out as O(sessions × events).
- **One slow subscriber causes drops for all subscribers** (verified). `helpers/Target.autoAttach` is a slow subscriber by construction, since it makes a network round trip per `attachedToTarget`.
- The dropping metric `cdp_events_dropped_total` is good hygiene, but lossy-by-default is the wrong default for automation. A missed `executionContextCreated` or `loadEventFired` turns into a hang.

**Races in the helpers:**
- `Page.goto` forks a lazily subscribed waiter and then sends `navigate`. That is the verified race, softened only because the send yields.
- `goto` waits for *any* next `loadEventFired`, with no loader or frame correlation and no timeout. Same-document navigations never fire a load event, so `goto` hangs.
- `autoAttach` sends `setAutoAttach` **before** subscribing. Chrome emits `attachedToTarget` for existing targets *before* it replies, so those events are always missed.
- With `waitForDebuggerOnStart: true` it never calls `Runtime.runIfWaitingForDebugger`, so targets stay paused.

**Codegen** (`scripts/codegen.ts` plus `codegen/{loadProtocol,resolveRefs,scc,detectRecursive,sort}`, `emit/*`):
- It loads the `devtools-protocol` JSON, resolves cross-domain `$ref`s, detects strongly connected components, and wraps recursive and cross-domain-cyclic references in `Schema.suspend`.
- It topologically sorts each domain, emits JSDoc, and runs a `check-codegen` drift test. That design is good and worth borrowing.
- Output: 60 files, 1,497 exports, 681 commands, 211 events, 684 KB of source.
- The dist is 3.5 MB on disk: 2.4 MB of generated code, of which 877 KB is `.d.mts` and 403 KB is `.mjs`, plus source maps.

Codegen smells:
- IDs are unbranded (`export const SessionID = Schema.String.annotate(...)`). The hand-written `SessionId` brand in `types.ts` never matches the generated type, so `SessionId.makeUnsafe` casts are everywhere and the brand gives false safety.
- `type: object` without properties becomes `Schema.Json`, so `Network.Headers = Schema.Json` instead of `Record<string, string>`.
- Everything is an anonymous `Schema.Struct`, so hovers expand to the full structure.
- Every field uses `Schema.optional`, which accepts `undefined`.

**Tree-shaking:**
- Because of import cycles, rolldown merged Page, Emulation, Security, Network and DOM into a single 221 KB chunk (`DOM-CtXahT79.mjs`). `generated/Page.mjs` only re-exports from it.
- None of the top-level `Schema.Struct(...).annotate(...)` calls carry `/*#__PURE__*/` annotations. Effect itself runs `babel annotate-pure-calls`.
- As a result, importing `Page.navigate` pulls in roughly 221 KB unminified plus transitive domains.

**Type-check cost** (measured with tsc 7.0.2, `/tmp/effect-scratch/tc`):
- Importing 5 domains and decoding: 4 ms check time.
- A string-keyed `send(method, params)` map over all 681 commands: 15k types, 26k instantiations, 20 ms check time, 123 MB.
- TypeScript 5.9 would be slower; I did not measure it. Cost is not the blocker. Readability is.

**Error model:**
- There are four `Schema.TaggedError`s: `CdpDisconnected{reason: SocketClosed | ScopeFinalized | TargetDetached | PeerKilled}`, `CdpTimeout`, `CdpDecodeError`, `CdpProtocolError{code, message, method, sessionId?}`.
- After a socket close, `drainAll` marks the map `Closed`, and **new** commands then report `ScopeFinalized`, which is the wrong reason.
- Real connection errors are swallowed. `ECONNREFUSED`, a 401 on upgrade and a bad URL all end the bridge and surface only as `CdpDisconnected`. `AuthWebSocket` turns upgrade and import failures into defects (`Effect.die`, `Layer.orDie`).
- Helpers force domain errors into `CdpProtocolError`: JavaScript exceptions get code `-32000` and `errorText` gets `-1`. Their `CdpTimeout` carries a fake `requestId: 0`.

**Reconnect:**
- The `reconnect` option wraps `socketEffect` in `Effect.retry`. That `socketEffect` is typed `Effect<Socket, never, Scope>` and dials lazily, so **the retry can never trigger**. `layerNode` and `layerBun` ignore the option entirely.
- Reconnect isn't meaningful at the transport layer anyway. Session IDs, enabled domains, execution contexts, `RemoteObjectId`s, Fetch interception and bindings all belong to the connection. A launched browser on a pipe has nothing to reconnect to.
- Only remote browsers (Browserless, CDP proxies) survive a dropped connection, and then "reconnect" means opening a new connection and rediscovering targets.
- The right model: losing the connection closes the root scope with `ConnectionLost`, and users wrap whole scoped workflows in `Effect.retry`.

**Other smells:**
- The service constructor reads `process.env["EFFECT_CDP_TEST"]`.
- A test-only `__testPendingSize` sits on the public `CdpService` type.
- Variable `import()` specifiers are used to dodge bundlers.
- Public helpers use `Effect.fnUntraced`, so they get no spans.

**README bug:** `cdp.session(SessionId.makeUnsafe(targetId))` passes a *target* ID as a session ID. The correct call is `Target.attachToTarget({ targetId, flatten: true })` → `sessionId`. With the README version, the first command fails with "No session with given id", which the library reports as `CdpDisconnected{TargetDetached}`. Its `Stream.runCollect(session.events)` also never completes.

**Ergonomic smells at call sites** (from `scripts/smoke.ts` and the helpers):
- `Runtime.evaluate(cdp, sessionId, "1+1", Schema.Finite)` and `Page.goto(cdp, sessionId, url)` thread the service and the session positionally through every helper. There's no session handle with methods, no `R`-based access, and nothing pipeable.
- Helper names collide with generated modules (`helpers/Target` and `generated/Target`), so the smoke script imports `GeneratedTarget` and `GeneratedRuntime`.
- Parameterless commands still need an empty object: `session.send(PageDomain.enable, {})`.
- Brands require `makeUnsafe` casts.
- `timeout` takes a `Duration.Duration`, not a `Duration.Input`.
- `CdpConfig` forces callers to pick `eventBufferSize`, an implementation detail, with no default. It is typed as `typeof CdpConfig.Type` instead of an options interface.
- `goto` returns `void`, with no navigation or response object.
- The layer constructors multiply (`layerNode`, `layerBun`, `layerWithAuthHeaders`, `layerCloudflare`) instead of composing a `WebSocketConstructor` layer.

## Recommendation for the protocol layer

**Write our own.** Borrow effect-cdp's codegen ideas with attribution (MIT), and optionally send upstream a 4.0.5 compatibility PR as goodwill. Building on effect-cdp would mean replacing its transport, bus, sessions, errors, generated ID types and helper API, which is everything except the codegen. Contributing our design upstream would conflict with its thin-client direction (ADR-001, "v1 scope OUT").

Concrete spec:
1. **`Transport`** carries framed text messages. It acquires the connection exactly once, never retries, and exposes a `closed` Deferred.
   - **WebSocket implementation:** `Socket.fromWebSocket` with our own `ws` constructor (`maxPayload: 256 MiB`, `perMessageDeflate: false`), reading through a single `reader` acquisition.
   - **Pipe implementation:** `ChildProcess` with `additionalFds` fd3 input and fd4 output, NUL framing, a single outbox stream, and `forceKillAfter`.
   - Writes go through one writer and **fail fast** with `ConnectionClosed` once `closed` completes.
2. **Dispatcher.** One reader fiber does `JSON.parse` and routes:
   - by `id` to a `MutableHashMap<number, resume>` of `Effect.callback` resumers, with cleanup on interrupt;
   - by `sessionId` to that session's router.
   - There is no global PubSub.
3. **Commands.** Default timeout comes from a `Context.Reference`. Interrupting means "stop waiting", and this is documented. Atomic input sequences run `uninterruptible`. Remote objects are always created in a realm-scoped `objectGroup` that is released when the realm closes.
4. **Sessions are Scope-backed.** The scope closes with `Exit.fail(TargetClosed | ConnectionClosed)` on detach, target destruction or connection loss. All pending commands fail, all subscriptions end with that typed error, and all fibers forked into the session's scope are interrupted.
5. **Events are lossless by default.** Each subscriber gets an unbounded queue, created eagerly. Sliding or dropping is opt-in per call, for example for `Page.screencastFrame`.
6. **Validation is a policy.** `"decode"` (JIT-enabled, the default in development and tests) or `"trust"` (cast only). The cost is measured and low, but trust mode helps bundle-sensitive environments such as Workers.
7. **Codegen.** Our own emitter:
   - branded IDs, `Schema.Opaque` named types and `/*#__PURE__*/` on every top-level call;
   - a types-only `.d.ts` layer separate from the codecs;
   - domain modules arranged to avoid cycles (shared ID modules, `suspend` only on true cycles);
   - yieldable command constructors and typed event descriptors;
   - a protocol-version pin plus a drift test.

   For WebDriver BiDi later: chromium-bidi already turns the spec's CDDL definitions into zod, and zod can produce JSON Schema, which can feed `SchemaRepresentation.fromJsonSchemaMultiDocument` → `toCodeDocument`. This needs verification.

## Candidate abstractions (type sketches)

```ts
// ---- Transport: framed messages, no reconnect semantics
export interface Transport {
  readonly send: (message: string) => Effect.Effect<void, ConnectionClosed>
  readonly messages: Stream.Stream<string, ConnectionClosed> // exactly one consumer: the dispatcher
  readonly closed: Effect.Effect<ConnectionClosed>           // Deferred.await
}
export declare const webSocket: (url: string, options?: {
  readonly maxPayload?: number | undefined; readonly headers?: Readonly<Record<string, string>> | undefined
}) => Effect.Effect<Transport, ConnectError, Scope.Scope | Socket.WebSocketConstructor>
export declare const pipe: (handle: ChildProcessHandle) => Effect.Effect<Transport, never, Scope.Scope>

// ---- One error, many reasons (Effect.catchReason("CdpError", "TargetClosed", …))
export class CdpError extends Schema.TaggedError<CdpError>()("CdpError", {
  method: Schema.String,
  reason: Schema.Union([ProtocolError /* code, message, data */, TargetClosed, ConnectionClosed, Timeout, DecodeError])
}) {}

// ---- Commands are yieldable data (Effectable.Class); the session comes from R or explicitly
export interface Command<M extends string, P, A> extends Effect.Effect<A, CdpError, CdpSession>, Pipeable {
  readonly method: M
  readonly params: P
}
export interface CommandDef<M extends string, P, A> {
  (...params: [P] extends [void] ? [] : [params: P]): Command<M, P, A>
  readonly method: M
  readonly Params: Schema.Codec<P, unknown>
  readonly Result: Schema.Codec<A, unknown>
}
export declare const on: {                       // dual: pick a session explicitly
  (session: CdpSession): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, CdpSession>>
  <A, E, R>(self: Effect.Effect<A, E, R>, session: CdpSession): Effect.Effect<A, E, Exclude<R, CdpSession>>
}
export const DefaultTimeout = Context.Reference<Duration.Input>("cdp/DefaultTimeout", { defaultValue: () => "30 seconds" })
// call sites:
//   const { frameId } = yield* Page.navigate({ url })
//   yield* Page.enable()
//   yield* Page.captureScreenshot({ format: "png" }).pipe(Cdp.on(popup))

// ---- Typed events, eager subscription, race-free waitFor
export interface EventDef<M extends string, A> { readonly method: M; readonly Params: Schema.Codec<A, unknown> }
export interface CdpSession {
  readonly id: SessionId | undefined // undefined = browser root session
  readonly scope: Scope.Scope
  readonly closed: Effect.Effect<TargetClosed | ConnectionClosed>
  readonly send: <M extends string, P, A>(command: Command<M, P, A>) => Effect.Effect<A, CdpError>
  readonly subscribe: <M extends string, A>(event: EventDef<M, A>, options?: {
    readonly buffer?: "unbounded" | { readonly capacity: number; readonly strategy: "sliding" | "dropping" } | undefined
  }) => Effect.Effect<Stream.Stream<A, TargetClosed | ConnectionClosed>, never, Scope.Scope> // live on return
  readonly waitFor: <M extends string, A, B extends A = A, X = void, EX = never, RX = never>(
    event: EventDef<M, A>,
    options?: {
      readonly filter?: ((a: A) => a is B) | ((a: A) => boolean) | undefined
      readonly trigger?: Effect.Effect<X, EX, RX> | undefined // sent only after subscribing
      readonly timeout?: Duration.Input | undefined
    }
  ) => Effect.Effect<B, EX | CdpError, RX>
}

// ---- Lifecycle tree: every node owns a Scope forked from its parent's.
// Closed locally (close) OR remotely (detachedFromTarget, frameDetached, executionContextDestroyed, disconnect).
export interface Node<Reason> {
  readonly scope: Scope.Scope
  readonly closed: Effect.Effect<Reason>                   // completes with why it died
  readonly close: Effect.Effect<void>
  /** run `effect` bound to this node's lifetime: remote death becomes a typed failure, not a hang */
  readonly within: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Reason, R>
}
export interface Browser extends Node<BrowserClosed> {
  readonly newContext: (options?: ContextOptions) => Effect.Effect<BrowserContext, CdpError> // browser-owned
  readonly contexts: SubscriptionRef.SubscriptionRef<ReadonlyArray<BrowserContext>>
}
export interface BrowserContext extends Node<ContextClosed> {
  readonly newPage: Effect.Effect<Page, CdpError>          // context-owned: no Scope in R
  readonly pages: SubscriptionRef.SubscriptionRef<ReadonlyArray<Page>>
}
export interface Page extends Node<PageClosed>, Pipeable {
  readonly session: CdpSession
  readonly mainFrame: Effect.Effect<Frame>
  readonly goto: (url: string, options?: { readonly waitUntil?: "commit" | "domcontentloaded" | "load"; readonly timeout?: Duration.Input }) =>
    Effect.Effect<Navigation, NavigationError | CdpError>
}
export interface Frame extends Node<FrameDetached> {
  readonly realm: (world?: "main" | "utility") => Effect.Effect<Realm, FrameDetached>
}
export interface Realm extends Node<RealmDestroyed> {
  readonly evaluate: <A, I>(schema: Schema.Codec<A, I>, fn: string | ((...args: never) => unknown), ...args: ReadonlyArray<unknown>) =>
    Effect.Effect<A, JsException | RealmDestroyed | CdpError>
  readonly handle: (expression: string) => Effect.Effect<JSHandle, JsException | CdpError, Scope.Scope> // releaseObject finalizer
}
export declare const withPage: <A, E, R>(f: (page: Page) => Effect.Effect<A, E, R>) =>
  Effect.Effect<A, E | CdpError, R | BrowserContext>       // acquireUseRelease, for strict nesting

// ---- Internal ownership: background loops per target, keyed resources
//   FiberMap<TargetId, void, never>   per-target event pumps (replaced on reattach)
//   RcMap<RealmKey, Realm>            shared isolated worlds, idleTimeToLive
//   PartitionedSemaphore<PageId>      serialize Input.* per page
//   SubscriptionRef<FrameTree>        frame tree as observable state

// ---- Agent toolkit, served in-process and over MCP from one definition
const Navigate = Tool.make("navigate", {
  description: "Navigate the active page", parameters: Schema.Struct({ url: Schema.String }),
  success: PageSnapshot, failure: BrowserToolError, dependencies: [ActivePage]
}).annotate(Tool.OpenWorld, true)
const Snapshot = Tool.make("snapshot", { success: AriaSnapshot, dependencies: [ActivePage] }).annotate(Tool.Readonly, true)
export const BrowserToolkit = Toolkit.make(Navigate, Snapshot /*, Click, Type, Screenshot */)
// BrowserToolkit.toLayer(handlers) → LanguageModel.generateText({ prompt, toolkit: BrowserToolkit })
// McpServer.toolkit(BrowserToolkit) + McpServer.layerStdio({ name, version, protocols })
```

The novel part is **remote-driven scopes**. Scope closure is already structural (verified: child scopes close with their parent and detach when closed). When the protocol layer closes a node's scope on remote events, `node.within(effect)` gives structured concurrency bounded by the *browser's* view of an object's lifetime. Every wait, poll and stream tied to a dead frame or realm ends promptly with a typed reason instead of timing out.

Testing story:
- An in-memory `Transport` built from two Queues acts as a scriptable fake browser.
- Use `it.effect` with TestClock for timeout logic and `it.live` for real-browser suites.
- Commands as data make it easy to record and assert the wire traffic.

Observability:
- `Effect.fn` spans on high-level verbs.
- One span per command at `level: "Debug"` with `cdp.method` and `cdp.session` attributes.
- `Metric.counter("cdp_commands", { attributes })`, a latency histogram, and a pending-commands gauge.

## Open questions

1. **Pipe end of file.** Does Chrome reliably exit when fd3 and fd4 close after the parent is SIGKILLed? This is what makes `detached: true` safe. And does Bun's `node:child_process` support extra stdio pipes for `additionalFds`? Both need an integration test with a real Chrome.
2. **Our own `ChildProcess` spawn for the pipe?** Should we use our own `node:child_process` spawn plus `NodeSocket.fromDuplex(Duplex.from({ readable, writable }))` to get a `Socket`? The other option is wrapping `getInputFd` / `getOutputFd`. The first gives end-to-end backpressure but ties us to Node.
3. **Upstream fixes.** Should we ask Effect to (a) add a fail-fast writer mode to `Socket` (no latch while disconnected), and (b) let the `ws` options (`maxPayload`, `perMessageDeflate`) pass through `NodeSocket.layerWebSocketConstructor`? Or do we own a small `ws` constructor layer?
4. **Default validation policy.** Decode every event and result (about 1 µs, JIT about 0.15 µs), or trust Chrome and validate only in tests? Does `SchemaAOTCompiler` belong in our build for CSP or Workers targets?
5. **Codegen route.** Write our own emitter (about 1k lines, full control over brands, `Opaque` and PURE annotations), or go devtools-protocol → JSON Schema → `SchemaRepresentation.toCodeDocument` with `onEnter` hooks? The second is the same path BiDi would take, through chromium-bidi's zod output. How large and how readable is the official route's output for all 1,497 definitions?
6. **Opaque types in hovers and errors.** Do `Schema.Opaque` names survive in hover text and error messages under TypeScript 7, and do they keep `.d.ts` size well below effect-cdp's 877 KB?
7. **Ambient session or explicit handles.** Is an `R`-based `CdpSession` for raw commands plus handle methods for high-level verbs the right split? Or do users with several pages always want explicit handles?
8. **Interrupt semantics per command.** Which commands need compensation when interrupted (`Input.dispatchMouseEvent` pairs, `Fetch.continueRequest` for paused requests, `Runtime.evaluate` with `awaitPromise` → `terminateExecution`)? Should we encode this as command metadata in the generated code?
9. **Stability risk.** Socket, ChildProcess, RPC and AI are all `@stability unstable` within an LTS release. How far does that risk spread into our public API, and should we re-export our own types rather than Effect's?
