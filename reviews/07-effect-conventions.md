# Design review — Effect core team conventions

*2026-10-19. Review of commit `6386104` (revision 5.24, including `sketch/`) against the Effect repository at `origin/main` `93abf0208`. Sources: the team's written guidance (`.agents/AGENTS.md`, `.agents/skills/{effect-development,jsdocs,test-development,performance-analysis,package-development}`, `LLMS.md`, `ai-docs/src`) and the shipped modules that resemble ours (`http/HttpClient`, `http/HttpClientError`, `PlatformError`, `FileSystem`, `process/ChildProcessSpawner`, `socket/Socket`, `Queue`, `Schema`, `index.ts`, `typetest/`). This commit records the review only.*

The goal: effect-browser should read as if the Effect core team wrote it. Review 6 adopted Effect's modules; this review adopts Effect's *conventions*, the rules its own APIs follow. Each candidate below states the rule, the evidence, what would change in our design, and a recommendation. Several reverse earlier decisions; those are marked **Reverses**.

## Already aligned

These need no change, and are listed so the review is complete:

- **Services** are `Context.Service` classes keyed `"package/path/Name"` (`effect-browser/Browser`, `effect-browser/cli/CurrentSession`), as in `ai-docs/src/01_effect/03_services/01_service.ts`.
- **Configuration with defaults** is a `Context.Reference` (`Deadline.DefaultBudget`, `Diagnostics.Preset`), as in `10_reference.ts`.
- **Errors carry tagged reasons** recovered with `Effect.catchReason`, as in `04_errors/20_reason-errors.ts`.
- **Cross-cutting settings are `with*` dual combinators** (`Deadline.within`, `Diagnostics.withPreset`), like `Effect.withSpan` and `Logger.withMinimumLogLevel`.
- **Secrets come from `Config.Redacted`**; config-dependent layers fit `Layer.unwrap` (`20_layer-unwrap.ts`).
- **Dates are `DateTime`**, as `LLMS.md` asks ("use the `DateTime` module instead of `Date`"); `Serialized<A>` keeps `Date` only because that is what a page returns.
- **Fluent methods on central values are allowed.** `Schema` keeps `annotate`, `check` and `mapFields` as methods (`Schema.ts:202–205`, `3531`) while most transformations are module functions. Locator chaining (`filter`, `nth`, `first`) is the same kind of refinement, so it stays.

## Candidates

### 1. Modules are namespaces

**Rule.** The package entry exports every module as a namespace (`export * as FileSystem from "./FileSystem.ts"`, 142 times in `packages/effect/src/index.ts`). Inside a module, names are short, because the namespace supplies the context: `Queue.Dequeue`, `Cookies.Cookie`, `HttpClient.With`, `Effect.Effect`.

**Evidence.** `index.ts`; every module's own exports.

**What changes.**
- `sketch/src/index.ts` exports `* as Page`, `* as Locator`, `* as UserContext`, `* as Download`, and so on, instead of `export *`.
- Event modules become real modules (`Download.ts` exporting `interface Download` plus `next`, `stream`, `history`), replacing the merged type-and-const trick.
- Type positions read `Page.Page`, `Locator.Locator`, `Download.Download`, like `Deferred.Deferred`.
- Long disambiguated names shrink inside their module: `UserContextOptions` → `UserContext.Options`, `ReadonlyOriginStorage` → `OriginStorage.Readonly`, `CookieInput` → `CookieJar.Input`, `NavigationFilter` → `PageNavigation.Filter`, `ClickOptions` → `Locator.ClickOptions`.
- References get descriptive names in their module, as `Headers.CurrentRedactedNames` does: `Deadline.Current` → `Deadline.CurrentDeadline`, `Diagnostics.Preset` → `Diagnostics.CurrentPreset`.

**Recommendation.** Adopt. It is the most visible convention, and the event modules already behave like Effect modules.

### 2. Settings are a trailing `options?`; `With` means a function or a provided value

**Rule.** Effect members take optional settings as a trailing `options?: … | undefined` parameter: `handle.kill(options?)` (`ChildProcessSpawner.ts:109`), `fs.makeTempDirectory(options?)`, `client.get(url, options?)`. A member with nothing to configure is a value (`handle.exitCode`, `socket.writer`). The `With` suffix means "with a custom function or a provided value": `zipWith(that, f)`, `sortWith(f)`, `contextWith(f)`, `scopedWith(f)`, `runPromiseWith(services)` (`Effect.ts`, `Array.ts`, `Stream.ts`). Effect never uses `xWith(options)`.

**What changes.**
- Every `x` / `xWith(options)` pair becomes one member with a trailing optional `options`:
  - on locators: `click`, `dblclick` and `hover`;
  - on pages: `reload`, `back`, `forward`, `snapshot`, `screenshot`, `pdf` and `close`;
  - on browsers: `newContext` and `newPage`;
  - elsewhere: `Trace.record`, and the backends' `launch`.
- Call sites gain parentheses: `yield* button.click()`.
- Members with nothing to configure stay values: `title`, `count`, `readText`, `activate`.
- `evaluateWith({ world: "main" }, fn, …args)` takes a function, so it fits Effect's `With` sense. It can't take a trailing options object because of its rest arguments. Proposed: `evaluate(fn, …args)` for the isolated world and `evaluateInMainWorld(fn, …args)` for the main world. A user gesture is a dual setting, `Page.withUserGesture`.
- The `*With` row leaves the naming grammar, and principle 12 is reworded: "a member with nothing to configure is a value; settings are a trailing `options` parameter".

**Reverses** the 5.2 convention "a member whose parameters are all optional is the default value plus `xWith(options)`". The underlying rule (if it doesn't have to be a function, it isn't one) still holds. What changes is what counts as having to be a function: accepting settings now does.

**Recommendation.** Adopt. `clickWith` reads wrong to an Effect user, who expects `With` to take a function.

### 3. Layer constructors are named `layer…`

**Rule.** Layer exports are named `layer` (167 in the repo), `layerConfig` (28), or `layer` plus a descriptor (`layerWebSocket`, `layerMemory`, `layerTest`, `layerNoop`). Static layers sit on the service class (`Database.layer`, `MessageStore.layerInMemory`, `Mailer.layerNoDeps`).

**What changes.**
- Backends:
  - `Chromium.launch` and `launchWith(options)` become `Chromium.layer(options?)`;
  - `launchConfig` becomes `layerConfig`;
  - `connect(endpoint)` becomes `layerConnect(endpoint, options?)`;
  - `WebKit.attach` becomes `WebKit.layerAttach`;
  - `Bidi.connect` becomes `Bidi.layerConnect`.
- The fake browser, until now "internal first, a narrow `effect-browser/testing` subpath later", becomes `Browser.layerTest(script)`. This matches `Stdio.layerTest(impl)` and `GraphQLClient.layerTest(handlers)`.
- `VitestBrowser.layer` is already named this way.

**Recommendation.** Adopt.

### 4. Services offer module-level accessors

**Rule.** A service module exports accessors that use the service from context: `HttpClient.get(url, options?)` is `Effect<HttpClientResponse, HttpClientError, HttpClient>` (`HttpClient.ts:195`). Callers who already hold the service use its members.

**What changes.**
- `Browser.newPage(options?)` and `Browser.newContext(options?)` become accessors: `Effect<Page, PageError, Browser | Scope>`.
- `BrowserTest.page` and `pageWith` go away, because the accessor is the same thing (principle 22). `effect-browser/test` keeps `TestRun` and the Vitest adapter.

**Reverses** the 5.18 and 5.21 `BrowserTest.page` helper.

**Recommendation.** Adopt.

### 5. Data that crosses a boundary is a Schema

**Rule.** "All validation and domain modeling in Effect is done with `Schema`. **AVOID using predicates or manual parsing**" (`LLMS.md`). Shipped modules define domain values as Schema classes (`ai/Response.ts`, `ai/McpSchema.ts`). Live handles stay interfaces.

**What changes.**
- Values become Schemas:
  - network values: `NetworkRequest`, `NetworkResponse`, `ConnectionFrame`;
  - page and download events: `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `AutoResolution`;
  - state values: `PageStatus`, `FrameTree`, `DownloadStatus`;
  - cookies: `BrowserCookie` (its value as `Schema.Redacted`) and the cookie input;
  - snapshots: the snapshot node tree;
  - history: the `EventHistory` envelope.
- `Snapshot` splits into its data, which is a Schema, and the page-bound `ref(id)`, which is not serializable.
- `StorageState.import` becomes the codec's decode, and `exportStorageState` encodes with the same Schema.
- What you get for free: the CLI daemon's RPC, MCP tool results, `--json` output, `history` export and trace attachments all encode these values without hand-written serializers. Brands already use `Schema.brand`.

**Recommendation.** Adopt. The CLI and agent surfaces need these values serialized anyway.

### 6. One error per module, with yieldable reason classes

**Rule.** Each module or family has one error: `HttpClientError` for `HttpClient`, `PlatformError` for every platform module (`FileSystem`, `ChildProcess`, …), `AiError` for AI. It carries a `reason` union of tagged, yieldable classes (`TransportError`, `StatusCodeError`; `BadArgument`, `SystemError`). The wrapper derives `message` from its reason (`override get message()`), lifts shared fields into getters (`request`, `response`), propagates `cause`, and has an `isHttpClientError` guard and module-level constructors (`PlatformError.systemError(...)`). Provider-specific detail is added by module augmentation of a `metadata` interface (`typetest/AiError.tst.ts`).

**What changes.**
- About 25 verb-family errors become module errors with reasons:
  - `ActionError` and `ReadError` become `Locator.LocatorError`;
  - `NavigationError`, `EvaluationError`, `CaptureError` and `PageError` become `Page.PageError`, with reasons `Navigation…`, `Evaluation…`, `Capture…` and `Initialization…`;
  - `ObserveError` becomes each event module's error;
  - `TraceError` and `HarError` become recording errors;
  - `ClockError` becomes `PageClock.PageClockError`, so it matches its module.
- Precise recovery moves from `catchTag("NavigationError")` to `catchReason("PageError", "NavigationFailed")`, which is what the reason pattern is for.
- `TargetGone` and `Timeout` stay separate, because they cross every module, as `Cause.TimeoutError` does in Effect.
- Reasons become `Schema.TaggedError` classes. Each failure's `message` is the reason's message plus its hint. `BackendFailure` gets per-backend `metadata` by augmentation (`cdp`, `bidi`, `webkit`), so CDP error codes are typed without L2 knowing them.

**Reverses** principle 10's verb-family error list (5.0) in favor of module errors. The small-channel goal stands.

**Recommendation.** Adopt.

### 7. Trace like `HttpClient` does

**Rule.**
- Library internals use `Effect.fnUntraced`: 462 uses in `packages/effect/src`, against 42 named `Effect.fn`s, most of them in documentation examples. `LLMS.md`: prefer `fnUntraced` "particularly in library implementations and hot paths".
- A span marks a meaningful boundary. `HttpClient` opens one per request with `Effect.useSpan(…, { kind: "client" })` and OpenTelemetry semantic-convention attributes (`http.request.method`, `http.response.status_code`, `error.type`).
- Its knobs are references: `SpanNameGenerator`, `TracerDisabledWhen`, `TracerHeaderFilter`, `Headers.CurrentRedactedNames` (`HttpClient.ts:705–760`).

**What changes.**
- README "Every public operation is an `Effect.fn` span" becomes: one span per user-visible operation, opened by the operation with `useSpan`, with attributes in the same style (`browser.operation`, `browser.page.id`, a redacted `url.full`, `error.type`). Everything beneath it is `fnUntraced`.
- "Protocol commands are debug-level child spans" becomes opt-in, because they are a hot path. A reference such as `Protocol.TraceCommands` enables them.
- `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` references let users rename or suppress spans.
- Trace export reads these attributes.

**Recommendation.** Adopt.

### 8. Optional fields admit `undefined`

**Rule.** Every optional field and parameter is written `?: T | undefined` (`FileSystem.makeTempDirectory`: `readonly directory?: string | undefined`), so callers under `exactOptionalPropertyTypes` can pass `undefined` explicitly.

**What changes.** Every options interface in `sketch/` and API.md. This is mechanical; the sketch's `tsconfig` already enables `exactOptionalPropertyTypes`, so the checker enforces the result.

**Recommendation.** Adopt.

### 9. String type IDs, guards, `Pipeable` and `Inspectable` on every public type

**Rule.**
- Type IDs are strings with a `~` prefix: `TypeId = "~effect/socket/Socket"`.
- Each identified type gets a guard (`isHttpClientError`, `isDeferred`, `isSubscriptionRef`).
- Values and handles implement `Pipeable` and `Inspectable`, with a structured `toJSON` (`HttpClientRequest.ts:56, 104`).

**What changes.**
- Opaque types use `"~effect-browser/…"` TypeIds instead of `unique symbol` declarations: `FileInput`, `RouteDecision`, `DialogDecision`, `Condition`, `AriaPattern` and `ReadonlyDeferred`.
- Guards identify kinds: `Locator.isLocator`, `Page.isObservedPage`, `Download.isDownload`. There is still no guard that narrows access. `isObservedPage` is true for any page, because access is a grant held by a `Scope`, not a fact about the page.
- Every handle is `Pipeable`, so `page.pipe(Expect.toHaveURL(…))` works.
- Every handle's `toJSON` renders through `Redactable`, so logging a page shows a redacted description.

**Recommendation.** Adopt.

### 10. JSDoc contract, categories and doctested examples

**Rule.**
- **Shape.** Every public declaration has a one-paragraph description, then optional **When to use**, **Details** and **Gotchas**, then `**Example** (Title)` blocks fenced as `ts import.meta.vitest` and run by doctest.
- **Tags,** in this order: `@see`, `@stability`, `@category`, `@since`.
- **Categories** come from a fixed vocabulary: constructors, models, guards, getters, combinators, services, layers, errors, error handling, resource management, references, and so on.
- **Stability.** Any API that exposes a third-party or unstable dependency's types is `@stability unstable` (`.agents/skills/jsdocs/*`).

**What changes.**
- The sketch's comments are restructured to this contract.
- `INDEX.md` can group by `@category`.
- The acceptance scenarios become `**Example**` blocks where they illustrate one API.
- APIs exposing `effect/http` types (`Route`, `NetworkRequest.toHttpClientRequest`, `CapturedResponse`) are `@stability unstable`, because those modules are.
- A `jsdocs --check` equivalent runs in CI.

**Recommendation.** Adopt for the sketch now. Doctests start with the implementation.

### 11. Type behavior is tested with Tstyche

**Rule.** "Tstyche tests cover intended compiler behavior such as inference, assignability, rejection, or displayed public types" (`.agents/AGENTS.md`). The repo has 116 `.tst.ts` files using `expect(x).type.toBe<…>()`. Runtime tests use `@effect/vitest`'s `it.effect` with `assert`, not `expect`.

**What changes.**
- The sketch's `scenarios/_check.ts` (`expectType<Equals<…>>`) and the `@ts-expect-error` rules in `access.ts` move to `sketch/typetest/*.tst.ts`, using Tstyche's `toBe` and `toRaiseError`.
- Ordinary scenario files stay plain `.ts`, checked by `tsc`.
- The package gains a `test-types` script.

**Recommendation.** Adopt.

### 12. Reusable functions are `Effect.fn`, never wrappers around `Effect.gen`

**Rule.** "Avoid functions that only wrap and return `Effect.gen`." Use `Effect.fn("name")`, with the name matching the function, and pass extra behavior as arguments rather than `.pipe` (`LLMS.md`).

**What changes.** Every scenario and API.md call site written as `(page: Page) => Effect.gen(…)` becomes `Effect.fn("namedOutcome")(function*(page: Page.Page) { … })`. It also signals to users the shape their own helpers should take.

**Recommendation.** Adopt.

## Considered and not adopted

- **Function members as properties** (`readonly kill: (…) => …`) rather than methods: Effect mixes both. `FileSystem` uses properties, while `LLMS.md`'s `Database` example and `Schema` use methods. No rule to adopt.
- **`LayerMap` for keyed browsers:** it fits a pool of browsers keyed by launch profile, but nothing in the design needs one yet. One browser per session (CLI) or per layer block (tests) covers today's cases.
- **Actions as module functions** (`Locator.click(button)`): Effect puts operations on handles as members (`client.get`, `handle.kill`), and a locator acts against its page, so `button.click()` stays.

## Summary

| # | Convention | Reverses | Size of change |
|---|---|---|---|
| 1 | Modules are namespaces; short names inside | — | large: every type position |
| 2 | Trailing `options?`; `With` means a function | 5.2's `xWith(options)` | large: every configurable member |
| 3 | `layer…` names; `Browser.layerTest` | — | small |
| 4 | Module-level accessors (`Browser.newPage`) | `BrowserTest.page` | small |
| 5 | Boundary data is Schema | — | medium |
| 6 | One error per module, reasons as classes | principle 10's verb families | medium |
| 7 | Spans at operation boundaries; internals untraced | "every operation is an `Effect.fn` span" | small |
| 8 | `?: T \| undefined` | — | mechanical |
| 9 | String TypeIds, guards, `Pipeable`, `Inspectable` | — | small |
| 10 | JSDoc contract and doctests | — | medium, ongoing |
| 11 | Tstyche for type behavior | — | small |
| 12 | `Effect.fn` for reusable functions | — | small |

## Decision

*2026-10-19.* All twelve are adopted and applied in revision 5.25. Applying them meant checking `origin/main` again, which refined four of them and added a thirteenth: the API reference is generated, the way effect.website generates Effect's.

### Refinements

- **1, access levels keep their full names.** A bare `Page.Readonly` or `OriginStorage.Readonly` would shadow TypeScript's `Readonly<T>` inside the module. Effect itself writes `Record.ReadonlyRecord` and `Array.ReadonlyArray`. So the access levels are `Page.ObservedPage`, `Page.ReadonlyPage`, `Page.Page`, `Locator.ReadonlyLocator` and `OriginStorage.ReadonlyOriginStorage`. Short names are for the supporting types: `UserContext.Options`, `CookieJar.Input`, `PageNavigation.Filter`.
- **1, brands are Schemas in the module that owns them.** `cluster/EntityId.ts` is the model. It is a Schema value and a type with the same name, branded `"~effect/cluster/EntityId"`. Ids move to their owners (`Download.Id`, `UserContext.Id`, `Snapshot.RefId`, `InitScript.Id`). Values with no single owner get small modules: `Url` (`Url.Url`, `Url.Pattern`, `Url.Origin`, `Url.Site`), `FilePath` (`Local`, `Remote`), `Pixels` (`Css`, `Device`) and `AriaRole`, which is shaped like `effect/http`'s `HttpMethod`. `effect/http` also exports a `Url` module. A file that needs both aliases one; Effect's own AI provider packages each export a `Generated` module, so a shared name is precedented.
- **6, reasons shared across modules live in one module.** `Socket.SocketError` is the model: reasons are `Schema.Error` classes with `_tag: Schema.tag(…)`, and the wrapper is a `Schema.TaggedError` with a string TypeId, a `message` derived from the reason, and `cause` lifted from it. Reasons that belong to one module stay in it (`Locator.StrictViolation`, `Page.NavigationFailed`). Reasons that several modules share (`InvalidInput`, `NotPermitted`, `Unsupported`, `BackendFailure`, `EvaluationThrown`, `NotSerializable`) live in a `Reason` module. `TargetGone` lives in a `Target` module, with the ids and close reasons that describe targets. `Timeout` lives in `Deadline`.
- **10, every module and export states its stability.** Effect has required an explicit `@stability` on every module and importable export since #8770 (2026-10-07), not only where a dependency's types show. Until 1.0 the default is `@stability unstable`: breaking changes may come in minor releases, which 0.x semver allows. `experimental` marks APIs that rest on an upstream proposal or an in-flight module: the `ReadonlyDeferred` shim, Zip-based exports, `Browser.layerTest`. `stable` waits for 1.0.
- **12, `Effect.fn` versus `fnUntraced` follows tracing.** Since #9506 and #9512 (2026-10-19), Effect sets `@effect/language-service` to `effectFnOpportunity: "error"` with `effectFn: ["untraced"]` for both its sources and its tests. A function that returns `Effect.gen` is a compile error, and the suggested fix is `fnUntraced`. Library code and tests therefore use `Effect.fnUntraced`, which matches 7. Examples written for users use `Effect.fn("name")` where a span helps, as `LLMS.md` advises. The sketch's tsconfig sets the same plugin options.

### 13. The API reference is generated

**Rule.** Effect's API reference on effect.website is generated from the sources on every release. Nothing in it is written by hand. Five pieces make that work:

1. **One module per file, listed in the export map.** `package.json` maps `"."` to `src/index.ts` and `"./*"` to `src/*.ts`. A subpath such as `"./http"` points to its own barrel.
2. **A generated barrel.** `effect-utils codegen` writes `index.ts` as `export * as X` lines. Each line carries `@stability` and `@since`, and copies the module's own description.
3. **A checked JSDoc contract.** `effect-jsdocs --check` runs in CI. It enforces the description sections, the tag order, `@category`, `@since` and `@stability`, and that inline `{@link}` targets resolve. It also writes a model of the whole API to `.data/jsdocs.json`: every declaration with its parsed sections, examples, tags, resolved `@see` links and import guidance.
4. **Examples that run.** `@effect/doctest` is a Vitest plugin. It runs every fence marked ```` ```ts import.meta.vitest ```` from JSDoc, Markdown and MDX, and checks `// =>` assertions with `Equal`.
5. **The website.** When a release is promoted, `npm-promote` sends a `repository_dispatch` event (`publish-api-reference`, with the revision). Effect-TS/website checks out that revision. Its `packages/api-reference/src/Generate.ts` finds each public module from the package export map and skips barrels and `internal/`. It runs TypeDoc 0.28 over each module with `blockTags` plus `@stability`, `inlineTags` plus `@see`, `excludeInternal`, and the leading module comment attached. It writes one TypeDoc JSON file per module, plus a manifest with the revision and SHA-256 hashes. An Astro loader turns the bold-only paragraphs (**When to use**, **Details**, **Gotchas**) into headings and renders declarations by category, with stability badges and examples, at `/docs/v4/api/<package>/<module>`.

**What we can reuse.**

| Tool | Status | Use |
|---|---|---|
| `@effect/doctest` | published, MIT | as is |
| TypeDoc | published, Apache-2.0 | as is |
| `@effect/jsdocs` | private workspace tool in the MIT Effect repo | run from a pinned Effect checkout, or vendor it with the license notice |
| `@effect/docgen` | published | not needed: it writes Markdown for a just-the-docs GitHub Pages site, the older output |
| Effect-TS/website | no license | can't be copied; we write our own generator against TypeDoc's JSON, which is the documented interface |

**What changes.**
- The sketch takes the real package's shape: an export map, barrels in Effect's format, and a JSDoc contract that `effect-jsdocs --check` passes. The checker runs unchanged from the local Effect clone; it only reads the clone.
- Examples are fenced for doctest. Until there is an implementation to run them, `npm run examples` type-checks them against the sketch.
- `npm run api-reference` writes the dataset in the website's shape: one TypeDoc JSON per module, plus a manifest. Any site, ours included, can render it as effect.website does.
- `INDEX.md` is generated from the jsdocs model, grouped by module and `@category`, instead of from a second parser.

**Recommendation.** Adopt.
