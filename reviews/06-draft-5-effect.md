# Design review — draft 5, against Effect's own modules

*2026-10-19. Review of commit `37cc9b1` (revision 5.21) against Effect `origin/main` at `93abf0208` (2026-10-19), including its unstable modules and in-flight work: `v4/next-minor`, `v4/next-major`, `feat/effect-test-runner` (etest), `refactor/bytes-helpers`, `feat/schema-net-codecs`, `mcp-tool-failure-reporting`, and the local `feat/zip` branch. This commit records the review only.*

The question for this pass: where does the design rebuild something Effect already has, and where does a concept fit an Effect module we don't use? "Better TypeScript with Effect" means a user's Effect knowledge should carry over: the types they already know, and the services they already provide.

On `main`, the former `effect/unstable/*` modules are now plain subpaths: `effect/http`, `effect/ai`, `effect/cli`, `effect/rpc`, `effect/socket`, `effect/process`, `effect/encoding`, `effect/observability`, `effect/persistence`, `effect/reactivity`, `effect/eventlog` and others. Most are still marked `@stability unstable`. The design already uses `Schema`, `Redacted`, `Scope`, `Layer`, `Context.Reference`, `SubscriptionRef`, `PubSub`, `Stream`, `JsonPatch`, `ChildProcess`, `Socket`, `FileSystem`, `TestClock`, `Effect.validate` and `effect/http`'s `Headers`, so the findings are about the rest.

## What Effect lacks, which we keep

| Ours | Closest in Effect | Why ours stays |
|---|---|---|
| `Watchable<A>` | `SubscriptionRef` (read-write), `reactivity/Atom` | v4 has no read-only view of a `SubscriptionRef`, and `Atom` needs a registry and is built for UI state. A read-only view with a level-triggered `waitFor` is worth proposing upstream |
| `Pending<A>` | `Deferred` | a read-only latched result whose deadline starts when it is awaited; Effect has no read-only `Deferred` |
| Operation deadlines | `Effect.timeout` | Effect has no deadline that nested calls inherit and can only shorten. Ours lives in a `Context.Reference` on a live clock; another upstream candidate |
| Lossless subscriber buffers that fail on overflow | `PubSub` strategies | `PubSub` offers backpressure, dropping and sliding. Backpressure would stall the fold, so we need a fourth, failing strategy |
| `Registration` handles | a child `Scope` | releasing early through a child scope works, but a handle with `remove` and `hits` is what principle 19 asks for |
| `Url` brand | `URL` with `effect/http`'s `Url` helpers | `URL` is mutable and compares by identity; a branded string is immutable and `Equal` by value. Parse it with `Schema.URLFromString` at the boundary, and convert when calling `effect/http` |

## Findings

### 1. High — Route fulfilment rebuilds `effect/http`'s responses

**Where:** API.md, Network (`Route.fulfill({ status, headers, body })`, `ResponseBody.json/text/bytes/file`, `RequestOverrides`).

A route that fulfils a request is serving a response. `HttpServerResponse` already describes an immutable response with status, headers, cookies and an `HttpBody`, and it comes with constructors for JSON, text, bytes, streams and files. `ResponseBody` is a smaller copy of `HttpBody`. On the request side, `continueWith(overrides)` takes our own `RequestOverrides`, where `HttpClientRequest` already has the combinators (`setHeader`, `setMethod`, `setUrl`, `bodyJson`).

**Recommendation:**
- `Route.fulfill(response: HttpServerResponse)`. Remove `ResponseBody`.
- `Route.continueWith((request: HttpClientRequest) => HttpClientRequest)`. A change the backend can't apply fails with `Unsupported` and names the field, so nothing is dropped silently. CDP can override URL, method, headers and body; BiDi can also set cookies.
- `NetworkRequest` converts to an `HttpClientRequest`, so a captured request can be replayed with `HttpClient`.

### 2. High — Diagnostic presets rebuild `Redactable`

**Where:** README, Diagnostics and secrets; CONCEPTS.md §10 ("protected by the central diagnostic serializer").

The design classifies values (credentials, cookie values, typed text, URL queries, titles) and renders them through our own serializer under a `local` or `strict` preset. Effect has a protocol for exactly this: a value implementing `Redactable` decides its own rendering from the current fiber's `Context`, and Effect's logger, tracer and inspection use it. `Headers` already redacts through `CurrentRedactedNames`. With our own serializer, only our output is protected: a user who logs a `NetworkRequest` with `Effect.log` bypasses the presets.

**Recommendation:** classified values implement `Redactable`, reading the preset from the `Context.Reference` that `Browser.withDiagnostics` sets. The "central serializer" becomes Effect's own rendering, so logs, spans and errors redact the same way, including in user code. Sensitive header names join `CurrentRedactedNames`.

### 3. Medium — Captured bodies rebuild `HttpIncomingMessage`'s decoders

**Where:** API.md, State and events (`body: Body.json(schema)`, `Body.text`, `Body.bytes`; `CapturedResponse<B>`).

`HttpIncomingMessage` is Effect's model of a received message, with headers and body accessors, and decoders such as `schemaBodyJson(schema)`. `BodyDecoder` and `Body` repeat them.

**Recommendation:** a captured response is an `HttpIncomingMessage`. The `body` filter takes any `(message: HttpIncomingMessage) => Effect<B, E>`, so `HttpIncomingMessage.schemaBodyJson(Cart)` and the other decoders work as they are. Remove the `Body` module. The filter still decides that bodies are collected, at subscription time.

### 4. Medium — Names that clash with Effect modules

| Ours | Clashes with | Recommendation |
|---|---|---|
| `EventLog<A>` (returned by `history`) | `effect/eventlog`'s `EventLog`, an event-sourcing runtime | `EventHistory<A>` |
| `HttpStatus` brand | `effect/http`'s `HttpStatus` module (named codes, `fromLiteral`) | `HttpStatusCode`, which stays assignable to `number` wherever Effect HTTP expects one; filters also accept `HttpStatus.fromLiteral("Created")` |
| `HttpMethod` | `effect/http`'s `HttpMethod` | use Effect's |
| `DateInput` | `DateTime.Input` | use Effect's |

### 5. Medium — Secrets and launch settings should come from `Config`

**Where:** API.md (`Redacted.make(env.PASSWORD)` in Agents and call site 1; `launchWith` options); CLI.md (`--secret password=env:PASSWORD`).

The sketches read secrets straight from the environment. Effect's way is `Config.Redacted("PASSWORD")`: it works with any `ConfigProvider` (environment, files, secret stores, tests), and the value is never a plain string. Launch settings that differ per machine, such as an executable path in CI, are configuration too. Effect libraries follow a `layer(options)` / `layerConfig(Config)` convention for this.

**Recommendation:** sketches use `yield* Config.Redacted("PASSWORD")`. Backends gain `Chromium.launchConfig(Config)` beside `launchWith(options)`. The CLI's `--secret password=env:PASSWORD` reads through the daemon's `ConfigProvider`.

### 6. Medium — Exports and traces should use Effect's encoders and exporters

**Where:** API.md, Recordings.

- **The trace zip and HAR attachments are zip archives.** The in-flight `effect/encoding` `Zip` (the local `feat/zip` branch) encodes zip archives as streams, with ZIP64, and never buffers a whole entry. `exportTrace` and `Har.record({ content: "attach" })` should write through it rather than through a zip library of our own.
- **Spans already have viewers.** Since spans are the record (5.21), `effect/observability`'s OTLP exporters send them to any OpenTelemetry backend, and `effect/devtools` streams them live to Effect's DevTools. Both are a `Layer`, not a feature of ours; the docs should say so.

### 7. Medium — No metrics

**Where:** README, Observability.

Spans and logs are covered; metrics are absent. `Metric` covers counters, histograms and timers, and `effect/observability` exports them to OTLP or Prometheus.

**Recommendation:** operations by verb and outcome; actionability attempts per action; `Timeout` by phase; `EventOverflow`; protocol commands by method and latency; obligations decided by policy. Each is a `Metric` with attributes, and so off the hot path when metrics are disabled.

### 8. Low — Agent surfaces should name the Effect modules they rest on

**Where:** API.md, Agents; CLI.md, Commands and Client.

- **Tool failures go back to the model.** `effect/ai`'s `Tool` has a failure mode. Browser failures (`ActionError`, `Timeout`, `StaleRef`) should be returned to the model as the tool's failure schema, hint included, rather than failing the conversation. The in-flight `mcp-tool-failure-reporting` branch makes `McpServer` report such failures properly.
- **The CLI is built from Effect parts.** Commands are `effect/cli` `Command`s derived from the tools. The daemon serves an `effect/rpc` group over an `effect/socket` `SocketServer`. `--json` output for streams is NDJSON (`effect/encoding` `Ndjson`).

### 9. Low — Internal mechanisms that map onto Effect primitives

These don't change the API. Naming them in CONCEPTS.md and PROTOCOL.md keeps the implementation from reinventing them.

| Mechanism | Effect module |
|---|---|
| Domains and subscriptions enabled on demand, reference-counted (principle 8) | `RcMap`, keyed by session and domain, released when the last scope closes |
| Input serialized per page | `Semaphore`, one permit per page |
| The initialization gate: a target is published as ready only after setup | `Latch` |
| Compatible instantaneous checks batched into one injected evaluation | `Request` and `RequestResolver`, which also batch reads across concurrent fibers |
| Capability evidence cached per backend revision | `Cache` |
| Init-script `after` dependencies and cycle checks | `Graph` |
| Handlers and resolvers scoped to their entity | `FiberSet` and `FiberMap` |
| The persisted ownership ledger | `KeyValueStore` (`effect/persistence`), filesystem layer |
| Byte limits (WebSocket payload, body capture, queues) | `ByteSize` |

### 10. Low — Alignment with etest's assertions (in flight)

**Where:** API.md, Expectations and Testing.

etest's `Assert` throws a data-carrying `AssertionError`, every attempt keeps an `AssertionRecord`, and `eventually` re-runs an assertion at an interval. `Expect` overlaps `eventually` but adds change-signal re-checks, which `eventually` can't do. When etest ships, `Expect` should fail with `AssertionError`-shaped data and record into the attempt's `AssertionRecord` (research/effect-test-runner.md), while keeping its own retry loop. The Testing section should say that, so the overlap with `eventually` is a stated choice rather than an accident.

## Summary

| # | Severity | Finding | Effect module |
|---|---|---|---|
| 1 | High | route fulfilment and overrides rebuild HTTP types | `HttpServerResponse`, `HttpBody`, `HttpClientRequest` |
| 2 | High | diagnostic presets rebuild redaction | `Redactable`, `Headers.CurrentRedactedNames` |
| 3 | Medium | body decoders rebuild message decoding | `HttpIncomingMessage` |
| 4 | Medium | `EventLog`, `HttpStatus`, `HttpMethod`, `DateInput` | `eventlog`, `http`, `DateTime` |
| 5 | Medium | secrets and launch settings bypass `Config` | `Config.Redacted`, `layerConfig` convention |
| 6 | Medium | zip writing and trace viewing | `encoding/Zip` (in flight), `observability`, `devtools` |
| 7 | Medium | no metrics | `Metric`, `observability` |
| 8 | Low | agent surfaces | `ai/Tool` failure mode, `cli`, `rpc`, `socket`, `Ndjson` |
| 9 | Low | internal mechanisms | `RcMap`, `Semaphore`, `Latch`, `RequestResolver`, `Cache`, `Graph`, `FiberSet`, `KeyValueStore`, `ByteSize` |
| 10 | Low | `Expect` and etest's assertions | etest (in flight) |
