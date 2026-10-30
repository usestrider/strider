# Conventions

This file records the conventions Strider follows so that it reads as if Effect's core team wrote it: Effect's own conventions, the evidence for each in Effect's sources, and how Strider applies them. API.md's Conventions section applies them to the public API, `.agents/AGENTS.md` summarizes them for agents, and the README's principles give the reasons they serve. The evidence was gathered against Effect's `origin/main` at `93abf0208` (2026-10-19), cloned read-only at `.repos/effect`; file paths, line numbers and counts below refer to that commit. The sources are the team's written guidance (`.agents/AGENTS.md`, `.agents/skills/{effect-development,jsdocs,test-development,performance-analysis,package-development}`, `LLMS.md`, `ai-docs/src`) and the shipped modules most like Strider's (`http/HttpClient`, `http/HttpClientError`, `PlatformError`, `FileSystem`, `process/ChildProcessSpawner`, `socket/Socket`, `Queue`, `Schema`, `index.ts`, `typetest/`). Where this file is silent, Effect's skills in `.repos/effect/.agents/skills` are the reference.

## Effect's modules first

A user's Effect knowledge carries over: the types they already know, and the services they already provide. Where Effect has the type, module or service, Strider uses it rather than a copy:

- **HTTP.** A route's response is an `HttpServerResponse` (`Route.fulfill(HttpServerResponse.json(…))`, `.text`, `.uint8Array`, `.stream`, `.file`), and a request change is an `HttpClientRequest` transform (`Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))`). A captured response is an `HttpIncomingMessage`, decoded with Effect's decoders (`HttpIncomingMessage.schemaBodyJson(schema)`). `NetworkRequest.toHttpClientRequest` turns a captured request into one `HttpClient` can send. `Headers` and `HttpMethod` come from `effect/http`.
- **Dates and durations.** Dates are `DateTime`, as `LLMS.md` asks ("use the `DateTime` module instead of `Date`"), and inputs are `DateTime.DateTime.Input` and `Duration.Input`. `JSHandle.Serialized<A>` keeps `Date` only because that is what a page returns.
- **Configuration and secrets.** Secrets come from `Config.Redacted("PASSWORD")`, which works with any `ConfigProvider` (environment, files, secret stores, tests) and is never a plain string. Settings that differ per machine, such as an executable path, are configuration too: each backend has `layerConfig` beside `layer` (Layers, below). Layers that depend on configuration fit `Layer.unwrap` (`ai-docs/src/01_effect/…/20_layer-unwrap.ts`).
- **Redaction.** Values whose rendering depends on the diagnostics preset implement Effect's `Redactable`, reading the preset from `Diagnostics.CurrentPreset`, so Effect's logger, tracer and inspection apply it, in user code too. Sensitive header names join `Headers.CurrentRedactedNames`. A serializer of Strider's own would protect only Strider's output: a user logging a `NetworkRequest` with `Effect.log` would bypass it.
- **Observability.** Spans export through `effect/observability`'s OTLP exporters and show live in `effect/devtools`. Counts are `Metric`s, exported through `effect/observability` to OTLP or Prometheus. Each is a `Layer`, not a feature of Strider's.
- **Archives and encodings.** Trace zips and HAR attachments are written with `effect/encoding`'s `Zip`, which streams entries and supports ZIP64. Streaming `--json` output is NDJSON (`effect/encoding`).
- **Agents and the CLI.** Tools are `effect/ai` `Tool`s with `failureMode: "return"`, so a `LocatorError`, `Timeout` or stale ref reaches the model as data instead of ending the conversation. The CLI's commands are `effect/cli` `Command`s, and its daemon serves them over `effect/socket`.
- **Internal mechanisms name their primitive** (CONCEPTS.md §9), so the implementation uses it rather than rebuilding it: `RcMap` for domains enabled on demand, `Semaphore` for input per page, `Latch` for the initialization gate, `Request`/`RequestResolver` for batched checks, `Cache` for capability evidence, `Graph` for init-script dependencies, `FiberSet`/`FiberMap` for handlers, `KeyValueStore` for the ownership ledger, `ByteSize` for limits, `Deferred` for single-winner decisions, a `Queue` per subscription, and `Reactivity` for re-checks.
- **Names that clash with an Effect module are renamed, or replaced by Effect's.** `EventLog` would clash with `effect/eventlog`, `HttpStatus` with `effect/http`'s `HttpStatus` module, and Strider's `HttpMethod` and `DateInput` with Effect's `HttpMethod` and `DateTime.Input`. Names inside modules (below) avoid most of these: a status is `NetworkResponse.StatusCode`, a branded integer from 100 to 599 that goes wherever Effect HTTP expects a status.

### Where Strider keeps its own

| Strider | Closest in Effect | Why Strider's stays |
|---|---|---|
| `Watchable<A>` | `SubscriptionRef`, `reactivity/Atom` | Effect 4 has no read-only view of a `SubscriptionRef`, and `Atom` needs a registry and is built for UI state. A `Watchable` is built over a `SubscriptionRef`, as an effect value with its members attached, since Effect 4 has no public way to subclass `Effect` |
| `Deadline` | `Effect.timeout` | Effect has no deadline that nested calls inherit and can only shorten. `Effect.timeout` interrupts from outside, so an operation can't fail with its own evidence of how far it got. A `Deadline` lives in `Deadline.CurrentDeadline`, an absolute instant on the clock the browser runs on (the live clock for a real browser, Effect's for `Browser.layerTest`); operations read the time left and fail with `Timeout{phase}`, taken from what their record shows (`Deadline.ts`'s module doc) |
| subscription buffers that fail when full | `PubSub` | `PubSub`'s bounded strategies either apply backpressure, which would stall the fold, or drop and slide, which lose events silently. It also offers every message to every subscriber, so filters would run after buffering. Each subscription has a `Queue` of its own that the fold offers to without suspending, and a full one fails with `EventOverflow` (CONCEPTS.md §9) |
| `Registration` handles | a child `Scope` | A child scope can release early, but principle 19 asks for a handle with `remove` and, where useful, state such as `hits` |
| `Url.Url`, a branded string | `URL`, and `effect/http`'s `Url` helpers | A `URL` can be changed in place and compares by reference; a branded string is immutable and equal by value, as Effect's own `HttpClientRequest.url` is. `effect/http`'s `Url` module is how one is changed |

A read-only `Watchable` and an inherited `Deadline` are candidates for Effect itself; neither has been proposed.

## Modules

### Modules are namespaces, with short names inside

**Effect.** The package entry exports every module as a namespace, `export * as FileSystem from "./FileSystem.ts"`, 142 times in `packages/effect/src/index.ts`. Inside a module, names are short, because the namespace supplies the context: `Queue.Dequeue`, `Cookies.Cookie`, `HttpClient.With`, `Effect.Effect`, `Deferred.Deferred`.

**Strider.**
- `import { Browser, Download, Page } from "@usestrider/browser"`. Types read `Page.Page`, `Locator.Locator` and `Download.Download`.
- Supporting types are short inside their module: `UserContext.Options`, `CookieJar.Input`, `PageNavigation.Filter`, `Locator.ClickOptions`, `Download.Id`.
- An event module is a real module (`Download.ts` exports `interface Download` plus `next`, `stream` and `history`), not a merged type and constant.
- **Access levels keep their full names:** `Page.ObservedPage`, `Page.ReadonlyPage`, `Page.Page`, `Locator.ReadonlyLocator`, `OriginStorage.ReadonlyOriginStorage`. A bare `Page.Readonly` would shadow TypeScript's `Readonly<T>` inside the module, and Effect itself writes `Record.ReadonlyRecord` and `Array.ReadonlyArray`.
- **Imports.** Inside the package, Effect's and Strider's modules are imported as namespaces (`import * as Schema from "effect/Schema"`), which the language service's `namespaceImportPackages: ["effect", "@usestrider/*"]` asks for. Tests import a module by its own path (`@usestrider/browser/Locator`); JSDoc examples import from `"@usestrider/browser"`.

### One module per file, in the export map, with generated barrels

**Effect.** `package.json` maps `"."` to `src/index.ts` and `"./*"` to `src/*.ts`, and a subpath such as `"./http"` to its own barrel. `effect-utils codegen` writes each barrel as `export * as X` lines under the marker `// @barrel: Auto-generated exports. Do not edit manually.` Each line carries only `@stability` and `@since`. The module's description stays in the module, where the reference reads it.

**Strider.**
- `packages/browser/package.json` maps `"."` to `src/index.ts`, `"./*"` to `src/*.ts`, and each subpath to its own barrel: `./chromium`, `./firefox`, `./webkit`, `./bidi`, `./ai`, `./test`, `./cli`, `./protocol`, `./cdp`, `./bidi-protocol`, `./webkit-stock-protocol` and `./webkit-automation-protocol`. `./internal/*` and `./bin/*` map to `null`.
- `pnpm codegen` writes the barrels in Effect's format (`packages/tools/utils`). They are never edited by hand.
- Backends and surfaces are subpaths, so only the protocol code a program imports is loaded. The Vitest adapter is a package of its own, `@usestrider/vitest`, so `@usestrider/browser` depends on nothing but Effect.

### Brands are Schemas in the module that owns them

**Effect.** `cluster/EntityId.ts` is the model: a Schema value and a type with the same name, branded `"~effect/cluster/EntityId"`.

**Strider.**
- Each id lives in its owner: `Download.Id`, `UserContext.Id`, `Snapshot.RefId`, `InitScript.Id`, `Target.NavigableId`, `Target.DocumentId`. Brand keys are `"~@usestrider/browser/<Module>/<Name>"`, as in `Schema.String.pipe(Schema.brand("~@usestrider/browser/Download/Id"))`.
- Values with no single owner have small modules: `Url` (`Url.Url`, `Url.Pattern`, `Url.Origin`, `Url.Site`), `FilePath` (`Local`, `Remote`), `Pixels` (`Css`, `Device`), `AriaRole` (shaped like `effect/http`'s `HttpMethod`) and `MonotonicInstant`.
- `effect/http` also exports a `Url` module, so a file that needs both aliases one (`import { Url as HttpUrl } from "effect/http"`). The shared name has precedent: Effect's AI provider packages each export a module named `Generated`.

### Services and references

**Effect.**
- Services are `Context.Service`s keyed `"package/path/Name"` (`ai-docs/src/01_effect/03_services/01_service.ts`).
- Configuration with a default is a `Context.Reference` (`ai-docs/src/01_effect/03_services/10_reference.ts`). A reference is named descriptively in its module, as `Headers.CurrentRedactedNames` is.

**Strider.**
- **Services** are an interface and a constant of the same name: `export const Browser: Context.Service<Browser, Browser> = Context.Service<Browser>("@usestrider/browser/Browser")`. Likewise `@usestrider/browser/test/TestRun`, `CurrentSession`, `Protocol.ProtocolSession` and `SocketConnector`. This is the form of Effect's `FileSystem`, `HttpServerRequest` and `LanguageModel`, whose documented interface is the service; the class form, `class X extends Context.Service<X, Shape>()(key)`, is Effect's default where the service's name isn't its shape's, as `Cause.StackTrace` and `Model.ProviderName` are, and it is `Operation.Current`'s, whose value is an `Operation`. A service is never both: the form follows whether its type parameter and its value are the same type.
- **References** are keyed `"@usestrider/browser/<Module>/<Name>"`.
  - A reference to the value in force is `Current…`: `Deadline.CurrentDeadline`, `Diagnostics.CurrentPreset`, `Ledger.CurrentLedger`, `Protocol.CurrentValidation`.
  - A setting is named for what it sets: `Deadline.DefaultBudget`, `Expect.CheckInterval`, `Subscription.Capacity`, `NetworkResponse.BodyLimit`, `Page.UserGesture`, `Protocol.CommandTimeout`, `Browser.TraceProtocolCommands`.

## Members

### A member with nothing to configure is a value; settings are a trailing `options?`

**Effect.**
- Members take optional settings as a trailing `options?: … | undefined` parameter: `handle.kill(options?)` (`process/ChildProcessSpawner.ts:109`), `fs.makeTempDirectory(options?)`, `client.get(url, options?)`.
- A member with nothing to configure is a value: `handle.exitCode`, `socket.writer`.

**Strider.**
- Every configurable member takes one trailing `options?: … | undefined`:
  - locators: `click`, `dblclick`, `hover`;
  - pages: `goto(url, options?)`, `reload`, `back`, `forward`, `snapshot`, `screenshot`, `pdf`, `close`;
  - browsers: `newContext`, `newPage`;
  - elsewhere: `Trace.record` and the backends' `layer`.
- Every action has checks you can adjust, so actions are calls: `button.click()`, `button.click({ button: "right" })`.
- Members with nothing to configure stay values. That is an `Effect` for operations (`page.title`, `locator.count`, `readText`, `page.activate`, `context.newPage`), or a plain property for pure derivations (`locator.first`).
- If it doesn't have to be a function, it isn't one, and accepting settings counts as having to be one.

### `With` means "with a function"

**Effect.** The suffix means "with a custom function or a provided value": `zipWith(that, f)`, `sortWith(f)`, `contextWith(f)`, `scopedWith(f)`, `runPromiseWith(services)` (`Effect.ts`, `Array.ts`, `Stream.ts`). Effect never writes `xWith(options)`.

**Strider.**
- `*With` takes a function and never options: `Route.continueWith(change)`. `clickWith(options)` would read wrong to an Effect user.
- Evaluation in the main world couldn't be `evaluateWith({ world: "main" }, fn, …args)`. That is `With` with options, and the rest arguments leave no room for a trailing options object. So `evaluate(fn, …args)` is the isolated world on every page, and `evaluateInMainWorld(fn, …args)` the main world, only on `Page`. Running as a user gesture is the dual setting `Page.withUserGesture`.

### Cross-cutting settings are dual `with*` combinators

**Effect.** `Effect.withSpan` and `Logger.withMinimumLogLevel` set something for any effect, data-first or in `pipe`.

**Strider.**
- The combinators are `Deadline.within`, `Deadline.withDefaultBudget`, `Diagnostics.withPreset`, `Expect.withCheckInterval` and `Page.withUserGesture`. Each is backed by a `Context.Reference` and built with `dual` from `effect/Function`: `button.click().pipe(Deadline.within("5 seconds"))`.
- Option bags hold only what is specific to one operation.

### Services offer module-level accessors

**Effect.** A service module exports accessors that use the service from context. `HttpClient.get(url, options?)` is `Effect<HttpClientResponse, HttpClientError, HttpClient>` (`http/HttpClient.ts:195`). Callers who already hold the service use its members.

**Strider.**
- `Browser.newPage(options?)` and `Browser.newContext(options?)` use the `Browser` in context, for example `Effect<Page.Page, Page.PageError, Browser | Scope>`. Code that holds a `Browser` uses its members, which do the same.
- There is no test-only accessor (principle 22): a test gets its page the way a script does.

### A wait is an `Effect`, not a `Deferred`

`next` hands out the wait as an `Effect`: running it subscribes, and its value is the wait, latched on the first
match. The maintainer: "I guess there's no reason to use that module over a simple effect since the consumer will
never do anything other than await." A read-only `Deferred` would cost a module of its own, a name that shadows
Effect's, and a second step at every call site (`yield* Deferred.await(popups)`). Rejected:

- a read-only `Deferred` for `poll` and `isDone`: a caller who wants to know without blocking whether the event has
  arrived can race the wait against `Effect.void`;
- returning a `Fiber`: a public fiber, which principle 17 rules out, and joining one is no simpler than running an
  effect.

`Deferred`s stay inside the library (CONCEPTS.md §9).

### Fluent methods on central values are allowed

**Effect.** `Schema` keeps `annotate`, `check` and `mapFields` as methods (`Schema.ts:202–205`, `3531`), while most of its transformations are module functions.

**Strider.** Locator chaining (`filter`, `nth`, `first`, `and`, `or`) is the same kind of refinement, so it stays as methods.

### Operations on handles are members

Effect puts operations on handles as members (`client.get`, `handle.kill`), and a locator acts against its page. So it is `button.click()`, not `Locator.click(button)`.

## Layers

**Effect.**
- Layer exports are named `layer` (167 in the repository), `layerConfig` (28), or `layer` plus a descriptor: `layerWebSocket`, `layerMemory`, `layerTest`, `layerNoop`.
- Static layers sit on the service: `Database.layer`, `MessageStore.layerInMemory`, `Mailer.layerNoDeps`.
- Test doubles are `layerTest`: `Stdio.layerTest(impl)`, `GraphQLClient.layerTest(handlers)`.
- Libraries offer `layer(options)` beside `layerConfig`, which takes a `Config.Wrap` of the same options (the AI providers' clients, `AnthropicClient.layerConfig`).

**Strider.**
- Backends:
  - `Chromium.layer(options)`, `Chromium.layerConfig(options: Config.Wrap<Browser.LaunchOptions>)` and `Chromium.layerConnect(endpoint, options?)`;
  - `Firefox.layer`, `layerConfig` and `layerConnect`;
  - `WebKit.layer`, `layerConfig` and `layerAttach`;
  - `Bidi.layerConnect`.
- Elsewhere: `Browser.layerTest(timeline)`, the fake browser (`@stability experimental`); `VitestBrowser.layer`, in `@usestrider/vitest`; `Ledger.layer`; `SocketConnector.layer`.
- Platform services (`ChildProcessSpawner`, `FileSystem`, `Socket.WebSocketConstructor`) appear only in these layers. An ordinary call site requires only `Scope`, and `Browser` for the accessors.

## Data and types

### Data that crosses a boundary is a Schema

**Effect.** "All validation and domain modeling in Effect is done with `Schema`. **AVOID using predicates or manual parsing**" (`LLMS.md`). Shipped modules define domain values as Schema classes (`ai/Response.ts`, `ai/McpSchema.ts`). Live handles stay interfaces.

**Strider.**
- These are Schemas:
  - data events: `NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `AutoResolution`, `NetworkConnection.Frame`;
  - states: `Page.Status`, `Page.FrameTree`, `Download.Status`;
  - cookies (`BrowserCookie`'s value is `Schema.Redacted`), snapshot trees, storage state, the diagnostics envelope, `LaunchProfile` and every error.
- Live handles stay interfaces: pages, locators, downloads.
- A `Snapshot` is split. Its tree is a Schema (`Snapshot.Data`); its page-bound `ref(id)` is not serializable.
- Storage state crosses through `StorageState.Json`, a codec built with `Schema.toCodecJson`. Effect's default JSON encoding writes a `Redacted` as `"<redacted>"`. `exportStorageState` encodes with the same Schema, and decodes with it; there is no `StorageState.import`.
- What the CLI daemon sends, MCP tool results, `--json` output, history exports and trace attachments all encode these values without hand-written serializers.

### Optional fields admit `undefined`

**Effect.** Every optional field and parameter is written `?: T | undefined` (`FileSystem.makeTempDirectory`: `readonly directory?: string | undefined`). Callers under `exactOptionalPropertyTypes` can then pass `undefined` explicitly.

**Strider.**
- Every options interface is written this way. `tsconfig.base.json` enables `exactOptionalPropertyTypes`, so the checker enforces it.
- `pnpm pack-check` also type-checks the published declarations without that flag (Q240).
- What is truly optional in an output is `Option`, never `?:` (principle 15).

### Every public type is identified, guarded, pipeable and inspectable

**Effect.**
- Type IDs are strings with a `~` prefix: `TypeId = "~effect/socket/Socket"`.
- Each identified type has a guard: `isHttpClientError`, `isDeferred`, `isSubscriptionRef`, `Socket.isSocket` (`Predicate.hasProperty(u, TypeId)`).
- Values and handles implement `Pipeable` and `Inspectable`, with a structured `toJSON` (`http/HttpClientRequest.ts:56`, `104`).

**Strider.**
- **TypeIds.** Each public type has a string TypeId: `"~@usestrider/browser/Page"`, `"~@usestrider/browser/Locator/LocatorError"`. Opaque types (`FileInput`, route and dialog decisions, `Condition`, `AriaPattern`) use string TypeIds rather than `unique symbol` declarations. Schema class identifiers are `"@usestrider/browser/<Module>/<Name>"`, without the `~`.
- **Guards.** Each module has a kind guard: `Page.isPage`, `Locator.isLocator`, `Download.isDownload`, `Locator.isLocatorError`. Guards identify kinds, never access. `Page.isPage` narrows to `ObservedPage`, because access is a grant held by a `Scope`, not a fact about the page; no guard narrows access.
- **Pipeable and Inspectable.** Handles are `Pipeable`, so `page.pipe(Expect.toHaveURL(…))` works, and so is a `Condition`. Handles are `Inspectable`, and their `toJSON` is a structured description, such as `{ _id: "Page", id }`.

## Errors

### One error per module, with yieldable reason classes

**Effect.**
- **One error per module or family:** `HttpClientError` for `HttpClient`, `PlatformError` for every platform module (`FileSystem`, `ChildProcess`, …), `AiError` for AI.
- **A `reason` union of tagged, yieldable classes:** `TransportError` and `StatusCodeError`; `BadArgument` and `SystemError`.
- **The wrapper:**
  - derives `message` from its reason (`override get message()`);
  - lifts shared fields into getters (`request`, `response`) and propagates `cause`;
  - has a guard (`isHttpClientError`), and `PlatformError` has module-level constructors (`PlatformError.systemError(...)`).
- **`Socket.SocketError` is the model Strider follows:**
  - its reasons are `Schema.Error` classes with `_tag: Schema.tag(…)`;
  - the wrapper is a `Schema.TaggedError` with a string TypeId and a `message` taken from the reason;
  - its constructor copies the reason's `cause` onto the error (`socket/Socket.ts:534–569`).
- **Provider detail by augmentation:** providers add detail through module augmentation of a `metadata` interface (`typetest/AiError.tst.ts`).
- **An error that crosses modules stays outside any one of them,** as `Cause.TimeoutError` does.

**Strider.**
- **Module errors.** An operation fails with its module's error: `Locator.LocatorError`, `Page.PageError`, `Download.DownloadError`, `Declaration.DeclarationError`, `UserContext.UserContextError`, `Route.RouteError`, `PageClock.PageClockError`, `Trace.TraceError`, `Har.HarError`, and so on. Each is built like this:

  ```ts
  export class LocatorError extends Schema.TaggedError<LocatorError>(LocatorErrorTypeId)("LocatorError", {
    operation: Schema.String,
    locator: Schema.String,
    reason: LocatorErrorReason,               // a Schema.Union of the module's reasons and the shared ones
    diagnostics: Diagnostics.Diagnostics
  }) {
    readonly [LocatorErrorTypeId] = LocatorErrorTypeId
    override get message(): string { return `${this.operation} ${this.locator}: ${this.reason.message}` }
  }
  export const isLocatorError = (u: unknown): u is LocatorError => Predicate.hasProperty(u, LocatorErrorTypeId)
  ```
- **Reasons** are `Schema.Error` classes with `_tag: Schema.tag("…")`, their own fields and a `hint`. Their `message` includes the hint.
  - A reason that belongs to one module is declared there: `Locator.StrictViolation`, `PageNavigation.NavigationFailed`.
  - Reasons several modules share live in `Reason`: `InvalidInput`, `NotPermitted`, `Unsupported`, `BackendFailure`, `EvaluationThrown`, `NotSerializable`, `PromptBlocking`.
  - A reason that wraps a failure carries its own `cause` (`BackendFailure`, `Locator.FileUnreadable`, the recordings' `WriteFailed`).
- **Recovery matches the reason:** `Effect.catchReason("LocatorError", "StrictViolation", …)` (`ai-docs/src/01_effect/04_errors/20_reason-errors.ts`). `Effect.catchReason(tag, "Unsupported", …)` works for any module's tag.
- **Errors that cross every module:** `Target.TargetGone`, which lives with the ids and close reasons that describe targets, and `Deadline.Timeout`. Event streams add `Subscription.EventOverflow`.
- **A backend's detail is the failure's `cause`.** `Reason.BackendFailure` carries the browser's own error (`Protocol.ProtocolError`) as `cause`, with its code and message; there is no per-backend field to extend.
- **There are no verb-family errors** (`ActionError`, `ReadError`, `NavigationError`, …). Errors are per module, and error channels stay small because failures are reasons inside them.

## Tracing

**Effect.**
- Library internals use `Effect.fnUntraced`: 462 uses in `packages/effect/src` against 42 named `Effect.fn`s, most of those in documentation examples. `LLMS.md` prefers `fnUntraced` "particularly in library implementations and hot paths".
- A span marks a meaningful boundary. `HttpClient` opens one per request with `Effect.useSpan(…, { kind: "client" })` and OpenTelemetry's semantic-convention attributes (`http.request.method`, `http.response.status_code`, `error.type`).
- Its knobs are references: `SpanNameGenerator`, `TracerDisabledWhen`, `TracerHeaderFilter` and `Headers.CurrentRedactedNames` (`http/HttpClient.ts:705–760`).

**Strider.**
- **One span per user-visible operation,** named like `Locator.click`. The operation runs through `src/internal/operation.ts`, with `Operation.named(name, { attributes })` or `Operation.fn(name)`, which gives it a record and opens its span through `src/internal/spans.ts`; never `Effect.withSpan` or `Effect.fn` directly. That way `SpanNameGenerator`, `TracerDisabledWhen` and the diagnostics preset apply, and recordings learn of each operation. Launching and connecting open theirs with `Spans.operation`, since they start the connection's long-lived fibers. The public `Operation` module gives users the same, over the same record.
- **Attributes are in OpenTelemetry's style.** `browser.operation`, and the operation's target as `browser.page.id`, `browser.context.id` or `browser.realm.id`. `url.full` and `browser.endpoint` are redacted by the preset: under `"strict"`, a URL keeps its origin and path, each query value `REDACTED`, with no credentials or fragment.
- **Everything beneath an operation is `Effect.fnUntraced`.** Protocol commands get child spans only when `Browser.TraceProtocolCommands` is on, because they are a hot path.
- **The knobs are references,** as on `HttpClient`: `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` rename or suppress spans.

## Functions

**Effect.**
- "Avoid functions that only wrap and return `Effect.gen`". Use `Effect.fn("name")`, with the name matching the function, and pass extra behavior as arguments rather than `.pipe` (`LLMS.md`).
- Since Effect #9506 and #9512 (2026-10-19), Effect's sources and tests set `@effect/language-service` to `effectFnOpportunity: "error"` with `effectFn: ["untraced"]`. A function that returns `Effect.gen` is a compile error, and the suggested fix is `fnUntraced`.

**Strider.**
- `tsconfig.base.json` sets the same options (`effectFn: ["untraced"]`, `effectFnOpportunity: "error"`), under TypeScript 7 patched with Effect's language service (`effect-tsgo patch`).
- Library code uses `Effect.fnUntraced`, and an operation uses `Operation.fn`, which wraps one.
- Examples and acceptance scenarios, written for users, use `Effect.fn("name")(function*(page: Page.Page) { … })`. That also shows users the shape their own helpers should take.

## Documentation

### The JSDoc contract

**Effect.** The contract comes from `.agents/skills/jsdocs/*`:
- **Shape.** Every public declaration has a one-paragraph description, then optional **When to use**, **Details** and **Gotchas**, then `**Example** (Title)` sections. Each example is fenced ```` ```ts import.meta.vitest ```` and run by doctest.
- **Tags,** in this order: `@see`, `@stability`, `@category`, `@since`.
- **Categories** come from a fixed vocabulary: constructors, models, guards, getters, combinators, services, layers, errors, error handling, resource management, references, and so on.
- **Stability.** Since Effect #8770 (2026-10-07), every module and every importable export states `@stability` explicitly, not only where a dependency's types show.

**Strider.**
- **Shape.** The description starts with what the declaration does. **When to use** starts "Use to", "Use when", "Use as" or "Use with". Examples import from `"@usestrider/browser"`.
- **Categories.** The categories in use are Effect's (`models`, `schemas`, `guards`, `constructors`, `constants`, `combinators`, `getters`, `accessors`, `converting`, `references`, `configuration`, `services`, `tags`, `layers`, `errors`, `utility types`), plus four of Strider's: `reasons`, `subscriptions`, `matchers` and `handlers`.
- **Stability.** Until 1.0, `@stability` is `unstable`: breaking changes may come in minor releases, which 0.x semver allows. `experimental` marks what rests on an upstream proposal or an in-flight module, such as `Trace` and `Har` (built on `effect/encoding`'s `Zip`), `Browser.layerTest` and `SocketConnector`. `stable` waits for 1.0.
- **`@since`** is `0.1.0`.
- **APIs that expose `effect/http` types** (`Route`, `NetworkRequest.toHttpClientRequest`, `CapturedResponse`) can change when Effect's HTTP modules do, which Effect marks unstable.

### The API reference is generated

**Effect.** Effect's reference on effect.website is generated from the sources on every release, and nothing in it is written by hand. Five pieces make that work:
1. **One module per file, listed in the export map.**
2. **A generated barrel.** Its lines carry only tags.
3. **A checked JSDoc contract.** `effect-jsdocs --check` runs in CI. It enforces the description sections, the tag order, `@category`, `@since` and `@stability`, and that inline `{@link}` targets resolve. It writes a model of the whole API to `.data/jsdocs.json`: every declaration with its parsed sections, examples, tags, resolved `@see` links and import guidance.
4. **Examples that run.** `@effect/doctest`, a Vitest plugin, runs every ```` ```ts import.meta.vitest ```` fence in JSDoc, Markdown and MDX, and checks `// =>` assertions with `Equal`.
5. **The website.** When a release is promoted:
   - `npm-promote` sends a `repository_dispatch` event (`publish-api-reference`, with the revision), and Effect-TS/website checks out that revision.
   - Its `packages/api-reference/src/Generate.ts` finds each public module from the package's export map, skipping barrels and `internal/`.
   - It runs TypeDoc 0.28 over each module, with `blockTags` plus `@stability`, `inlineTags` plus `@see`, `excludeInternal`, and the leading module comment attached.
   - It writes one TypeDoc JSON file per module, plus a manifest with the revision and SHA-256 hashes.
   - An Astro loader turns the bold-only paragraphs (**When to use**, **Details**, **Gotchas**) into headings, and renders declarations by category, with stability badges and examples, at `/docs/v4/api/<package>/<module>`.

**What Strider reuses:**

| Tool | Status | Use |
|---|---|---|
| `@effect/doctest` | published, MIT | as is |
| TypeDoc | published, Apache-2.0 | as is |
| `effect-jsdocs` | private workspace tool in the MIT Effect repository | vendored unchanged in `packages/tools/docs/src/jsdocs/` from `93abf0208`, with Effect's license; updated only by copying a newer commit's files |
| `@effect/docgen` | published | not used: it writes Markdown for a just-the-docs site, Effect's older output |
| Effect-TS/website | no license | not copied; Strider's generator is its own, written against TypeDoc's documented JSON |

**Strider's pieces:**
- `pnpm jsdocs` runs the vendored checker and writes `.data/jsdocs.json`.
- `pnpm examples` type-checks every example from that model against the package's source.
- `pnpm index` writes `packages/browser/INDEX.md` from the sources, by entry point, module and `@category`.
- `pnpm api-reference` writes `.data/api-reference/`: a manifest (package, version, git revision, TypeDoc version, barrels, and per module its name, export path, source, JSON file with SHA-256, and barrel), one TypeDoc JSON per module, and `jsdocs.json`. Any site, Strider's included, can render it as effect.website renders Effect's.
- `pnpm all` runs them all, and CI runs `pnpm all` on every pull request and every push to `main`.

## Tests

**Effect.**
- "Tstyche tests cover intended compiler behavior such as inference, assignability, rejection, or displayed public types" (`.agents/AGENTS.md`). The repository has 116 `.tst.ts` files using `expect(x).type.toBe<…>()`.
- Runtime tests use `@effect/vitest`'s `it.effect` with `assert`, not `expect`.

**Strider.**
- **Type behavior** is pinned in `packages/browser/typetest/*.tst.ts` (access rules, requirement channels, what crosses by value, launch options) with `toBe` and `toRaiseError`, run by `pnpm test-types`. A loosened rule fails it.
- **Runtime tests** use `@effect/vitest`'s `it.effect` and `assert`.
- **Acceptance scenarios** are plain `.ts`, checked by `tsc`.

## Considered and not adopted

- **Function members as properties** (`readonly kill: (…) => …`) rather than methods. Effect mixes both: `FileSystem` uses properties, while `LLMS.md`'s `Database` example and `Schema` use methods. There is no rule to adopt.
- **`LayerMap` for keyed browsers.** It fits a pool of browsers keyed by launch profile, but nothing needs one: one browser per CLI session, or per layer block in tests, covers today's cases.
- **Actions as module functions** (`Locator.click(button)`). Effect puts operations on handles as members, and a locator acts against its page.
