# API: the ergonomic layer (L2)

*Revision 5.25, 2026-10-19. Every member this document declares is built, on Chromium, Firefox and stock WebKit, with the agent toolkit and the `strider` command (CLI.md, Built); what a backend can't do fails with `Unsupported`, naming its capability. Not built: inferred click listeners in snapshots (Agents), and backend layers that carry their capabilities in their types, whose mechanism is open (Modules and backends). A member declared before it is built fails as the defect `NotBuilt`, and [PROTOCOL.md](PROTOCOL.md) (Status) lists what is. The full signatures live in the package's source, [packages/browser/src/](packages/browser/src/), declarations where nothing is built yet (the sketch), with each declaration's own contract in its JSDoc. It type-checks against Effect 4.0.6 and passes Effect's own JSDoc checker, and the API reference is generated from it ([packages/browser/INDEX.md](packages/browser/INDEX.md) lists every declaration and member). This document keeps the design: the contracts that span declarations, and the excerpts that explain them. Where an excerpt and the sketch differ, the sketch is right. Every behavior here must be expressible in [CONCEPTS.md](CONCEPTS.md).*

## Purpose

This layer is what users write. It turns the native model into a small vocabulary of browsers, contexts, pages, locators, actions, expectations and events, with the following properties:

- No protocol knowledge.
- `Scope` only where something with a lifecycle is acquired.
- One deadline per call.
- Errors that say what happened.

Excerpts name each operation's own module error (`PageError`, `LocatorError`). Like every operation, they also include `TargetGone | Timeout`, which the excerpts spell out only where it matters.

## Conventions

The README's principles, as they apply to this layer, written the way Effect's own modules are. The reasons live there; these are the rules.

**Modules**
- **Modules are namespaces.** The package exports each module as one, as Effect does: `import { Browser, Download, Page } from "@usestrider/browser"`. Types are written `Page.Page`, `Download.Download` and `Locator.Locator`, like `Deferred.Deferred`. Inside a module, names are short, because the namespace supplies the context: `UserContext.Options`, `CookieJar.Input`, `PageNavigation.Filter`, `Download.Id`. Access levels keep their full names (`Page.ReadonlyPage`, `OriginStorage.ReadonlyOriginStorage`), as Effect writes `Record.ReadonlyRecord`; a bare `Readonly` would shadow TypeScript's own.
- **Backends and surfaces are subpaths,** each with its own barrel: `@usestrider/browser/chromium`, `/firefox`, `/webkit`, `/bidi`, `/ai`, `/test` and `/cli`. The Vitest adapter is a package of its own, `@usestrider/vitest`, so `@usestrider/browser` depends on nothing but Effect.
- **Brands are Schemas in the module that owns them,** a Schema value and a type with one name, as Effect's `EntityId` is: `Download.Id`, `UserContext.Id`, `Snapshot.RefId`, `Keyboard.Key`. Values with no single owner have small modules of their own: `Url` (`Url.Url`, `Url.Pattern`, `Url.Origin`, `Url.Site`), `FilePath` (`Local`, `Remote`), `Pixels` (`Css`, `Device`), `AriaRole` and `MonotonicInstant`. URLs are stored as strings, as Effect's own `HttpClientRequest.url` is, because a `URL` object can be changed in place and compares by reference; `effect/http`'s `Url` module is how one is changed (`Url.fromString(url)`, its setters, then `href`). A file that imports both `Url` modules aliases one.

**Members**
- **If it doesn't have to be a function, it isn't one** (principle 12).
  - Nothing to configure: a value. That is an `Effect` for operations (`page.title`, `locator.count`, `tab.inspect`, `context.newPage`) or a plain property for pure derivations (`locator.first`).
  - Settings: a trailing `options?: … | undefined`, as Effect's `handle.kill(options?)` and `client.get(url, options?)` take them. Every action has checks you can adjust, so actions are calls: `button.click()`, `button.click({ button: "right" })`, `page.goto(url, { waitUntil: "load" })`. Reads stay values.
- **`With` means "with a function",** as in Effect's `zipWith(that, f)` and `scopedWith(f)`: `Route.continueWith(change)`. It never means "with options".
- **Handles get members; cross-cutting settings are dual combinators** that work data-first and in `pipe`, each backed by a `Context.Reference`: `Deadline.within`, `Deadline.withDefaultBudget`, `Diagnostics.withPreset`, `Expect.withCheckInterval` and `Page.withUserGesture`, as in `button.click().pipe(Deadline.within("5 seconds"))`. Option bags hold only what is specific to one operation.
- **Services have module-level accessors,** as `HttpClient.get` uses the `HttpClient` in context: `Browser.newPage(options?)` and `Browser.newContext(options?)` use the `Browser` in context. Code that already holds a `Browser` uses its members, which do the same.
- **Layers are named `layer…`:** `Chromium.layer(options)`, `Chromium.layerConfig(config)`, `Chromium.layerConnect(endpoint, options?)`, `WebKit.layerAttach(endpoint)`, `Bidi.layerConnect(endpoint)` and `Browser.layerTest(timeline)`.
- **Events are modules, not members.** `Download.next(page)` subscribes, and the action that causes the download comes on the next line (State and events).

**Lifetimes**
- **Anything with a lifecycle requires `Scope`:** contexts, pages, access upgrades, handles, capability handles and every declaration (routes, dialog and file-chooser handlers, init scripts, overrides, grants, clocks). Values with no remote lifetime (locators, snapshots, captured bodies, storage state) need none. Seeing an event acquires nothing: a popup belongs to the scope that acquired its opener, and a download's file to its context.
- **Every scoped acquisition returns a handle,** never `void`, with an idempotent `remove` and, where useful, state such as `hits: Watchable<number>`. Releasing early (`page.close()`, `remove`) makes the finalizer a no-op.
- **No public fibers, and no writable `Deferred`s or `Ref`s.** The library never forks for you; fork your own consumers with `Effect.forkScoped`. A latched result is handed out as an `Effect` that reads it.
- **No platform services at call sites.** They appear only in the launch and connect layers, so `Scope` (and `Browser`, for the accessors) is all an ordinary call site requires.

**Values and types**
- **Immutable by default.** Handles, locators, snapshots, events and errors are immutable. Anything that can change is read through an `Effect` or a `Watchable` (`page.url`, `page.title`, `browser.capabilities`, page lists, held access), so it can't go stale in a variable. A plain field on a live handle must be fixed for the handle's lifetime and say why in its JSDoc; ids, `closed` and sub-handles bound to their parent (`keyboard`, `mouse`, `clock`, `cookies`) are exempt.
- **Data that crosses a boundary is a Schema,** as `LLMS.md` asks ("all validation and domain modeling in Effect is done with `Schema`"). Events that are data (`NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `AutoResolution`, `NetworkConnection.Frame`), states (`Page.Status`, `Page.FrameTree`, `Download.Status`), cookies, snapshot trees, storage state, diagnostics and every error are Schemas. The CLI's RPC, MCP results, `--json` output, history exports and trace attachments encode them without hand-written serializers. Live handles (pages, locators, downloads) stay interfaces.
- **Brand liberally** (principle 14). Outputs are always branded. Inputs require the brand only where two meanings could be confused (`FileInput.local` / `FileInput.remote`, CSS vs device pixels); elsewhere a plain string is parsed at the boundary and fails at once if it is bad (`goto(url)`, `route(pattern)`). Tokens (ids, refs, generations, registration handles) are accepted only in branded form, and are checked against their origin when used.
- **Unions of valid models; `Option` for what's truly optional** (principle 15). Optional inputs are written `?: T | undefined`, as Effect writes them, so callers under `exactOptionalPropertyTypes` can pass `undefined`. Mutually exclusive inputs are unions: a cookie's scope is a URL *or* a domain and path.
- **Access is typed.** `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` ⊂ `Array`; contexts have two levels. `.inspect` and `.control` are the only way up, because access is a grant held by a `Scope`. A helper that only reads takes a `Page.ReadonlyPage`, and calling an action on a page you may only inspect is a compile error. A subtype never changes what an inherited member does.
- **Every handle is identified, pipeable and inspectable.** Each public type has a string TypeId (`"~@usestrider/browser/Page"`), and each module a kind guard (`Page.isPage`, `Locator.isLocator`, `Download.isDownload`). Guards identify kinds, never access: `Page.isPage` narrows to `ObservedPage`. Handles are `Pipeable`, so `page.pipe(Expect.toHaveURL(…))` works, and `Inspectable`, so logging one shows a description rendered under the diagnostics preset.
- **Locators are values,** resolved again on every attempt. The one exception is a ref (`snapshot.ref(id)`), which is pinned to one node and fails with `StaleRef` rather than rebinding.

**Errors**
- **One error per module, with its detail in a `reason`** (principle 10), as `HttpClientError`, `SocketError` and `AiError` are built. An operation fails with its module's error (`Locator.LocatorError`, `Page.PageError`, `Download.DownloadError`, `Declaration.DeclarationError`), and recovery matches the reason: `Effect.catchReason("LocatorError", "StrictViolation", …)`.
- **Reasons are classes.** Each is a `Schema.Error` with a `_tag`, its own fields, and a `hint`. A reason that belongs to one module is declared there (`Locator.StrictViolation`, `PageNavigation.NavigationFailed`); reasons several modules share live in `Reason` (`InvalidInput`, `NotPermitted`, `Unsupported`, `BackendFailure`, `EvaluationThrown`, `NotSerializable`). The module error derives its `message` from the reason, lifts the reason's `cause`, carries the `Diagnostics` envelope, and has a guard (`Locator.isLocatorError`).
- **Two errors cross every module:** `Target.TargetGone` and `Deadline.Timeout`, as Effect keeps `Cause.TimeoutError` outside any one module. Event streams add `Subscription.EventOverflow`.
- **A backend's detail is the failure's `cause`.** `Reason.BackendFailure` carries the browser's own error (`Protocol.ProtocolError`) as `cause`, with its code and message, so this layer never knows a backend's codes.
- **Every reason carries a hint,** shown in the rendered message:
  - `NotPermitted`: "call `.control` on this page"
  - `StaleRef`: "refs end with their document; use a locator or take a new snapshot"
  - `Unsupported`: "supported on: chromium (CDP)"
  - `StrictViolation`: "2 matches; try `getByRole('button', { name: 'Save' })`"
  - `Timeout` awaiting a `next`: "a matching download started 12 ms before `Download.next` subscribed; call it before the action that causes it"

**Names**
- **Spec names first, then Effect's types.** `UserContext` is the spec's and BiDi's term, and it avoids Effect's `Context`. Where Effect has the type, we use it: `Headers`, `HttpMethod`, `HttpServerResponse`, `HttpClientRequest` and `HttpIncomingMessage` from `effect/http`, `DateTime.DateTime.Input`, `Duration.Input` and `Config`. A module name gets a prefix only where a bare one would clash with the DOM (`FileInput`, `BrowserWorker`, `ConsoleMessage`) or with Effect (`PageClock`). Long, explicit names are fine.
- **Names encode behavior** (principle 18):

  | Form | Meaning | Examples |
  |---|---|---|
  | verb, called | acts on the page, once | `click()`, `fill(value)`, `goto(url)`, `route(pattern, handler)` |
  | `read*`, `is*`, nouns | one-shot read; no waiting, no retry | `readText`, `isVisible`, `title`, `count`, `ConsoleMessage.history` |
  | `Watchable` members | state: read now, watch, `waitFor` | `status`, `url`, `download.status` |
  | `Expect.to*` | retries until the deadline | `Expect.toHaveText` |
  | `next`, `stream` | subscribe to an event type from now on | `Download.next(page)`, `NetworkRequest.stream(page)` |
  | `handle` | a scoped handler that decides an obligation | `Dialog.handle(page, Dialog.acceptAll)` |
  | `new*` | creates an owned resource | `Browser.newPage()`, `context.newPage`, `Browser.newContext()` |
  | `*With(f)` | the same operation, with a function | `Route.continueWith(change)` |
  | `with*`, `within` (dual) | a cross-cutting setting over any effect | `Deadline.within`, `Diagnostics.withPreset`, `Page.withUserGesture` |
  | `layer*` | a layer that provides a service | `Chromium.layer({ executablePath })`, `Browser.layerTest(timeline)` |
  | `export*`, `Json` | crosses a persistence boundary; carries secrets | `exportStorageState`, `StorageState.Json`, `exportTrace` |

**Behavior**
- **Signatures are checked, not described.** `packages/browser` declares the whole API in the package's real shape and checks it four ways: `tsc --strict` with `exactOptionalPropertyTypes`; Effect's language service, with `effectFnOpportunity` an error as in Effect's own repository; Tstyche type tests, which pin each access rule and requirement channel (an ordinary call site sees only `Browser` and `Scope`); and every JSDoc example, type-checked against the declarations.
- **The reference is generated.** Every declaration carries Effect's JSDoc contract: a description, optional **When to use**, **Details** and **Gotchas**, titled examples, and `@see`, `@stability`, `@category` and `@since`. `effect-jsdocs --check`, vendored unchanged from Effect (`pnpm jsdocs`), enforces it. `pnpm api-reference` writes the same dataset effect.website renders Effect's reference from: TypeDoc JSON per module, with a manifest. Until 1.0, everything is `@stability unstable` except what rests on an upstream proposal or an in-flight module, which is `experimental`.
- **Explicit over implicit** (rule 23). Nothing hidden changes behavior or adds waiting: no magic delays, grace periods or heuristic windows. Every default is stated where its option is declared (`@default` in the JSDoc) and recorded in the operation's span, and no helper changes a default on your behalf. Actionability waiting is each action's documented contract: named checks, adjustable per call, reported in errors.
- **Every effect ends.** Waits run under a deadline, open-ended things are `Stream`s, and lifetime signals (`closed`) are the only exception.
- **One way to do each thing** (principle 22). A convenience exists only at the dominant call site, documented as its expansion: `page.url` is `page.status.map(…)`, `download.finished` is `status.waitFor(…)`, and `Browser.newPage()` is `newContext()` followed by `newPage`. So the accessibility tree alone is `snapshot({ sources: "aria" })`, not a second member, and one element's subtree is `locator.snapshot()`, not a `root` option.
- **One span per operation.** Each user-visible operation opens one span, as `HttpClient` opens one per request, with attributes in OpenTelemetry's style (`browser.operation`, `browser.page.id`, a redacted `url.full`, `error.type`). Everything beneath it is `Effect.fnUntraced`. Protocol commands get child spans only when `Browser.TraceProtocolCommands` is on, because they are a hot path. `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` rename or suppress spans.
- **Reusable functions are `Effect.fn`.** Call sites write `Effect.fn("name")(function*(page: Page.Page) { … })`, never a function that returns `Effect.gen`; the language service rejects the latter. The library's own internals use `Effect.fnUntraced`.

## Top data models

```ts
// Page
interface ObservedPage extends Pipeable, Equal.Equal, Inspectable {   // state and events only
  readonly id: Target.NavigableId
  readonly status: Watchable.Watchable<Status>          // one consistent snapshot; ends with Closed{reason}
  readonly url: Watchable.Watchable<Url.Url>            // status.map(…): derived from the same source
  readonly frames: Watchable.Watchable<FrameTree>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>   // dedicated workers; a Page narrows to BrowserWorker
  readonly closed: Effect<Target.CloseReason>           // lifetime signal: waits as long as the page lives
  readonly inspect: Effect<ReadonlyPage, PageError, Scope>   // installs the utility world; page stays open
  readonly control: Effect<Page, PageError, Scope>           // access lasts for the scope; page stays open
}
interface ReadonlyPage extends ObservedPage { /* locators, reads, snapshots, screenshots — see Pages */ }
interface Page extends ReadonlyPage { /* input, navigation, main-world evaluation, declarations */ }

const Status = Schema.Union([
  Schema.TaggedStruct("Open", { url: Url.Url, document: DocumentStatus, prompt: Schema.Option(Prompt) }),
  Schema.TaggedStruct("Closed", { reason: Target.CloseReason })
])
const DocumentStatus = Schema.Struct({
  id: Target.DocumentId,
  readiness: Schema.Literals(["loading", "interactive", "complete"]),
  lifecycle: Schema.Literals(["active", "suspended"])
})

// PageNavigation: the success value of goto, reload, back and forward; also an event module
// url: where the page went, after redirects, or the URL a same-document navigation set
// frame (in every variant, left out below): the navigable it happened in, the page's own id or a frame's
const PageNavigation = Schema.Union([
  Schema.TaggedStruct("Committed", {                    // 404/500 is still a commit; response is None for about:blank, data:, …
    id: Id, url: Url.Url, document: Target.DocumentId, response: Schema.Option(NetworkResponse.NetworkResponse) }),
  Schema.TaggedStruct("SameDocument", {
    id: Id, url: Url.Url, document: Target.DocumentId, via: Schema.Literals(["fragment", "historyApi", "intercepted"]) }),
  Schema.TaggedStruct("Restored", { id: Id, url: Url.Url, document: Target.DocumentId }),    // back/forward cache
  Schema.TaggedStruct("Activated", { id: Id, url: Url.Url, document: Target.DocumentId }),   // prerender
  Schema.TaggedStruct("BecameDownload", { id: Id, url: Url.Url }),                          // only from goto with accept
  Schema.TaggedStruct("NoContent", { id: Id, url: Url.Url, response: Schema.Option(NetworkResponse.NetworkResponse) })   // likewise
])

// NetworkResponse: immutable; one redirect hop. NetworkRequest is its request-side twin
class NetworkResponse extends Schema.Class<NetworkResponse>("@usestrider/browser/NetworkResponse")({
  hop: NetworkRequest.HopId,
  url: Url.Url,
  status: StatusCode,                                   // a branded Int from 100 to 599, so it goes wherever Effect HTTP expects a status
  statusText: Schema.String,                            // the reason phrase; empty for HTTP/2 and later
  httpVersion: Schema.Option(Schema.String),            // http/1.1, h2…; None on WebKit, which says it only at the end
  headers: Schema.Headers,                              // Effect's Headers; classified values are redacted
  servedBy: ServedBy,                                   // network, cache, serviceWorker, cacheOrServiceWorker, route
  at: MonotonicInstant.MonotonicInstant
}) {}
interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage<ResponseError> {   // owned bytes, readable with Effect's decoders
  readonly body: B                                      // what the subscription's body decoder produced
}
declare const BodyLimit: Context.Reference<ByteSize>   // the largest body a subscription collects; 10 MiB unless set with withBodyLimit

// Snapshot: the tree is data; the refs are bound to the page it came from
class Data extends Schema.Class<Data>("@usestrider/browser/Snapshot/Data")({
  document: Target.DocumentId,
  generation: Generation,
  root: Node,
  text: Schema.String                                   // the YAML rendering agents already read, plus evidence tags for inferred nodes
}) {}
interface Snapshot<L extends Locator.ReadonlyLocator = Locator.ReadonlyLocator> extends Data {   // L follows the page's access
  readonly refs: ReadonlyMap<RefId, Node>               // already branded
  ref(id: RefId): L                                     // pinned to one node, never rebound; acting fails with StaleRef once the document or generation moves on
  diff(previous: Snapshot): Effect<Diff, SnapshotError> // explicit; fails if the documents differ
}
interface Node {
  readonly ref: Option<RefId>                           // same node, same ref within a document generation
  readonly role:                                        // where the role came from is always visible
    | { readonly _tag: "Aria"; readonly role: AriaRole.AriaRole }
    | { readonly _tag: "Inferred"; readonly role: "clickable" | "editable" | "focusable"; readonly evidence: NonEmptyReadonlyArray<InteractivityEvidence> }
  readonly name:
    | { readonly _tag: "Accessible"; readonly value: string }
    | { readonly _tag: "Inferred"; readonly value: string; readonly from: "text" | "title" | "placeholder" | "alt" | "nearbyLabel" }
    | { readonly _tag: "None" }
  readonly states: ReadonlySet<"checked" | "expanded" | "selected" | "disabled" | "focused" | "pressed" | "invalid">
  readonly validationMessage: Option<string>
  readonly children: ReadonlyArray<Node>
}
// Native constraint invalidity is read only when willValidate is true. Invalid controls carry invalid
// and validationMessage (rendered as [validationMessage="…"]); other nodes carry None. Reading never
// triggers validation or changes focus. Current invalidity does not prove a submission attempt.
// Diffs include message-only changes as well as invalidity clearing.
// InteractivityEvidence: "clickListener" | "cursorPointer" | "tabindex" | "contentEditable" | "onclickAttribute"
// Diff: added, removed (refs), changed, text
```

`Page.Page`, `Locator.Locator`, `UserContext.UserContext` and the other model handles are `Equal`/`Hash` by identity (CONCEPTS.md §1). A `ReadonlyPage` and a `Page` for the same tab are equal, because identity is the tab and not the access level.

## Modules and backends

One package with subpath exports and a single version, the same model Effect v4 uses. Backends are imports, not option values, so only the protocol code you import is loaded:

```ts
import { Browser, Expect, Page } from "@usestrider/browser"    // API modules: types, services, combinators
import { Chromium } from "@usestrider/browser/chromium"        // CDP backend
import { Firefox } from "@usestrider/browser/firefox"          // BiDi backend
import { WebKit } from "@usestrider/browser/webkit"            // stock WebKit: launched (MiniBrowser), attached (WebKitGTK, WPE)
import { Bidi } from "@usestrider/browser/bidi"                // any BiDi endpoint (Safari Technology Preview, remote grids)
import { TestRun } from "@usestrider/browser/test"             // runner-agnostic test support
import { VitestBrowser } from "@usestrider/vitest"               // the Vitest adapter, a package of its own; peer dependency: vitest 5
import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"   // builds on effect/ai
// the package's bin is the CLI (CLI.md); @usestrider/browser/cli has only what `strider run` provides to segments
import * as Cdp from "@usestrider/browser/cdp"                 // raw generated L0 commands, for power users

// Chromium (and Firefox: the same three, whose layer and layerConfig also need Socket.WebSocketConstructor;
// WebKit: layer, layerConfig, layerAttach; Bidi: layerConnect)
declare const layer: (options: Browser.LaunchOptions) =>   // the executable it names, headless, temporary profile
  Layer<Browser.Browser, Browser.BrowserError, ChildProcessSpawner | FileSystem>
declare const layerConfig: (options: Config.Wrap<Browser.LaunchOptions>) =>   // e.g. the executable path from each machine's environment
  Layer<Browser.Browser, Browser.BrowserError | Config.ConfigError, ChildProcessSpawner | FileSystem>
declare const layerConnect: (endpoint: Url.Url | string, options?: Browser.ConnectOptions | undefined) =>
  Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>

// Browser
interface LaunchOptions {
  readonly executablePath: FilePath.Local | string     // absolute; required, and nothing is looked up
  readonly headless?: boolean | undefined               // default true
  readonly args?: ReadonlyArray<string> | undefined
  readonly profile?: LaunchProfile.LaunchProfile | undefined    // default LaunchProfile.automation
  readonly userDataDir?: FilePath.Local | string | undefined    // a profile directory you own; never deleted
}

// LaunchProfile: a value you can inspect; the actual args and prefs are recorded in the launch span and trace
class LaunchProfile extends Schema.Class<LaunchProfile>("@usestrider/browser/LaunchProfile")({
  name: Schema.Literals(["stock", "automation", "concurrent"]),
  args: Schema.Array(Schema.String),
  prefs: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))
}) {}
declare const stock: LaunchProfile                       // the browser's own defaults; nothing added
declare const automation: LaunchProfile                  // first-run, sync and update prompts off; nothing a page can observe; and Firefox's JSON viewer off, so a JSON response is the document served, and its new pages opened as windows, so a page behind a popup keeps rendering
declare const concurrent: LaunchProfile                  // automation, plus background-timer and renderer throttling off, for many pages at once

program.pipe(Effect.provide(Chromium.layer({ executablePath: "/usr/bin/chromium" })))
program.pipe(Effect.provide(Chromium.layerConfig({ executablePath: Config.String("CHROMIUM_PATH") })))   // each machine says
```

- **A launch names its browser's executable, and the library never looks for or installs one.** `executablePath` is required, so `Chromium.layer({})` doesn't compile, and it must be absolute: a relative path depends on the working directory and a bare command name on `PATH`, so either fails with `InvalidInput`. There are no channels, because no table of install locations is right on every system: NixOS, Snap, Flatpak and the open-source Chromium are never where it says, and Firefox's channels share their install paths. Install a browser as you would any program (an operating system's package, a vendor's installer, a Nix package): stock browsers only, none patched for automation. A path where nothing is fails with `ExecutableNotFound{searched}`.
- **`strider browsers` finds the paths, for a person or an agent, once.** It lists the browsers on the machine, by backend: on `PATH` under the command names browsers install, where Chrome's, Edge's and Firefox's installers put them, and, on Linux, where WebKitGTK's and WPE's packages put their MiniBrowser, each with the version it prints and where its path leads; a MiniBrowser's version is read from the path it leads to, where that names one, since asking it would open a window. `--json` prints the same as data. It runs nothing but `--version`, and the library never calls it. Code that runs on several machines reads the path from each one's environment with `layerConfig`.
- **No platform packages of our own.** Launching needs only Effect's `ChildProcessSpawner`, `FileSystem` and `WebSocketConstructor` services, which `@effect/platform-node` and `@effect/platform-bun` provide. `Firefox.layer` needs all three: Firefox has no pipe, so its launcher dials BiDi's WebSocket.
- **Stock WebKit's launch needs a TCP socket.** `WebKit.layer` with WebKitGTK's or WPE's MiniBrowser reaches its inspector server over TCP, at a port it picks, through `SocketConnector` (`@usestrider/browser/protocol`): the shape of Effect's own `effect/socket/SocketConnector` (Effect-TS/effect#8735), provisional until Effect releases it. Node's sockets provide it: `SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))`. Launch also requires Linux with readable `/proc/<spawned-pid>/net/tcp` and `/proc/<spawned-pid>/fd`. Before and after connecting, the spawned process itself must hold the same listening socket; a wrapper must exec MiniBrowser rather than only fork it. Other operating systems and unverifiable ownership refuse launch with `ConnectionFailed`, an explanation and `WebKit.layerAttach` guidance. A procfs read failure stops ownership attempts and closes any rejected connection, then waits for a child exit event within the remaining launch deadline; if none is observed, refusal retains the original access error. A child exit observed during startup reports `ProcessExited`, with an exit code when available and stderr collected within the same deadline, plus the exec-wrapper requirement and attach alternative. An ordinary readiness timeout retains `ConnectionFailed{stage: "handshake"}`; explicit ownership and access refusals use `stage: "refused"`. Attach remains available with an externally managed inspector HTTP endpoint.
- **Stock WebKit, launched.** The MiniBrowser runs in automation mode, and WebKit's Automation protocol drives it as WebKit's own WebDriver does: pages, trusted input, dialogs, the window's size as the viewport, file inputs. Each context is a browser process of its own. Its window opens where `DISPLAY` or `WAYLAND_DISPLAY` says, since WebKitGTK has no headless mode (`headless: true` is `InvalidInput`). As when attached, the engine and init scripts run in the page's world and `evaluate` is refused; a dialog is `Dialog.Unknown`, with its message (QUIRKS.md, Q206), and the input that opens one returns once it's decided, as everywhere (Q224); a frame locator finds its frame through Automation (Q228). A page another page opens has no opener, so `Popup` refuses to wait for one (`popups.opener`, Q212); a context's cookies are those its open pages are sent (`cookies`, `partial`, Q225). History traversal, the locale, time zone and user agent, a mobile viewport, touch, keyboard layouts, permissions, downloads, file choosers, screencasts and PDFs are `Unsupported`.
- **Profiles are temporary by default.** A launch acquires a directory with `FileSystem.makeTempDirectoryScoped` before the browser starts, and it is deleted after the browser exits. The profile, downloads and crash dumps never outlive the `Browser` layer. `userDataDir` names a directory you own instead: it is never deleted, and the browser locks it, so one browser uses it at a time. Reusing a login across browsers is storage state, not a shared profile.
- **Connecting attaches.** `Chromium.layerConnect` takes the browser's WebSocket URL or its HTTP endpoint (`http://127.0.0.1:9222`), whose `/json/version` names the WebSocket; `Firefox.layerConnect` takes the remote agent (`ws://127.0.0.1:9222`), adding `/session`; `Bidi.layerConnect` takes any endpoint as given. `options.headers` go with the handshake. The browser, and every page and context the connection didn't create, stay as they were when the layer's scope closes. A BiDi connection ends the session it started then: Firefox allows one session at a time and keeps one after its socket closes, so a connect while another client holds it fails with `ConnectionFailed`. An attached Firefox session leaves file choosers to the browser, since its prompt settings are the whole browser's. Stock WebKit attaches with `WebKit.layerAttach`, through its remote inspector.
- **Stock WebKit attaches for looking.** `WebKit.layerAttach` takes a WebKitGTK or WPE inspector server's HTTP endpoint (`http://127.0.0.1:9333`, as `WEBKIT_INSPECTOR_HTTP_SERVER` names it), whose list names a WebSocket per page, read again every 250 ms for pages that arrive; `options.headers` go with the requests and handshakes. The pages are observed in one default context, and `inspect` and `control` gain access as on the other backends. Its inspector has no `Input`, `Dialog`, `Emulation` or `Screencast` domain and makes no contexts, pages or worlds, so input, dialogs, emulation, screencasts, `newContext`, `newPage` and `evaluate` fail with `Unsupported`, and `evaluateInMainWorld` runs. The locator engine, init scripts and the library's own reads run in the page's world (QUIRKS.md, Q194). `goto` navigates by script and refuses a fragment of the document shown, which stock WebKit wouldn't report (Q200); `screenshot` is PNG; a navigation that downloads ends `BecameDownload` without a `Download` (Q198). `Browser.info` is `WebKit (stock)`, its version `unknown` (Q203). Safari's own inspector, and proxies to it such as ios-webkit-debug-proxy, list their pages another way, which isn't read.
- **Launch and connect fail with `Browser.BrowserError`.** Its reasons are `ExecutableNotFound{searched}`, `ProcessExited{code, stderrTail}`, `IncompatibleRevision`, `ConnectionFailed{stage}` and `InvalidInput`.
- **Backend layers can carry their known capabilities in their types,** so specialized features need no `Unsupported` case when the backend is chosen in code (P7). The mechanism is still open: a capability-typed `Browser` service, or backend-specific accessors.
- **Launch profiles are values, not hidden flags** (rule 23). `concurrent` changes what pages observe (timer cadence, background rendering), so it is opt-in and visible. No profile disables the back/forward cache, third-party storage partitioning or popup blocking: the model handles those hazards explicitly.

## Entry points and cross-cutting settings

```ts
// Browser
interface Browser {
  readonly info: Info                                   // fixed for the connection: product, version, protocol, revision
  readonly capabilities: Watchable.Watchable<CapabilitySet>   // refined as probes complete
  newContext(options?: UserContext.Options | undefined): Effect<UserContext.UserContext, UserContext.UserContextError | Timeout, Scope>   // owned; removed when the scope closes
  newPage(options?: UserContext.Options | undefined): Effect<Page.Page, Page.PageError | TargetGone | Timeout, Scope>   // a fresh context + page, released together
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>   // attach mode: what exists, and changes
  readonly defaultContext: UserContext.ObservedUserContext   // fixed: exists for the whole connection
}
declare const Browser: Context.Service<Browser, Browser>  // provided by a backend layer (Chromium.layer(options), …)
declare const newPage: (options?: UserContext.Options | undefined) => Effect<Page.Page, Page.PageError, Browser | Scope>
declare const newContext: (options?: UserContext.Options | undefined) => Effect<UserContext.UserContext, UserContext.UserContextError, Browser | Scope>

// Deadline: dual combinators over any effect
declare const within: Dual<Duration.Input>              // one deadline for everything inside, shared; nesting can only shorten it
declare const withDefaultBudget: Dual<Duration.Input>   // what an operation gets when no deadline encloses it; 30 seconds unless set
declare const remaining: Effect<Option<Duration>>       // time left before the enclosing deadline
declare const CurrentDeadline: Context.Reference<Option<MonotonicInstant>>   // read freely; set only through within
declare const DefaultBudget: Context.Reference<Duration>   // withDefaultBudget is Effect.provideService on this reference

// Operation: a program's own operations, kept as the library's are
declare const named: {                                  // the primitive, as Effect.withSpan; dual
  (name: string, options?: Options | undefined): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, Current>>
}
declare const fn: (name: string, options?: Options | undefined) => Fn   // Effect.fn's shape: named around the body, the pipeables around that
declare const markSent: Effect<void, never, Current>    // a side effect of the program's own may have happened
declare const observe: (value: unknown) => Effect<void, never, Current>   // why it isn't done yet: the Timeout's history
declare const bound: <A, E, R>(self: Effect<A, E, R>) => Effect<A, E | Deadline.Timeout, R | Current>   // a wait of its own, ended at the deadline
class Current extends Context.Service<Current, Operation>()("@usestrider/browser/Operation/Current") {}   // provided only by fn and named
interface Operation { readonly name: string; readonly id: Diagnostics.OperationId }
interface Options { readonly attributes?: Readonly<Record<string, unknown>> | undefined }   // the span's

// Diagnostics
declare const withPreset: Dual<"local" | "strict">      // how Redactable values render inside; "strict" unless set
declare const CurrentPreset: Context.Reference<"local" | "strict">
// Dual<X> = { (x: X): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>; <A, E, R>(self: Effect<A, E, R>, x: X): Effect<A, E, R> }

// UserContext
interface ObservedUserContext {                         // a context we don't control, e.g. the default context when attached
  readonly id: Id
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>   // shared and service workers
  readonly closed: Effect<Target.CloseReason>
  readonly control: Effect<UserContext, UserContextError, Scope>   // explicit; reading storage needs it too
}
interface UserContext extends ObservedUserContext {     // two levels only: reads happen on pages
  readonly newPage: Effect<Page.Page, Page.PageError | TargetGone | Timeout, Scope>   // closed with its unsolicited popups when the scope closes
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.Page>>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>
  readonly cookies: CookieJar.CookieJar                 // a sub-handle bound to the context (Storage, below)
  readonly exportStorageState: Effect<StorageState.StorageState, UserContextError | TargetGone>   // values Redacted in memory
  readonly clock: PageClock.PageClock                   // context-wide timeline (opt-in)
  route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, P>, options?: Route.Options<P> | undefined): Effect<Route.Registration, Route.RouteError | TargetGone | Timeout, Scope | R>   // asked after the page's own
  addInitScript(script: InitScript.Source, options?: InitScript.Options | undefined): Effect<InitScript.InitScript, DeclarationError | TargetGone | Timeout, Scope>
  emulate(settings: Emulation.Emulation): Effect<Registration, DeclarationError | TargetGone | Timeout, Scope>
  grant(permissions: ReadonlyArray<Permission>, options?: GrantOptions | undefined): Effect<Registration, DeclarationError | TargetGone | Timeout, Scope>   // default every origin (not on Firefox); ANDed with Permissions Policy
}

interface Options {                                      // UserContext.Options; an unset option keeps the browser's own value unless a default is stated
  readonly storageState?: StorageState.StorageState | undefined   // decoded with StorageState.Json
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen" | undefined   // decision when no handler claims a dialog; default "dismiss"
  readonly focus?: "system" | "emulated" | undefined    // default "system"; "emulated" makes every page report focus, and keeps a page behind a popup rendering on Chromium (owned contexts only)
  readonly eventLog?: number | undefined                // retained events per module and page, for history; default 100, 0 keeps none
  readonly downloads?: "temporary" | "deny" | { readonly directory: string } | undefined   // default "temporary": a directory made for the context and removed after it
  readonly emulation?: Emulation.Emulation | undefined  // held for the context's life: emulate(...) without a scope
  readonly permissions?: ReadonlyArray<Permission> | undefined   // granted for the context's life, every origin: grant(...) without a scope
}

// Emulation: what a declaration overrides while it lives; unset fields are untouched
interface Emulation {
  readonly viewport?: Viewport | undefined              // CSS pixels; deviceScaleFactor default 1, mobile default false
  readonly userAgent?: string | undefined
  readonly locale?: Locale | string | undefined         // BCP 47
  readonly timezone?: TimeZoneId | string | undefined   // IANA
  readonly geolocation?: Geolocation | "unavailable" | undefined
  readonly media?: Media | undefined                    // type, colorScheme, reducedMotion, forcedColors, contrast
  readonly network?: NetworkConditions | "offline" | undefined   // bytes per second, plus latency
  readonly cpuSlowdown?: number | undefined             // a factor; CDP only
  readonly javaScript?: "enabled" | "disabled" | undefined
  readonly touch?: boolean | undefined
}
```

- **A program's own operations are kept as the library's are.** `Operation.fn("checkout")` makes each call one operation: it reads the deadline in force once, opens a span named `checkout` (through `Browser.SpanNameGenerator` and `TracerDisabledWhen`, as every library span), and keeps a record. Every library operation inside it, and every operation of the program's, is a step of it: when the step ends, it joins the record's steps, and the record's dispatch moves as far as the step's went, a step that sent and succeeded counting as acknowledged. An event wait awaited inside it is a step too. A `Timeout` that leaves it is its own (Errors as users see them). `markSent`, `observe` and `bound` write the record, and compile only where `Operation.Current` is provided: inside `fn` or `named`, or in a helper that says so in its requirements. A handler's decision runs as an operation of its own, under its budget, never as a step of the operation that registered it. `Browser.Operation` is something else: what `SpanNameGenerator` is given, naming a span's operation.
- **What a connection controls.** A page it created, or a page in a context it created, is controlled for its life. Any other page is observed: a launched browser's own first tab, an attached browser's tabs, and their popups. `browser.pages` lists every page, as `Page`s or observed pages, and `browser.defaultContext` has `pages`, `workers` and `control`. `inspect` and `control` gain access for the caller's scope; when it closes, what they gave fails with `TargetGone{AccessReleased}`, every member alike (QUIRKS.md, Q143), the declarations made through them are removed, and the page stays open. Controlling a context controls its pages for the same scope; a page's `context`, when its context isn't controlled, refuses with `NotPermitted`. A context the connection didn't create has no dialog policy, so its dialogs wait for a handler or the user.
- **One concept, two lifetimes.** Creation options are declarations held for the context's whole life, made before its first page; `emulate` and `grant` are the same declarations, scoped. So viewport, locale and timezone live in `Emulation`, not as separate options. `focus: "emulated"` is the focus override, which Firefox lacks.
- **Overrides restore only what they know.** Removing one restores the previous value when it is known and access permits; precedence is page over context (CONCEPTS.md §7). A field the backend can't apply fails with `Unsupported` naming it.
- **Stock WebKit viewport confirmation.** A launched window is resized, then its CSS dimensions are checked immediately and on resize events for up to five seconds by default, capped by the operation deadline. One final measurement at the confirmation limit can still succeed; otherwise `Reason.ViewportMismatch` carries numeric `requested` and `actual` sizes. This is an observed match within a limit, not permanent support or a guarantee against later user/window-manager changes. Page creation checks inherited defaults and closes failed pages. Failed overrides restore and confirm the prior size under a detached five-second cleanup budget; a failed-change rollback failure remains visible as a defect alongside the original error. Ordinary scope release is non-failing: a confirmed gone page needs no restoration, and other release failures are logged without claiming success. Callback disposal preserves the primary result, ignores confirmed vanished windows and logs other failures. Cleanup reserves its final second for measurement inside the shared five-second budget; genuine operation deadlines remain timeouts. Genuine operation deadlines, navigation and protocol failures retain their own errors. Popup defaults are attempted, but no creating operation exists to report their failure: explicitly emulate the popup for confirmation.
- **One `emulate` call is one registration.** Removing it, or closing its scope, removes every field it set. Each field is a capability named for it: `emulation.viewport`, `emulation.viewport.mobile`, `emulation.userAgent`, `emulation.locale`, `emulation.timezone`, `emulation.geolocation`, `emulation.geolocation.unavailable`, `emulation.media`, `emulation.network.offline`, `emulation.network.throttling`, `emulation.cpuSlowdown`, `emulation.javaScript`, `emulation.touch` and `emulation.focus`. The call fails with `Unsupported` naming the first the backend can't apply, before anything is applied. Chromium applies every field. Firefox can't emulate media, touch, JavaScript, a mobile viewport, throttling, a CPU slowdown or an unavailable position. WebKit sets the locale and position per context, the locale only before the context's pages exist (which `UserContext.Options.emulation` is), and can't emulate touch, throttling, a CPU slowdown or an unavailable position. Most fields reach a loaded page at once; JavaScript, touch handlers and WebKit's `navigator.userAgent` wait for its next document.
- **Grants are recomputed.** Removing one leaves the others in force: the browser can only reset a context's grants together, so the library resets them and grants what remains. A name the browser doesn't know fails with `InvalidInput` naming it, and every origin is `permissions.anyOrigin`, which Firefox lacks.
- **Context failures are `UserContext.UserContextError`,** with reasons `StorageState.Incompatible{partitions}` (a saved state the new context can't apply in full: nothing is applied partly), `InvalidInput`, `NotPermitted`, `Unsupported` and `BackendFailure`.

## Pages

```ts
interface ReadonlyPage extends ObservedPage, Locator.Queries<Locator.ReadonlyLocator> {
  // queries: getByRole, getByText, getByLabel, getByPlaceholder, getByAltText, getByTitle, getByTestId, locator
  // a string matches as a case-insensitive substring unless exact: true; a RegExp is used as given
  frame(iframe: Locator.ReadonlyLocator): Locator.ReadonlyFrameLocator   // enters an iframe by its element; lazy, like any locator
  // one-shot reads
  readonly title: Effect<string, PageError>
  readonly readHtml: Effect<string, PageError>           // the document's serialized HTML
  snapshot(options?: Snapshot.Options | undefined): Effect<Snapshot.Snapshot<Locator.ReadonlyLocator>, PageError>
    // default: the accessibility tree plus inferred interactivity, every inferred node tagged with its evidence;
    // { sources: "aria" } is the accessibility tree only, what assistive technology sees.
    // depth and interactiveOnly narrow it: size is explicit, never truncated automatically
  screenshot(options?: ScreenshotOptions | undefined): Effect<Uint8Array, PageError>   // default: the viewport, PNG
  pdf(options?: PdfOptions | undefined): Effect<Uint8Array, PageError>
  readonly localStorage: OriginStorage.ReadonlyOriginStorage   // the current document's origin; a Page makes them writable
  readonly sessionStorage: OriginStorage.ReadonlyOriginStorage
  evaluate<Args extends ReadonlyArray<unknown>, A>(      // the isolated world, on every page: page globals are invisible
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<JSHandle.Serialized<A>, PageError>
  capability<H>(capability: Capability.Capability<H>): Effect<H, Capability.CapabilityError, Scope>
}

interface Page extends ReadonlyPage {
  // the queries, frame and snapshot above return Locator, FrameLocator and Snapshot<Locator>;
  // workers are BrowserWorkers, and localStorage and sessionStorage are writable OriginStorage
  readonly context: UserContext.UserContext              // fixed: a page never changes context
  goto(url: Url.Url | string, options?: GotoOptions | undefined): Effect<PageNavigation.PageNavigation, PageError>
    // waitUntil default "commit"; accept: ["download", "noContent"] returns those as navigations, and by default
    // a download fails with BecameDownload, a 204 with NoContent; either way the page stays where it was
  reload(options?: ReloadOptions | undefined): Effect<PageNavigation.PageNavigation, PageError>   // waitUntil, bypassCache
  back(options?: TraverseOptions | undefined): Effect<Option<PageNavigation.PageNavigation>, PageError>   // None: no history entry
  forward(options?: TraverseOptions | undefined): Effect<Option<PageNavigation.PageNavigation>, PageError>
  evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(   // the page's own world; needs control
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<JSHandle.Serialized<A>, PageError>
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(   // the isolated world, like evaluate
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<JSHandle.JSHandle<Awaited<A>>, PageError, Scope>
  readonly keyboard: Keyboard.Keyboard
  readonly mouse: Mouse.Mouse
  readonly clock: PageClock.PageClock
  route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, P>, options?: Route.Options<P> | undefined): Effect<Route.Registration, Route.RouteError | TargetGone | Timeout, Scope | R>
  addInitScript(script: InitScript.Source, options?: InitScript.Options | undefined): Effect<InitScript.InitScript, Declaration.DeclarationError | TargetGone | Timeout, Scope>
  emulate(settings: Emulation.Emulation): Effect<Declaration.Registration, Declaration.DeclarationError | TargetGone | Timeout, Scope>
  readonly activate: Effect<void, PageError | TargetGone | Timeout> // bring to front; rendering-based waits need it
  close(): Effect<void, PageError | TargetGone | Timeout>   // owned teardown: no beforeunload
  close(options: { readonly runBeforeUnload: boolean }): Effect<void, PageError | TargetGone | Timeout>
    // the prompt is decided as any dialog is; a handler's stay fails with CloseCanceled, the page usable;
    // browsers prompt only once the user has interacted with the page
}

// PageNavigation.LoadState = "commit" | "domContentLoaded" | "load": goto, reload, back and forward resolve at commit unless waitUntil asks for more

declare const withUserGesture: <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>   // main-world evaluation inside runs as a user gesture
declare const UserGesture: Context.Reference<boolean>

// JSHandle
type Serialized<A> =                                   // what actually arrives: defined once, next to our serializer, the same on every backend
  A extends string | number | boolean | bigint | null | undefined | Date | RegExp ? A
  : A extends ReadonlyMap<infer K, infer V> ? Map<Serialized<K>, Serialized<V>>
  : A extends ReadonlySet<infer T> ? Set<Serialized<T>>
  : A extends ReadonlyArray<infer T> ? Array<Serialized<T>>
  : A extends Node ? NotSerializable<"DOM nodes don't cross by value; use evaluateHandle">
  : A extends Function | symbol ? never
  : { [K in keyof A as A[K] extends Function | symbol ? never : K]: Serialized<A[K]> }   // class instances arrive as their data

interface ScreenshotOptions {
  readonly area?:                                        // default the viewport
    | { _tag: "Viewport" } | { _tag: "FullPage" } | { _tag: "Clip"; rect: Rect<Pixels.Css> }
    | { _tag: "Element"; locator: Locator.ReadonlyLocator } | undefined   // an element is captured beyond the viewport, never by scrolling
  readonly format?: { _tag: "Png" } | { _tag: "Jpeg"; quality: number } | undefined   // quality exists only for JPEG
  readonly scale?: "css" | "device" | undefined          // default "device"
  readonly omitBackground?: boolean | undefined          // default false
}
interface PdfOptions {                                   // Length is a value and a unit: in, cm, mm or px
  readonly paper?: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | { width: Length; height: Length } | undefined   // default "letter", as Chrome and BiDi
  readonly landscape?: boolean | undefined               // default false
  readonly margins?: { top?: Length; right?: Length; bottom?: Length; left?: Length } | undefined   // default none
  readonly scale?: number | undefined                    // default 1
  readonly background?: boolean | undefined              // default false
  readonly pageRanges?: string | undefined               // e.g. "1-3, 5"; default every page
  readonly preferCssPageSize?: boolean | undefined       // default false
  readonly header?: string | undefined; readonly footer?: string | undefined   // HTML templates; Unsupported on BiDi
}

// OriginStorage
interface ReadonlyOriginStorage {
  readonly entries: Effect<ReadonlyArray<readonly [key: string, value: string]>, OriginStorageError | TargetGone | Timeout>
  get(key: string): Effect<Option<string>, OriginStorageError | TargetGone | Timeout>
}
interface OriginStorage extends ReadonlyOriginStorage {
  set(key: string, value: string | Redacted<string>): Effect<void, OriginStorageError | TargetGone | Timeout>
  remove(key: string): Effect<void, OriginStorageError | TargetGone | Timeout>
  readonly clear: Effect<void, OriginStorageError | TargetGone | Timeout>
}
```

Notes:

- **Chromium screenshots belong to one main document.** The binding starts before element or layout preparation. A committed cross-document replacement before a terminal native capture reply fails promptly with `PageError{reason: Page.CaptureInvalidated}`, whose `document` and `replacement` identify both documents. A same-URL reload qualifies; hash/history changes and started-but-canceled navigations do not. Native reply receipt wins over a later replacement even if decoding finishes later; a replacement observed first wins over a late reply. An already terminal closure, crash or deadline keeps its error. This does not cancel Chromium's command, prove temporary capture settings were restored, wait for destination load, retry, or silently return replacement-document pixels. A caller can request another capture explicitly. In the pinned Chromium 155.0.8059.79 regression, an immediate second capture returned replacement-document pixels at the requested 1100×1000 viewport dimensions, without a load wait, delay or repair; this observation is not a general completion or restoration guarantee. Firefox, stock WebKit, subframe-only replacement and hangs without a committed main-document replacement keep their existing behavior.

- **Evaluated functions cross into the page.** They must be self-contained, and values travel as arguments. A `ReferenceError` from an evaluated function fails with `Reason.EvaluationThrown`, whose hint says so.
- **One name per world.** `evaluate` always runs in the isolated world, so a helper that takes a `ReadonlyPage` behaves the same when it is given a `Page`. The main world is `evaluateInMainWorld`, only on `Page`, so it is visible at every call site that uses it. So is running as a user gesture, where the backend supports it: `page.evaluateInMainWorld(openHelp).pipe(Page.withUserGesture)`.
- **The type says what arrives.** Results cross by value, typed `Serialized<A>`. To validate a result instead of trusting the function's type, decode it: `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Cart)))`. Handles are opt-in and scoped.
- **Evaluation goes again only when nothing ran.** A document that ends before the call is followed to the next one; one that ends during it fails the call with `TargetGone`, since the function may have run partly. A handle passed as an argument crosses as itself, into its own realm only; anything else crosses by value, and the first value that can't fails with `NotSerializable{path}`.
- **Reads of page storage follow access.** `localStorage` and `sessionStorage` belong to the current document's origin, and are read and written from the isolated world, which shares the page's storage. Reading needs inspect; writing needs control. A `Redacted` value is written as its value and never logged. An origin with no storage, such as an opaque one, is `BackendFailure`, and a value over the quota `InvalidInput`.
- **Captures map onto every backend's options.** An `Element` area is the element's box in the document, its frame's included, measured now: a capture never waits, so a locator that matches nothing is `Locator.NoMatch`, one that matches several is `StrictViolation`, and a stale ref is `InvalidInput`. `scale: "css"` and `omitBackground` are `Unsupported` on Firefox (`screenshot.cssScale`, `screenshot.omitBackground`), headers, footers and `preferCssPageSize` too (`pdf.headerFooter`, `pdf.preferCssPageSize`), and WebKit has no PDF (`pdf`). `readHtml` is the doctype and the root's `outerHTML`.
- **Navigation resolves at commit.** That is when a navigation has succeeded. Waiting for `domContentLoaded` or `load` is an extra wait you ask for with `waitUntil`, and the span records which state was waited for.
- **Page failures are `Page.PageError`.** It covers navigation (`NavigationFailed{netError}`, `NavigationCanceled{why}`, `NavigationSuperseded{by}`, `BecameDownload`, `NoContent`, all declared in `PageNavigation`), evaluation (`EvaluationThrown`, `NotSerializable`), reads and captures (a capture's element: `Locator.NoMatch` or `StrictViolation`), setup (`InitializationFailed{step}`), a refused close (`CloseCanceled`), and the shared `InvalidInput`, `NotPermitted`, `Unsupported` and `BackendFailure`. `operation` names the call.
- **Declarations are scoped registrations.** `route`, `addInitScript`, `emulate`, `grant`, `Dialog.handle`, `FileChooser.handle` and `clock.install` are removed when the caller's scope closes, and fail with `Declaration.DeclarationError` (`TimingUnsupported`, `Conflict{with}`, `DependencyReleased`, and the shared reasons). In `@effect/vitest`'s `it.effect` that scope is already present; elsewhere, use `Effect.scoped`.
- **Init scripts in workers.** `workers: true` also runs a main-world script in the scope's dedicated workers started from then on, before their own script, and it may come `after` only scripts that do too. `clock.install(mode, { workers: true })` does the same for the clock, whose operations then reach the current workers as they reach documents. Firefox can't: WebDriver BiDi's preload scripts run in documents only (`initScripts.workers`). On Chromium a worker that gets them pauses before its first script, where its global is whole (QUIRKS.md, Q187).
- **Init scripts keep one order everywhere:** the context's before the page's, then the order they were added in. `after` states a dependency, in force and of equal or broader scope, and a script runs only if each one it comes after ran in that document without throwing; a dependency removed stops its dependents. A script runs as its document starts, before `document.documentElement` exists, in every frame, cross-site ones included; added to a loaded page, it runs from the next document. One that throws is the page's `UncaughtException`. `world: "isolated"` is one isolated world of the caller's, apart from the engine's and the page's, where `page.evaluate` will run; WebKit has none for init scripts. On Firefox a `{ source }` or `{ path }` script runs inside a function, so its top-level declarations aren't globals; a function's are its own on every backend, since it runs as a call.

## Locators, actions and actionability

`nth(index)` selects a match counting from 0. Negative indexes and indexes at or past the number of matches
select nothing; strict reads fail with `NoMatch` and actions wait for a match until their deadline. `first`
and `last` select the first and last match separately, and select nothing when the list is empty. Errors and
traces preserve the selection as written: `nth(0)`, `nth(-1)`, `first` or `last`.

Checked state uses the native checked property for checkbox and radio inputs. ARIA roles `checkbox`, `radio`, `switch`, `menuitemcheckbox`, `menuitemradio`, `option` and `treeitem` use `aria-checked`. For `option` and `treeitem`, absent or empty `aria-checked`, or the literal value `"undefined"`, means checking is unsupported: checked reads and check/uncheck fail with `WrongElement` before input, including on ordinary native options. An explicit `"false"` means checkable but unchecked, as distinguished by [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/#aria-checked). The other supported roles retain false for absent or `"undefined"` values. `aria-selected` is independent: snapshots report checked and selected separately, and native options retain their native selected state.

```ts
interface ReadonlyLocator extends Queries<ReadonlyLocator>, Pipeable, Equal.Equal, Inspectable {
  // queries are relative to this locator
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
  filter(options: FilterOptions): ReadonlyLocator        // has, hasNot (RelativeLocator), hasText, hasNotText, visible
  and(other: ReadonlyLocator): ReadonlyLocator
  or(other: ReadonlyLocator): ReadonlyLocator
  nth(index: number): ReadonlyLocator
  readonly first: ReadonlyLocator                        // pure derivations are plain properties
  readonly last: ReadonlyLocator
  describe(label: string): ReadonlyLocator               // used in errors and traces
  // one-shot reads: no waiting, no retry; strict, so exactly one match (count and all excepted)
  readonly count: Effect<number, LocatorError>
  readonly readText: Effect<string, LocatorError>        // the engine's text, which getByText matches; not innerText
  readonly readValue: Effect<string, LocatorError>       // an input's, a textarea's or a select's; else WrongElement
  readonly readHtml: Effect<string, LocatorError>        // outerHTML
  readonly isVisible: Effect<boolean, LocatorError>
  readonly isEnabled: Effect<boolean, LocatorError>
  readonly isChecked: Effect<boolean, LocatorError>      // a checkbox's, a radio's or an ARIA checkable's; else WrongElement
  readonly all: Effect<ReadonlyArray<ReadonlyLocator>, LocatorError>   // pinned to the current nth matches
  readAttribute(name: string): Effect<Option<string>, LocatorError>
  snapshot(options?: Snapshot.Options | undefined): Effect<Snapshot.Snapshot<ReadonlyLocator>, LocatorError>   // this element's subtree
  evaluate<Args extends ReadonlyArray<unknown>, B>(      // the isolated world, with the element first; strict: exactly one match
    fn: (element: Element, ...args: Args) => B | Promise<B>, ...args: Args
  ): Effect<JSHandle.Serialized<B>, LocatorError>
}

interface Locator extends ReadonlyLocator {             // queries, chainers and first/last return Locator
  click(options?: ClickOptions | undefined): Effect<void, LocatorError>
  dblclick(options?: ClickOptions | undefined): Effect<void, LocatorError>
  tap(options?: PointerOptions | undefined): Effect<void, LocatorError>              // touch
  hover(options?: PointerOptions | undefined): Effect<void, LocatorError>
  check(options?: PointerOptions | undefined): Effect<void, LocatorError>            // confirms it became checked
  uncheck(options?: PointerOptions | undefined): Effect<void, LocatorError>
  focus(options?: ActionOptions | undefined): Effect<void, LocatorError>
  clear(options?: ActionOptions | undefined): Effect<void, LocatorError>
  scrollIntoView(options?: ActionOptions | undefined): Effect<void, LocatorError>    // the toolkit's scroll
  fill(value: string | Redacted<string>, options?: ActionOptions | undefined): Effect<void, LocatorError>
  press(key: Keyboard.Key | string, options?: PressOptions | undefined): Effect<void, LocatorError>   // modifiers
  pressSequentially(text: string | Redacted<string>, options?: TypeOptions | undefined): Effect<void, LocatorError>   // delay default 0
  selectOption(choice: SelectOption | ReadonlyArray<SelectOption>, options?: ActionOptions | undefined): Effect<void, LocatorError>   // { value } | { label } | { index }: which one is always stated
  setInputFiles(files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>, options?: ActionOptions | undefined): Effect<void, LocatorError>
  dragTo(target: ReadonlyLocator, options?: DragOptions | undefined): Effect<void, LocatorError>
}

interface ActionOptions {                                // every action takes these
  readonly checks?: Checks | undefined                   // overrides for the action's documented checks
  readonly trial?: boolean | undefined                   // run every check, dispatch nothing; default false
}
interface Checks {                                       // stable: default frames per backend, shown in spans and errors
  readonly visible?: boolean | undefined; readonly enabled?: boolean | undefined; readonly editable?: boolean | undefined
  readonly notInert?: boolean | undefined; readonly inViewport?: boolean | undefined; readonly receivesPointer?: boolean | undefined
  readonly stable?: boolean | { readonly frames: number } | undefined
}
interface PointerOptions extends ActionOptions {
  readonly position?: Mouse.Point | undefined            // CSS pixels from the element's padding box; default its centre
  readonly modifiers?: ReadonlyArray<Keyboard.Modifier> | undefined
}
interface ClickOptions extends PointerOptions {
  readonly button?: Mouse.Button | undefined             // default "left"
}

// FileInput: the brand is required, so paths can't be confused
declare const local: (path: FilePath.Local | string) => FileInput   // read on this machine, uploaded if the browser is remote
declare const remote: (path: FilePath.Remote) => FileInput          // already on the browser's host (BiDi input.setFiles semantics)
declare const bytes: (name: FileName | string, mimeType: MimeType | string, data: Uint8Array) => FileInput

// Locator.relative: only valid inside filter({ has })
declare const relative: Queries<RelativeLocator>
page.getByRole("row").filter({ has: Locator.relative.getByRole("button", { name: "Delete" }) })
```

`fill` requires a string (also inside `Redacted`); other runtime values fail with `InvalidInput` before browser dispatch.
For number inputs, it accepts empty clearing or a finite HTML floating-point string: optional minus, digits with an
optional fractional part (or a leading decimal point and digits), and an optional exponent (`1e2`). Whitespace,
a leading plus, a trailing decimal point, hexadecimal and non-finite values fail with `InvalidInput` before focus,
selection or mutation. The input's min, max and step do not restrict fill. Redacted values never appear in diagnostics.


- **How a locator finds elements** is CONCEPTS.md §8, Queries: one engine of ours, in each document's utility world, the same on every backend. Text is text content with whitespace collapsed, never `innerText`; `getByText` finds the smallest element that says it; `getByRole` uses the explicit or HTML-AAM implicit role and the accname 1.2 name.
- **Actionability is the CONCEPTS.md §8 predicate set**, evaluated in one injected round trip per attempt. An attempt checks at each animation frame, in the page, for up to a second; when the checks pass, the action takes the page's input permit, checks once more, and dispatches (CONCEPTS.md §5, Actions). At the deadline it fails with `Timeout{phase}`, `waitingForCondition`, or `resolving` when nothing ever matched, whose hint explains the last reason: "Another element covers the element's action point: div.toast "Saved"". Each action documents its checks:
  - `click`, `dblclick`, `tap`, `check`, `uncheck`, `dragTo`: visible, stable, enabled, notInert, inViewport (scrolling into view), receivesPointer; a drag's target is checked visible, enabled, notInert and inViewport;
  - `hover`: visible, stable, enabled, notInert, inViewport, receivesPointer;
  - `fill`, `clear`: visible, enabled, editable, notInert;
  - `focus`, `press`, `pressSequentially`: visible, notInert; `scrollIntoView`: visible, stable;
  - `selectOption`: visible, enabled; `setInputFiles`: none.

  Every action takes `checks` to turn individual checks off, recorded in its span; there is no blanket `force`.
- **What each action sends.** Pointer actions are gestures built from the page's input state (CONCEPTS.md §5): `click` a move, a press and a release; `dblclick` two clicks, the second with a click count of 2; `tap` a touch start and end, with no touch emulation; `hover` a move; `dragTo` a press, `steps` moves with the button held, and the release on the target. `check` and `uncheck` send nothing when the element is already in that state, and otherwise click and read the state again, failing with `StateUnchanged` when the click didn't change it. For a label, these actions use its own checked state when it is an ARIA checkable, falling back to its associated control's state only when the label has no checked state of its own. They click the label and interpret `position` relative to the label. A label with neither its own checked state nor a checkable associated control fails with `WrongElement`. This does not change `isChecked` or checked expectations on labels. `fill` focuses the element and selects its contents from the utility world, then inserts the value as text (`""` deletes it); an input whose value isn't typed (`date`, `color`, `range` and their kin) has it set there, with `input` and `change`, and equivalent browser serialization (such as lowercase color hex or omitted zero seconds) is accepted. A malformed value, or a range value changed by clamping or rounding, is `InvalidInput` without changing the live value or sending those events. Validation runs before and after focus; changes made by a focus handler remain on refusal. `press` and `pressSequentially` focus the element, then send keys. `focus`, `scrollIntoView` and `selectOption` act from the utility world, `selectOption` with `input` and `change` as a user's choice would, since a select's popup isn't something input can drive headless; an option that isn't there yet is waited for. `setInputFiles` takes the element by value and hands its node to the backend. An element of the wrong kind fails at once, with `WrongElement` or `NotEditable`.
- **The first trusted event is guarded** (CONCEPTS.md §8). The page can change between the checks and the input: a toast appears over the button. Just before a pointer gesture is sent, under the input permit, the engine arms capture-phase listeners for its pointer, mouse, touch and click events; if the first lands outside the element, it and the rest of the gesture are stopped before the page's handlers see them, and the action checks again, its history saying `Covered` and its span recording the attempt. `hover` is unguarded: hover effects are what it is for.
- **A synthetic HTML drag.** `dragTo(target, { html: "synthetic" })` has the page dispatch an HTML drag's events from the isolated world, sharing one `DataTransfer`: `dragstart` and `drag` on the element, `dragenter` and `dragover` at the target's point, `drop` there when a `dragover` handler accepted it or else `dragleave`, and `dragend`. The events are untrusted, which the option's name says, and it works on every backend; the element and the target must be in one document (`InvalidInput` otherwise). Chromium and WebKit ignore the `dropEffect` set on such a `DataTransfer`, so `dragend` sees `"none"` there (Q186). `"native"` is the default, and its `Unsupported` names `"synthetic"`.
- **Modifiers are keys, and a capability.** An action's `modifiers` are pressed before its gesture and released after, in one dispatch, as well as set on the events. WebKit's pointer events can't carry them, so a pointer action with modifiers fails there with `Unsupported{capability: "input.pointerModifiers"}` before anything is sent. An HTML drag (`draggable="true"` on the element or an ancestor) needs `input.dragAndDrop`: Chromium finishes it, by intercepting the drag and dropping it with drag events; Firefox starts a drag and never drops it, and WebKit's protocol has no drag, so there `dragTo` fails with `Unsupported`.
- **Locator failures are `Locator.LocatorError`,** for actions and reads alike, with `operation` and `locator` naming what was attempted. Its own reasons are `StrictViolation{candidates, suggestions}`, `NoMatch` (a read, which never waits, found nothing), `WrongElement{expected, element}`, `StateUnchanged{expected}` (`check` or `uncheck` clicked and the state stayed), `StaleRef{why}`, `NotEditable{element}` and `FileUnreadable{path}`; the shared ones are `InvalidInput`, `EvaluationThrown`, `NotSerializable`, `NotPermitted`, `Unsupported` and `BackendFailure`.
- **Strictness.** An action needs exactly one match, and ambiguity fails immediately with `StrictViolation`. There is no retry window. Strictness counts every match, hidden ones included, and the hint says when narrowing would fix it, e.g. "1 of 2 matches is visible; add `.filter({ visible: true })`". If duplicates are expected to be transient (a fading toast), say so in the code: `yield* toast.pipe(Expect.toHaveCount(0))` before acting.
- **`has:` takes only a `RelativeLocator`.** That makes Playwright's silent "page-rooted locator inside `has`" mismatch a type error.
- **Once only.** An action dispatches at most once per call. If a later step fails after input may have reached the page, the error carries that evidence and the action is never replayed. The one exception is a gesture the guard stopped, which the page's handlers provably never saw.
- **Reads are strict and immediate.** A read needs exactly one match: several fail with `StrictViolation`, as an action does, and none fails at once with `NoMatch`, since a read never waits. `readText` is the engine's text, the whitespace-collapsed text content `getByText` matches, so a locator found by a text reads that text back; `innerText` depends on layout and differs between engines. `count` and `all` take any number of matches.

## Keyboard, mouse, frames and handles

```ts
// Keyboard: keys to whatever has focus; input to one page is serialized
interface Keyboard {
  press(key: Key | string, options?: PressOptions | undefined): Effect<void, KeyboardError>   // modifiers
  pressSequentially(text: string | Redacted<string>, options?: TypeOptions | undefined): Effect<void, KeyboardError>   // delay default 0
  insertText(text: string | Redacted<string>): Effect<void, KeyboardError>   // no key events, as an input method
  hold(key: Key | string): Effect<HeldKey, KeyboardError, Scope>
}
// Mouse: coordinates, for canvas-like UIs; CSS pixels from the viewport's top left
interface Mouse {
  readonly position: Effect<Point>                       // mutable state, so read through an Effect
  move(to: Point, options?: MoveOptions | undefined): Effect<void, MouseError>   // steps default 1
  click(at: Point, options?: ClickOptions | undefined): Effect<void, MouseError>   // button, clickCount, modifiers; no actionability: there is no element
  hold(button: Button): Effect<HeldButton, MouseError, Scope>
  wheel(delta: Point): Effect<void, MouseError>
}
interface HeldKey { readonly release: Effect<void> }     // idempotent; the scope's finalizer becomes a no-op (HeldButton likewise)

// Locator
interface ReadonlyFrameLocator extends Queries<ReadonlyLocator> {   // an iframe's document, entered by its element; lazy like any locator
  readonly owner: ReadonlyLocator                        // the iframe element
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
}                                                        // FrameLocator: the same queries returning Locator

// JSHandle
interface JSHandle<A = unknown> extends Pipeable, Inspectable {   // a value in one realm, owned by the scope that acquired it
  readonly realm: Target.RealmId                         // fixed: a handle never moves between realms
  evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args):
    Effect<Serialized<B>, JSHandleError>
  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args):
    Effect<JSHandle<Awaited<B>>, JSHandleError, Scope>
  readonly read: Effect<Serialized<A>, JSHandleError>    // the value itself, by value
  readonly release: Effect<void>                         // early release; idempotent
}
```

- **Held input is scoped.** `hold` acquires a key or button and releases it when `release` runs or its scope closes, and on interruption, in reverse order (CONCEPTS.md §5). A failed step never leaves Shift held down. Later gestures carry what is held: a click while Shift is held is a Shift-click, and moves while a button is held are a drag. A release that fails on a live page leaves its input state unknown, so the next gesture on the page fails with `BackendFailure` rather than acting with a key that may still be down.
- **Keys are UI Events `key` values:** `"Enter"`, `"a"`, `"ArrowDown"`, `"Shift"`. Named keys come from a table of ours, and characters from a layout, `UserContext.Options.keyboardLayout` (`Keyboard.Layout`: `us`, the default, `uk`, `de`, `fr`, `es`, `it`), generated from Unicode CLDR's Windows layouts: a character is typed by the layout's key, with Shift or AltGr held as it says (AltGr as a key, `AltGraph`, never a modifier flag), one only a dead key reaches as the dead key then its other key, and one the layout lacks, such as `é` on `us`, as a key that types it. Firefox sends each character as its value, so the page sees the layout's `key` but a US `code` and no AltGr or dead-key presses (`input.keyboardLayout`, `partial`; QUIRKS.md, Q189); WebKit's key events don't carry the modifiers held (Q188). Modifiers are an option, `press("a", { modifiers: ["Control"] })`, never a `"Control+A"` syntax. `insertText` inserts without key events on CDP and WebKit; BiDi has no command for it and types the characters, which its `input.insertText` capability, `partial`, says.
- **The mouse acts by coordinates, and checks nothing.** `move` goes from the pointer's position in `steps` moves, `click` takes `clickCount` and `modifiers`, `wheel` scrolls at the pointer, and `position` reads where the page's input state says the pointer is.
- **Each input module has its own error,** `Keyboard.KeyboardError` and `Mouse.MouseError`, with the shared reasons: an unknown key is `InvalidInput`, and a modifier on WebKit's pointer is `Unsupported`.
- **Frames are entered, not held.** A frame locator re-resolves its iframe element on every attempt, like any locator; the frame tree as state is `page.frames`, whose `name` is `None`, since no backend reports it.
- **A frame is a boundary in a locator's steps.** `page.frame(iframe)` takes any locator of the page for the iframe, one in a frame included; `frameLocator.frame(iframe)` takes one built from that frame locator; `locator.frame(iframe)` takes one built from that locator, or applies the iframe's query under it. The iframe must be the one match, an iframe, or the operation says so (`StrictViolation`, `WrongElement`); a frame not there yet is an element not there yet, waited for by actions and expectations and `NoMatch` for a read. `and` and `or` take locators in the same frame.
- **Actions in frames.** An action scrolls each iframe on its way into view, since Chromium renders nothing in a cross-site frame outside the viewport, and its point must reach the iframe in each parent document as well as the element in its own; a covered iframe is `Covered{by}`, waited out like any other.
- **Handles end with their realm.** Using a handle after its realm ends fails with `TargetGone{RealmDestroyed}`, and using one after `release` is a defect. A scope's handles in a realm are one object group, released together in one command as the scope closes (`Runtime.releaseObjectGroup`; one `script.disown` on BiDi); `release` releases one (Q132, Q185). A primitive's handle holds the value itself.

## Expectations

```ts
// Expect
// no extra arguments: the matcher itself is the function
//   locator.pipe(Expect.toBeVisible)   or   Expect.toBeVisible(locator)
declare const toBeVisible: Matcher<Locator.ReadonlyLocator>   // Matcher<S> = (subject: S) => Effect<void, ExpectationFailed | TargetGone>
// toBeHidden (passes when the element is missing), toBeEnabled, toBeDisabled, toBeChecked, toBeFocused, toBeEditable
// with arguments: dual
//   locator.pipe(Expect.toHaveText("1 item"))   or   Expect.toHaveText(locator, "1 item")
declare const toHaveText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>]>
declare const toContainText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>
declare const toHaveValue: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>
declare const toHaveAttribute: DualMatcher<Locator.ReadonlyLocator, [name: string, expected?: string | RegExp | undefined]>
declare const toHaveCount: DualMatcher<Locator.ReadonlyLocator, [count: number]>
declare const toMatchAria: DualMatcher<Locator.ReadonlyLocator, [pattern: AriaPattern.AriaPattern]>
declare const toHaveURL: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>
declare const toHaveTitle: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>
// the general form: a subject and a condition
//   a Watchable is re-checked on each change; any other Effect is re-run at the interval
declare const that: <A, E, R>(subject: Effect<A, E, R>, condition: Condition.Condition<A>) => Effect<void, E | ExpectationFailed | TargetGone, R>
declare const withCheckInterval: Dual<Duration.Input>   // re-check interval for subjects with no change signal; default 100 ms
declare const CheckInterval: Context.Reference<Duration>

// Condition
declare const make: <A>(description: string, predicate: Predicate<A>) => Condition<A>   // the description appears in ExpectationFailed
declare const not: <A>(condition: Condition<A>) => Condition<A>   // the wait is for the negation, and it passes when the element is missing
declare const and: <A>(...conditions: ReadonlyArray<Condition<A>>) => Condition<A>   // evaluated against one observation
declare const because: { (why: string): <A>(condition: Condition<A>) => Condition<A>; <A>(condition: Condition<A>, why: string): Condition<A> }
// a Condition is Pipeable: condition.pipe(Condition.because("…"))

// AriaPattern: matched against snapshot({ sources: "aria" }); how children match is always stated
declare const node: (role: AriaRole.AriaRole, name: string | RegExp, children: Children) => AriaPattern   // "" means no accessible name
declare const text: (value: string | RegExp) => AriaPattern
declare const exactly: (...children: ReadonlyArray<AriaPattern>) => Children     // these children, in this order, and no others
declare const including: (...children: ReadonlyArray<AriaPattern>) => Children   // these children in this order; others may come between
declare const unchecked: Children                                                // children are not compared
```

- **How expectations evaluate.** An expectation checks once immediately, then again each time something its subject depends on changes. There is no backoff, because backoff adds more lag the longer a test waits (rule 23). Everything runs on the browser's clock, within the deadline (`Deadline.within` adjusts it). Where the change signal comes from depends on the subject:
  - **A locator's expectation waits in the page.** One round is one engine request: it checks, and if the condition doesn't hold, checks again on each mutation of the document (children, attributes, text), each `input`, `change`, `focusin` and `focusout` event, and each animation frame, answering when the condition holds or after a second. L1 sends rounds until the deadline. No change is missed between checks, and there is no polling cadence; a page that renders no frames and changes nothing is checked again at the next round.
  - **A `Watchable`** (`toHaveURL` on `page.url`, `Expect.that` on any `Watchable`) is checked again on each change.
  - **Any other effect,** given to `Expect.that`, is run again at `Expect.CheckInterval` (100 ms unless set). It runs under the expectation's deadline, and a check still running at the deadline, or failing with it, is a check that didn't finish: the expectation fails with `ExpectationFailed`, not the subject's `Timeout`.

  `toBeVisible` passes when exactly one element matches and is visible; no match, several, or a hidden one are observations it keeps re-checking, and its failure reports the last one and the history. `toHaveText` with a string matches the whole engine text exactly, with a `RegExp` tests it, and with a list matches each match in order, and their count. `toBeFocused` is the deep active element, through open shadow roots.
- **Accumulating failures is Effect's job.** To check several things and report every failure, use `Effect.validate` or `Effect.all(…, { mode: "result" })`; there is no separate soft-expectation mechanism.
- **What failure contains.** `Expect.ExpectationFailed{subject, condition, last, history, elapsed, checks, nearest, suggestions}`. `checks` counts the checks and names what triggered them. `history` is the de-duplicated sequence of observed values with timestamps, which answers "was it ever right?". When nothing matched, `nearest` is the accessibility text of what the longest matching prefix of the locator's steps found, two levels deep, and `suggestions` are locators for elements under it with the role the last step asks for and a close name: one that contains it, is contained in it, or is within two edits, ignoring case. Expectations about absence and counts, and `toHaveTitle`, have neither. `checks.triggeredBy` says `change` for rounds that re-checked in the page or on a `Watchable`'s change, and `interval` for an effect run again.

## State and events

Two kinds of things change over time, and they get different types on purpose. RxJS draws the same line (`BehaviorSubject` vs hot `Subject`), and so does the industry's move to signals for state and streams for events.

| | State | Events |
|---|---|---|
| Examples | page status and URL, frame tree, download progress, page lists, capabilities | responses, requests, navigations, popups, dialogs, downloads, console messages |
| Type | `Watchable.Watchable<A>` | a module per event type (`Download`, `NetworkResponse`, …) |
| Late subscriber gets | the current value, so nothing that matters is missed | nothing from before it subscribed; what already happened is a separate read of a bounded log |
| Slow consumer gets | the latest value (conflated) | every match, losslessly, up to a bound (`EventOverflow`) |

```ts
// Watchable
interface Watchable<A> extends Effect<A> {               // yield* reads the current value
  readonly changes: Stream<A>                            // current value first, then each distinct change; ends after the terminal state
  waitFor<B extends A>(refinement: Refinement<A, B>): Effect<B, Timeout | TargetGone | Watchable.Ended>   // level-triggered, under the deadline; Ended: settled on a value that doesn't satisfy it
  waitFor(predicate: Predicate<A>): Effect<A, Timeout | TargetGone | Watchable.Ended>
  map<B>(f: (a: A) => B): Watchable<B>                   // derived from the same source, so never glitchy
}

// every event module has these three verbs; T: targets, A: the event, F: the module's Filter
declare const next: <PE = never, PR = never>(target: T, filter?: F, where?: Subscription.Where<A, PE, PR>) =>   // subscribed when this returns; its value is the wait
  Effect<Effect<A, PE | TargetGone | Timeout>, Subscription.SubscriptionError, Scope | PR>   // run the wait for the first match, latched
declare const stream: <PE = never, PR = never>(target: T, filter?: F, where?: Subscription.Where<A, PE, PR>) =>   // every match from now on
  Effect<Stream<A, PE | EventOverflow | TargetGone>, Subscription.SubscriptionError, Scope | PR>
declare const history: (target: T, filter?: F) =>   // every retained match; a read, so no where
  Effect<Subscription.History<A>, Subscription.SubscriptionError>   // its filter is checked as next's is

// Subscription
type Where<A, PE, PR> = (event: A) => Effect<boolean, PE, PR>   // a caller predicate, after the declarative filter
interface History<A> {
  readonly entries: ReadonlyArray<A>                     // oldest first
  readonly dropped: number                               // matches the cap discarded, so a truncated log doesn't look complete
}
declare const History: <S extends Schema.Top>(entry: S) => Schema.Struct<…>   // the schema of a data event's history, for export

// in use: call sites 2–5, 13 and 15
```

| Module | Emits | Filter | Targets |
|---|---|---|---|
| `PageNavigation` | `PageNavigation` | `url`, `frames` (`"main"`, or `"all"` for its frames' too); `next` also takes `waitUntil` | any page |
| `Popup` | `Page` from a `Page`, otherwise `ObservedPage` | `url` | any page |
| `NetworkRequest` | `NetworkRequest` | `url`, `method`, `resourceType`; `next` requires `url` | any page or context |
| `NetworkResponse` | `NetworkResponse`, or `CapturedResponse<B>` given `body` | `url`, `method`, `status`; `next` requires `url`. `body` (any decoder of an `HttpIncomingMessage`, such as `HttpIncomingMessage.schemaBodyJson(Cart)`) needs inspect, applies to `next` and `stream`, and types their `where` | any page or context |
| `ConsoleMessage` | `ConsoleMessage` | `level`, `text` | any page or context |
| `UncaughtException` | `UncaughtException`: thrown errors and unhandled rejections; `kind` is `"unknown"` where the browser can't tell them apart (Firefox) | `message` | any page or context |
| `Dialog` | `Dialog` | `kind` | any page; `Dialog.handle` needs `Page` |
| `FileChooser` | `FileChooser`: data (`Single` or `Multiple`); `FileChooser.handle` gets it as `Pending` | `multiple` | `Page` |
| `Download` | `Download` | `url` | `Page` or `UserContext` |
| `AutoResolution` | `AutoResolution`: an obligation decided by a default policy | `subject` | `Page` or `UserContext` |
| `BrowserWorker` | `BrowserWorker` from a `Page` or `UserContext` (it can `evaluate`, which needs control: workers have no isolated world), otherwise `ObservedBrowserWorker` | `url`, `kind`: a page's are dedicated; `shared` and `service` need `workers.shared` and `workers.service` (CDP) | any page or context |
| `NetworkConnection` | `NetworkConnection`: a WebSocket or EventSource, whose `frames` subscribe from now on (`networkConnections`: CDP; stock WebKit without EventSource; Unsupported on BiDi) | `url`, `kind` | any page or context |

Each module has the most specific accurate name, with a prefix only where a bare name would clash with the fetch `Request`/`Response` or DOM `Navigation` globals. `ConsoleMessage` avoids Effect's `Console`, and `UncaughtException` avoids `Page.PageError` and the `*Error` suffix our failures use.

**Events:**
- **Filters are data; `where` is a function.** The filter is applied before buffering, so unrelated traffic can't overflow a subscription. `where` runs after it, in the subscriber, never on the ingestion path. It is a separate trailing argument because TypeScript can't type a callback from a sibling property of the same object: as its own argument, `where` gets the decoded body type from `body`. The sketch found this.
- **Subscribe, act, collect.** `next` and `stream` are subscribed by the time their effect returns, so code order is subscription order, and one action can have several outcomes. A subscription that can't be set up fails `next` or `stream` itself with `Subscription.SubscriptionError`, before any event. A subscription made too late is diagnosed: its `Timeout` names the match that arrived just before it subscribed.
- **How events are delivered.** The model's fold publishes each event to a channel per kind and target, which logs it and offers it to every subscription whose filter it matches, each into a buffer of its own, never blocking the fold. A subscription sees every event published after it registered and none before, even one whose details arrive later, such as a popup's URL. A `stream` buffers at most `Subscription.Capacity` events (1,000 unless set with `Subscription.withCapacity`) for a consumer that falls behind, and then fails with `EventOverflow`, alone; `next` keeps what arrives until its first match or its deadline. A `next` that times out does so in the phase `waitingForEvent`, and its hint names a matching event that came before it subscribed: "a popup came 12 ms before Popup.next subscribed; call Popup.next before the action that causes it".
- **Every event is attributed to a page and its context.** Facts name a frame, a realm or a request's initiator, so the model keeps which page and context each belongs to: a frame's requests and console reach its page, a dedicated worker's its page, and a shared or service worker's only its context. An event whose page and context are unknown reaches no subscription, and the backend's capability limitations say which.
- **Delivering can take an effect.** A response with a `body` is delivered once its body has loaded and been decoded, and `PageNavigation.next` with `waitUntil` once its document has loaded; the work runs in the subscriber, as `where` does, and its failure fails the wait or the stream.
- **What a backend can't report is a capability.** A filter that asks for events the backend can't report (`NetworkConnection` on BiDi, `kind: "eventSource"` on WebKit, shared and service workers where the backend can't say whose they are), and a subscription to events it reports none of (`Popup` where it can't say which page opened a page, `Download` and `FileChooser` where it reports none: stock WebKit), fails `next`, `stream` and `history` with `SubscriptionError{Unsupported}`, naming the capability; an unfiltered subscription gets what the backend reports, and the capability's limitations say what that leaves out.
- **`history` looks back.** It answers questions you couldn't ask in advance (debugging, failure reports, agents, the CLI, a popup's first requests) and never subscribes or waits, so it can't catch what an action causes; that is why there is no `last`. Its filter is checked as `next`'s is: one that doesn't compile, or that the backend can't apply, fails with `SubscriptionError` rather than answering an empty history.
  - The log is capped by `UserContext.Options.eventLog`, so a missing entry proves nothing unless `dropped` is 0. `dropped` counts every event of the kind the log discarded for its target, because which of them a later filter would have matched can't be known: it is an upper bound on the matches lost. Complete records come from a `stream` opened at the start, or from `Har.record`.
  - Entries never decay: metadata is copied, without bodies, and handles live as long as their owner.
  - The history of a data event encodes with `Subscription.History(NetworkRequest.NetworkRequest)`, for the CLI and test artifacts.
  - To wait for something that may already have happened, use `Expect.that` on `history`.
- **Events report; handlers decide.** Obligations are decided only by scoped handlers: `page.route`, `Dialog.handle` and `FileChooser.handle`. A dialog blocks its page, so the click that opens one doesn't finish until it is decided, and the handler is registered first.
- **Events reveal resources; they don't acquire them.** `Popup.next` and `Popup.history` return the same handle, owned by the scope that acquired its opener; the `Scope` on `next` and `stream` holds only the subscription. Popups of owned pages are owned, and popups of attached pages stay open.
- **A popup is reported when it appears.** Every browser reports a popup before it loads, as `about:blank` (or Chromium's `""`), and the URL it was opened for with its first navigation. So the event comes at once, with its `Page`, and a handler or a route registered on it then is in place for its first document. A `url` filter matches the URL of the first navigation, and a popup that never navigates matches no pattern. A popup whose opener the backend didn't name reaches no page's subscriptions; it is still in its context's `pages`, which hands out the same `Page`.
- **The opener goes to the background.** When a popup opens, Chromium and Firefox report the opener `hidden`, and headless Chromium renders no frames for it, so an action on the opener waits for frames that don't come and times out with `NoRenderingOpportunity`, whose hint names `page.activate`. The library doesn't activate pages behind the caller's back (rule 23).
- **`next` hands out the wait, an `Effect`.** Running `next` subscribes; running its value, the wait, gives the first match: `const popup = yield* popups`. The wait is latched, so running it again gives the same result, and it is all a caller ever does with it, which is why it isn't a `Deferred` (revision 5.23 handed out a `ReadonlyDeferred`, proposed upstream; the proposal is withdrawn). Effect has the same shape in `Effect.cached`. Interrupting a wait interrupts that wait only; the subscription lasts until its scope closes, and the scope closing before a match interrupts the wait.
- **A wait's deadline is set where the wait starts.** Its timer comes from the deadline in force at `next`, so the budget is stated where the wait begins: `Download.next(page).pipe(Deadline.within("2 minutes"))`. Time spent in your own steps before you run the wait counts against it. A wait always ends: in the match, in `TargetGone` as soon as the owner ends, or in `Timeout`, which fails it rather than interrupting it, because interruption means the caller cancelled.
- **Results outlive the subscription.** A captured response body is owned bytes, so it survives the subscription and even the page closing.
- **Event streams end** normally when their owner ends normally or the acquiring scope closes. They fail with `TargetGone` on an abnormal end, and with `EventOverflow` past their bound, so both are in every event stream's error type.

**State:**
- **Watching gives you the present, not the past.** `changes` starts with the current value and conflates, so intermediate stages can be skipped. To see transitions from the beginning, subscribe before the cause, or fork the consumer right after you get the handle.
- **Waits are level-triggered.** `waitFor` checks the current value and then the changes, so skipped stages don't matter.
- **The terminal state is data.** `changes` emits the terminal state (`Closed{reason}`, `Completed`, …) last and then ends. It doesn't fail, because the union already says why it ended.
- **Only state the model folds from protocol events is watchable.** Reads that need a round trip (DOM reads, `title`) stay plain `Effect`s rather than hiding a poll. An event log is not state: its changes are just the events again, and a level-triggered wait on it would match old events.

## Network

```ts
// Route
type Phase = "request" | "response" | "auth"
type Handler<E, R, P extends Phase = "request"> = (intercepted: Intercepted<P>) => Effect<Decision<P>, E, R>   // E is logged; the default applies
interface Decision<in P extends Phase> {}                // valid at the phases P: one valid at more is accepted where fewer are asked for
type Intercepted<P> = Extract<RequestPhase | ResponsePhase | AuthPhase, { phase: P }>
interface Paused {
  readonly request: NetworkRequest.NetworkRequest        // fixed: the request as paused; NetworkRequest.toHttpClientRequest for HttpClient
  readonly requestBody: Effect<Option<Uint8Array>, RouteError | TargetGone | Timeout>   // the body as sent, on every backend
}
interface RequestPhase extends Paused { readonly phase: "request" }
interface ResponsePhase extends Paused {
  readonly phase: "response"
  readonly response: NetworkResponse.NetworkResponse     // fixed: status and headers
  readonly responseBody: Effect<Uint8Array, RouteError | TargetGone | Timeout>   // interception.responseBody: CDP only
}
interface AuthPhase extends Paused { readonly phase: "auth"; readonly challenge: { origin: string; scheme: string; realm: string } }
declare const continue: Decision<Phase>                  // at auth: the page gets the challenge's response
declare const fallthrough: Decision<Phase>               // the next matching route, or the default
declare const continueWith: {
  (change: (request: HttpClientRequest) => HttpClientRequest): Decision<"request">   // only what changed is sent
  (change: ResponseChange): Decision<"response">         // interception.responseHeaders: CDP and BiDi
}
interface ResponseChange {
  readonly status?: number | undefined                   // with its standard phrase; default the server's
  readonly headers?: Headers.Input | undefined           // replace the server's whole; default the server's
}
declare const fulfill: (response: HttpServerResponse) => Decision<"request" | "response">   // HttpServerResponse.json, .text, .uint8Array, .stream, .file
declare const abort: (reason?: AbortReason | undefined) => Decision<"request" | "response">   // default "failed"; another reason is CDP's
declare const provideCredentials: (credentials: { username: string; password: Redacted<string> }) => Decision<"auth">
declare const fromHar: (path: FilePath.Local | string, options?: { readonly notFound?: "abort" | "fallthrough" | undefined } | undefined) =>
  Effect<Handler<never, never, "request">, Har.HarError, FileSystem>   // reads the HAR now; default notFound "abort"
// HAR recording: Recordings, below

yield* page.route("https://app.example.com/api/user", () => Effect.succeed(Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))))
yield* page.route("https://app.example.com/api/**", () => Effect.succeed(Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))))
yield* page.route("https://app.example.com/api/slow", (intercepted) =>   // what the server sent, patched (CDP)
  Effect.map(intercepted.responseBody, (body) =>
    Route.fulfill(HttpServerResponse.uint8Array(body, { status: intercepted.response.status, headers: intercepted.response.headers }))),
  { phase: "response" })
```

- **Requests and responses are events of their page and context.** A request is published per hop when it is sent, and a response when it arrives; `NetworkRequest.toHttpClientRequest` turns a captured request into Effect's `HttpClientRequest`, redacted headers still redacted.
- **The headers a request was sent with.** A request event's `headers` are what its event gives, which on Chromium and WebKit leave out what the network adds, `Cookie` among them (QUIRKS.md, Q158, Q181). `NetworkRequest.headersSent(target, request)` waits, within the operation's budget, until the headers as sent can be attributed to that hop. Chromium may need response or redirect information even after request `ExtraInfo` arrives; WebKit waits for the response, and Firefox reports them at once. On Chromium, awaiting `headersSent` before letting the same request's response proceed waits until the deadline: let the response proceed first, or read the immediate, possibly incomplete `request.headers`. A request that finishes, fails, is canceled or loses its page settles the wait promptly with its available sent headers, falling back to its event's headers when none were reported; a request the model no longer keeps also gives its event's headers. The fallback can omit network additions such as `Cookie`. Stock WebKit reports no `Cookie` either way (`network.headersSent`, `partial`; Q226).
- **Bodies are collected for a subscription, not always.** `NetworkResponse.next` and `stream` with a `body` declare collection for their page or context in the subscription's scope before they return, up to `NetworkResponse.BodyLimit` (10 MiB; Effect's `HttpIncomingMessage.MaxBodySize` is a separate setting, for what this program reads). The response is delivered once its hop has ended and its bytes were read and decoded. A redirect hop has no body (`BodyUnavailable{redirect}`, without asking the browser), nor does a hop over the limit (`overLimit`), one the browser no longer has (`evicted`), or one that failed after its response started (`failed`). A body that hasn't finished by the deadline, such as an event stream's, times out `next`, with a hint saying the response matched, and fails a `stream` with `BodyUnavailable{streaming}` after `Deadline.DefaultBudget`; a response whose content type is `text/event-stream` is `BodyUnavailable{streaming}` at once (QUIRKS.md, Q40). A body that isn't what it was read as, `json` of one that isn't JSON, is `MalformedBody{expected}` (Q64).
- **Requests and responses are Effect's HTTP types.** A fulfilled response is an `HttpServerResponse` and a request change is an `HttpClientRequest` transform, so everything `effect/http` offers for building them applies. What each backend can change differs (CDP: URL, method, headers and body; BiDi adds cookies), and a change it can't apply fails with `Unsupported` naming the field rather than being dropped. Effect marks its HTTP modules unstable, so `Route` can change when they do.

```ts
// Declaration
interface Registration { readonly remove: Effect<void> }          // idempotent; the scope's finalizer becomes a no-op
interface HandlerRegistration extends Registration { readonly handled: Watchable<number> }
// Route
interface Registration extends Declaration.Registration { readonly hits: Watchable<number> }
// InitScript
interface InitScript extends Declaration.Registration { readonly id: Id }   // also usable in { after: [...] }
```

- **The handler's return type is the obligation.** A handler that fails, is interrupted, runs out of its `Deadline.DefaultBudget` (as read at `route`), or returns a decision the backend can't apply gets the default decision, `continue`; its failure is logged at Effect's `References.UnhandledLogLevel`, and the decision is published as an `AutoResolution{PausedRequest}` (`policy: Default`; QUIRKS.md, Q105) on the page and its context, as it is when every matching route falls through. A paused request is never left hanging, and one no route matches continues at once. At an authentication challenge the default is the challenge's response, never the browser's own prompt, which waits forever on headless Firefox. A context the library creates has its challenges paused where the backend can, so a challenge no route matches gets that response too, and `goto` commits at the server's `401`: every challenge on Firefox, a document's on Chromium, where a `fetch`'s or a subresource's still waits on the prompt, and none on WebKit, whose navigation never commits (`network.challenges`; QUIRKS.md, Q252, Q254 and Q255).
- **Order.** Routes compose by precedence: the page's before its context's, then the most recent first; `fallthrough` asks the next. `hits` counts the requests a route was asked about. A route matches its pattern itself, with `Url.Pattern`'s rules; the browser is asked to pause what covers it: a glob or URL as it is, and a `URLPattern` as its fixed prefix, up to its first variable part (QUIRKS.md, Q106).
- **A response can be changed without its body.** `Route.continueWith({ status, headers })` at the response phase sends the server's response on with its status or headers replaced and its body as it came, on CDP and BiDi; Firefox can't fulfill there, and this is what it can do (Q93). WebKit can't do either without reading the body, which it can't (`interception.responseHeaders`).
- **Replaying a HAR is a route.** `Route.fromHar(path)` reads a HAR, or the zip `Har.record`'s `content: "attach"` writes, told apart by its signature, and makes a handler: `page.route("**/api/**", yield* Route.fromHar("api.har"))`. An entry matches by method and URL, and by body where both have one, which the export writes with `include: ["requestBodies"]`; the latest match wins. Its response is fulfilled as recorded, a redirect as a redirect (which WebKit doesn't follow, Q90), with its body decoded and the headers that described the encoding, and a redacted `Set-Cookie`, left out; an entry that failed without a response fails the request. A request nothing matches is aborted unless `notFound: "fallthrough"`. The file is read once, as the handler is made, so a missing or malformed one fails `fromHar` with `HarError{ReadFailed}` or `InvalidInput`, not each request.
- **A route has one phase.** `"request"` unless `options.phase` says `"response"`, when the server's status and headers are in (and on Chromium its body), or `"auth"`, at a challenge. The phase types what the handler is given and may return: `provideCredentials` is no decision for a request-phase route.
- **What the backends do differs, and is said.** Chromium shows a route the CORS preflight of a cross-origin request, an `OPTIONS` request, which Firefox and WebKit don't; a fulfilled cross-origin response needs CORS headers on all three. WebKit pauses only a redirect's first hop and doesn't follow a redirect a route fulfills; it has no authentication phase. Firefox can't fulfill at the response phase or send a request to a new URL, and reports one failure for every abort reason, as WebKit does. Capability entries name each: `interception.responseBody`, `interception.responseFulfill`, `interception.continueUrl`, `interception.abortReason`, `interception.redirects`, `interception.responseHeaders` and `network.challenges`.
- **No second HTTP client.** A route has no `fetch` that performs the request outside the browser, as Playwright's `route.fetch` does: its cookies, proxy, TLS, cache and service workers wouldn't be the browser's. A handler that wants that says so with `NetworkRequest.toHttpClientRequest(intercepted.request)`, its own `HttpClient`, and `Route.fulfill(HttpServerResponse.fromClientResponse(response))`.

## Dialogs, downloads, storage, permissions

```ts
// Dialog
const Dialog = Schema.Union([                         // what events report: data, so a dialog's history encodes
  Schema.TaggedStruct("Alert", { id: PromptId, message: Schema.String }),   // id: what Page.Status shows as prompt.id
  Schema.TaggedStruct("Confirm", { id: PromptId, message: Schema.String }),
  Schema.TaggedStruct("Prompt", { id: PromptId, message: Schema.String, defaultValue: Schema.String }),
  Schema.TaggedStruct("BeforeUnload", { id: PromptId }),
  Schema.TaggedStruct("Unknown", { id: PromptId, message: Schema.String })   // a browser that doesn't say which kind: stock WebKit
])
type Pending =                                         // what a handler decides: each shape offers only the decisions valid for it
  | Alert & { readonly accept: Decision }
  | Confirm & { readonly accept: Decision; readonly dismiss: Decision }
  | Prompt & { readonly accept: Decision; respond(text: string): Decision; readonly dismiss: Decision }   // accept answers with defaultValue
  | BeforeUnload & { readonly leave: Decision; readonly stay: Decision }
  | Unknown & { readonly accept: Decision; respond(text: string): Decision; readonly dismiss: Decision }   // accept: as OK would; respond, refused unless it was a prompt, leaves it to the policy
declare const handle: <E, R>(page: Page.Page, handler: (dialog: Pending) => Effect<Decision, E, R>) =>
  Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | TargetGone, Scope | R>   // Unsupported where nothing would ask it
// ready-made handlers; match on _tag for anything finer
declare const acceptAll: (dialog: Pending) => Effect<Decision>    // Alert/Confirm/Prompt/Unknown: accept; BeforeUnload: leave
declare const dismissAll: (dialog: Pending) => Effect<Decision>   // Alert: accept; Confirm/Prompt/Unknown: dismiss; BeforeUnload: stay

// FileChooser
const FileChooser = Schema.Union([Schema.TaggedStruct("Single", {}), Schema.TaggedStruct("Multiple", {})])   // what events report: data
type Pending =                                         // what a handler decides; doesn't pause the page; Cancel when no handler decides
  | { readonly _tag: "Single"; select(file: FileInput.FileInput): Decision; readonly cancel: Decision }
  | { readonly _tag: "Multiple"; select(files: ReadonlyArray<FileInput.FileInput>): Decision; readonly cancel: Decision }
declare const handle: <E, R>(page: Page.Page, handler: (chooser: Pending) => Effect<Decision, E, R>) =>
  Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | TargetGone, Scope | R>   // Unsupported where nothing would ask it
declare const choose: (files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>) =>
  (chooser: Pending) => Effect<Decision, FileChooserError>   // fails with InvalidInput on a Single chooser given several files, so Cancel applies

// Download
interface Download extends Pipeable, Inspectable {
  readonly id: Id
  readonly url: Url.Url                                  // fixed when the download begins
  readonly suggestedFilename: FileInput.FileName         // fixed when the download begins
  readonly status: Watchable.Watchable<Status>           // InProgress{received, total} | Completed | Canceled | Failed{reason}
  readonly finished: Effect<void, DownloadError | TargetGone | Timeout>   // status.waitFor(terminal), under the deadline
  readonly stream: Stream<Uint8Array, DownloadError | TargetGone | Timeout>   // the bytes, once it completes
  saveAs(path: FilePath.Local | string): Effect<void, DownloadError | TargetGone | Timeout>   // always a local path; waits for completion, under the deadline
  readonly cancel: Effect<void, DownloadError | Timeout>   // Unsupported where the protocol has no command for it (BiDi)
  // the file is in a temporary directory its context owns, deleted when the context closes; saveAs copies it out first
}

// CookieJar: context.cookies
interface CookieJar {
  readonly list: Effect<ReadonlyArray<Cookie>, CookieJarError | TargetGone | Timeout>         // every cookie in the context
  listFor(url: Url.Url | string): Effect<ReadonlyArray<Cookie>, CookieJarError | TargetGone | Timeout>   // what a request to url would send
  set(cookie: Input): Effect<void, CookieJarError | TargetGone | Timeout>                     // a change, not a declaration: a scope doesn't undo it
  remove(match: Match): Effect<void, CookieJarError | TargetGone | Timeout>                   // name; domain and path default to any
  readonly clear: Effect<void, CookieJarError | TargetGone | Timeout>
}
declare const toCookie: (cookie: Cookie) => Cookies.Cookie            // to effect/http's Cookie, unredacting the value explicitly
class Cookie extends Schema.Class<Cookie>("@usestrider/browser/CookieJar/Cookie")({   // Effect's cookie attributes plus what only browsers store
  name: Name, value: Schema.Redacted(Schema.String),     // values are classified
  domain: Domain, path: Schema.String,
  expires: Schema.Option(Schema.DateTimeUtc),            // None: a session cookie
  httpOnly: Schema.Boolean, secure: Schema.Boolean,
  sameSite: Schema.Option(Schema.Literals(["strict", "lax", "none"])),   // None: the cookie didn't say, and the browsers' defaults differ
  partitionKey: PartitionKey,                            // Partitioned only where the backend reports it: CDP
  priority: Schema.Option(Schema.Literals(["low", "medium", "high"]))   // Chromium's alone
}) {}
interface Input {
  readonly name: Name | string
  readonly value: string | Redacted<string>
  readonly scope: { _tag: "Url"; url: Url.Url | string } | { _tag: "Domain"; domain: Domain | string; path: string }   // which one is always stated
  readonly expires?: DateTime.DateTime.Input | undefined   // default: a session cookie
  readonly httpOnly?: boolean | undefined; readonly secure?: boolean | undefined   // defaults false
  readonly sameSite?: "strict" | "lax" | "none" | undefined   // default "lax"
  readonly partitionKey?: PartitionKey | undefined       // default Unpartitioned
}

// StorageState: cookies, localStorage and IndexedDB, per partition
class StorageState extends Schema.Class<StorageState>("@usestrider/browser/StorageState")({
  cookies: Schema.Array(CookieJar.Cookie),
  origins: Schema.Array(OriginState)                     // origin, partition and its top-level origin, localStorage, IndexedDB; values Redacted
}) {}
declare const Json: Schema.Codec<StorageState, string>   // Schema.fromJsonString(Schema.toCodecJson(StorageState)): encode to save, decode to load
```

- **A dialog event is data; a handler gets the decisions.** `Dialog.next`, `stream` and `history` report a `Dialog`, which observing doesn't decide; a handler receives it as `Pending`, with the decisions its kind offers.
- **Which handler decides.** The page's latest `Dialog.handle` still in its scope, chosen when the dialog opens; removing it leaves later dialogs to the one before. It has `Deadline.DefaultBudget`, as read at `handle`, per dialog. A handler that fails, is interrupted or runs out of time leaves the dialog to the policy, and its failure is logged at Effect's `References.UnhandledLogLevel`. The decision is delivered by a resolver in the model's scope, apart from the handler's fiber, so a late handler can't contradict it. `handled` counts what a registration decided.
- **Default dialog policy.** It is explicit and has no delay. A context's `dialogs` option (`"dismiss"`, the default for owned contexts; `"accept"`; or `"leaveOpen"`) decides immediately when no handler claims a dialog. `beforeunload` is accepted under `"dismiss"`, so closing never hangs. On attached pages there is no default unless the caller sets one. Every automatic decision is an `AutoResolution` event on the page and its context (`decision: "dismiss"`, `policy: ContextOption{ name: "dialogs", value: "dismiss" }`) and is recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that a handler or the policy is resolving waits within its deadline, normally just a round trip. Under `"leaveOpen"` it fails immediately with a hint naming the dialog: the shared reason `PromptBlocking{kind, text}`, in `LocatorError` and `PageError`. That includes the click that opened it, whose dispatch `MayHaveBeenSent`, and an expectation on the page fails at once too. What blocks differs by browser: Chromium and WebKit block every evaluation while a dialog is open and Firefox doesn't, and on all three the input that opens a dialog returns only once it is decided; failing on every backend keeps one rule.
- **A file chooser is data; a handler's argument adds the decisions,** as for dialogs. Every page of a context the library creates has its choosers reported and decided, so none is shown: the page's latest `FileChooser.handle` decides, with `Deadline.DefaultBudget` as read at `handle`, and otherwise the chooser is canceled and reported as an `AutoResolution` (`policy: 'fileChoosers: "cancel"'`, the one policy). On Firefox the input gets a `cancel` event as the chooser opens, before any decision, and the files a handler chooses still arrive after it; its `fileChooser` capability is `partial`. `FileInput.local` resolves a relative path with Effect's `Path`, which the layer needs for it. `FileInput.bytes` is made in the page: the bytes cross into the caller's isolated world and become a `File` set through a `DataTransfer`, with `input` and `change` dispatched, so it keeps its MIME type and needs no file system the browser shares; a chooser answered with made files has them set on its input and is let go. One call takes made files or paths, not both, since each replaces the other's.
- **Downloads go where the context says.** Left to themselves, one browser cancels downloads and two save them into the user's home, so a context the library creates decides: by default (`downloads: "temporary"`) into a temporary directory made before it and removed after it, recorded on its span; `"deny"` allows none; `{ directory }` names one the caller owns, which is never removed. A route can also abort a download's request. Every browser writes into a partial file and renames it when done, so `saveAs` and `stream` wait for completion, under the deadline in force. Progress is reported on CDP only (`downloads.progress`), and a download in progress when its context closes ends `Canceled`, whatever the backend says after.
- **Cookies are a change, not a declaration.** `set` and `remove` act once, like a click; a scope closing doesn't undo them. Reading cookies needs a controlled context, as reading storage state does.
- **What the jar says.** `listFor(url)` filters the context's cookies as a top-level request to the URL would send them: by domain, path, `Secure` and expiry, and a partitioned cookie only in its own top-level site. A `Url` scope sets a cookie for the URL's host and RFC 6265's default path. `remove` sets each match again with an expiry in the past, which every backend removes. A partitioned cookie is `Unsupported` where the backend can't set one (`cookies.partitioned`: Firefox and WebKit).
- **Storage state is the context's cookies and its open documents' origins.** `exportStorageState` reads, for every origin of a document open in the context's pages and frames, that origin's `localStorage` and IndexedDB, each database with its version and each store with its key path, auto-increment, indexes and records. A cross-site frame's origin is its page's top-level site's partition, and says so. Records are kept in a JSON-safe encoding of the library's, which keeps a `Date`, `Map`, `Set`, `ArrayBuffer` or typed array; one it can't encode, such as a `Blob`, fails the export with `Unsupported`, naming its database and store. `UserContext.Options.storageState` sets the cookies before the context's first page, then writes each origin's storage from a page of the context whose documents a route of the library's fulfills, from a frame of a page at the top-level site where it is partitioned; that page is closed before the context is returned. A partitioned cookie the backend can't set fails the context with `Incompatible{partitions}` before it is created. A partitioned origin records the top-level origin it was read under (`topLevelOrigin`), and is restored under a page there: stock WebKit keys a frame's storage by that origin, port included, where Chromium and Firefox key it by the site (QUIRKS.md, Q232). A state saved without one is restored at its site's default port.
- **Storage state is a Schema, and saving it is explicit.** `context.exportStorageState` returns the full restorable state with every secret `Redacted`, so logging it shows nothing. Writing it somewhere is a visible step through the codec: `Schema.encodeEffect(StorageState.Json)(state)` writes the secrets out in full, because that is the point of saving them, and `Schema.decodeEffect(StorageState.Json)` reads them back, validating either way. The codec is built with `Schema.toCodecJson` for that reason: Effect's default JSON encoding writes a `Redacted` as `"<redacted>"`, which is what the CLI's `--json`, MCP results and logs should show, and would empty a saved file of its secrets. A runtime test pins the difference. Diagnostic JSON of a context never contains secrets.

## Page time

```ts
// PageClock
interface PageClock {
  install(mode: Mode): Effect<Declaration.Registration, Declaration.DeclarationError | TargetGone | Timeout, Scope>   // needs before-author-script timing
  adjust(duration: Duration.Input): Effect<void, PageClockError | TargetGone | Timeout>      // controlled: advances, firing every due timer in order
  setTime(at: DateTime.DateTime.Input): Effect<void, PageClockError | TargetGone | Timeout>  // fixed or controlled: jumps; due timers fire at most once, like waking from sleep
  readonly resume: Effect<void, PageClockError | TargetGone | Timeout>                       // real time again, from now
}
type Mode =
  | { readonly mode: "fixed"; readonly at: DateTime.DateTime.Input }       // wall time frozen at `at`; timers run
  | { readonly mode: "offset"; readonly by: Duration.Input }               // wall time shifted; everything else real
  | { readonly mode: "controlled"; readonly at: DateTime.DateTime.Input }  // wall time, monotonic time, timers and frames move only when told
```

- **Effect's words.** `adjust` and `setTime` mean what they mean on `TestClock`, so a test reads the same whichever clock it moves.
- **One timeline per scope.** `page.clock` covers every document and frame of the page, because a test's time must not reset when the page navigates. Each operation is appended to a log that new documents replay. `context.clock` is the same thing, context-wide.
- **Actionability keeps working.** Readiness sampling uses native rendering, not the page's clock, so a paused clock does not stall `click`. Nothing advances page time implicitly.
- **Separate clocks.** Page time never touches library deadlines, and `TestClock` never touches the page.
- **Clock failures are `PageClock.PageClockError`:** `NotInstalled`, `WrongMode{mode}`, `InvalidInput` (a time or duration that doesn't parse) and `BackendFailure`.
- **The clock is the library's.** No backend has an application clock to drive, so `install` adds a script of ours to each document's main world, before the page's own, which replaces `Date`, `performance.now`, and on a controlled clock the timers and animation frames; operations reach every current document of the scope by evaluation there, and a new document starts where the timeline is. `resume` turns any mode into an offset from the time the clock shows, and moves a controlled clock's waiting timers to real ones. A document loaded before `install` gets the clock then; what its scripts captured before keeps real time. Workers, CSS animations and `document.timeline` keep real time, except dedicated workers under `install(mode, { workers: true })` (Init scripts in workers, above). A page's clock and its context's can't both be installed (`Conflict`). The shim's controls are on a symbol a page that enumerates the window's symbols can find.

## Capabilities

```ts
page.capability(Capability.AxTree)         // Effect<AxTreeReader, CapabilityError | TargetGone | Timeout, Scope>   — reason: Unsupported{capability, backend}
page.capability(Capability.Screencast)     // Effect<ScreencastControl, CapabilityError | TargetGone | Timeout, Scope>
page.capability(Capability.Video)          // Effect<VideoRecording, CapabilityError | TargetGone | Timeout, Scope>
browser.capabilities                       // Watchable<Browser.CapabilitySet>: the current set, with evidence and limitations
```

Common members are on every backend. Specialized features are reached through a capability handle bound to *this* page, so a feature from one browser can't authorize an operation on another.

- **A video file.** `page.capability(Capability.Video)` gives a `VideoRecording` whose `file` completes with the WebM's path once the capability's scope has closed: Firefox's alone, where it was launched by the program and the context downloads somewhere.
- **The accessibility tree has its frames.** `AxTree`'s `read` stitches each iframe's tree in under its `Iframe` node, read on the session that owns the frame, so a cross-site frame out of process is there too.

## Agents

```ts
const snap = yield* page.snapshot()                    // aria + inferred interactivity; e.g. `- clickable "Add to cart" [ref=e9] [inferred: cursorPointer]`
const [id] = snap.refs.keys()                          // Snapshot.RefIds come from the snapshot, already branded
const button = snap.ref(id)                            // a Locator pinned to one node; acting fails with StaleRef{why} after navigation or document.open()

// One toolkit definition serves an in-process model, an MCP server and the CLI (CLI.md).
const toolkit = yield* BrowserToolkit.make({
  context,                                             // the model works in this context; every page tool names its page
  secrets: { password: yield* Config.Redacted("PASSWORD") },   // the model sees %password%; substitution happens at dispatch
  capture: CapturePolicy.strict,                       // required: what snapshots and screenshots may contain
  browser                                              // optional: lets tabs and control reach the browser's other pages
})
// tools: pages, newPage(url, name?), tabs, control(tab | url, name?), release(page), goto(page, url), back(page),
//   snapshot(page), find(page, query, role?, exact?), click(page, target),
//   fill(page, target, text | %secret%), press(page, key), select(page, target, values), scroll(page, target),
//   screenshot(page), next(page, event, filter) → a wait handle, await(wait), expect(page, target, condition),
//   history(page, event, filter)
// parameters are Schemas: a model's "e12" is decoded to a Snapshot.RefId and checked against that page's latest snapshot
LanguageModel.generateText({ prompt, toolkit })
McpServer.toolkit(toolkit)
```

- **No tool waits after it acts.** Each result carries the outcome of the call, then a digest of what the event logs recorded since the previous call: navigations, popups, dialogs and who decided them, downloads, uncaught exceptions, console errors and failed requests. Its boundaries are calls, not time windows, and it reports what was seen without claiming what caused it.
- **Changes are diffed, not guessed.** Whether the page changed is a question for `snapshot.diff`, asked explicitly.
- **Waiting is a tool like any other:** `next` and `await` for events, `expect` for conditions.
- **Failures go back to the model.** Tools are `effect/ai` `Tool`s with `failureMode: "return"`, so a `LocatorError`, `Timeout` or stale ref reaches the model as data, hint included, instead of ending the conversation. Because results and errors are Schemas, they encode for the model without a hand-written serializer.
- **As built.** The tools are `pages`, `newPage`, `tabs`, `control`, `release`, `goto`, `back`, `snapshot`, `find`, `screenshot`, `click`, `fill`, `press`, `select`, `scroll`, `next`, `await`, `expect`, `history`, `route` and `dialog`, defined once in `BrowserToolkit.toolkit`; a failure is a `BrowserToolkit.ToolFailure`, the library error's tag, its reason's and its message. Each result is `{ outcome, sinceLast }`. Pages are named as they are created (`newPage`'s `name`, or `p1`, `p2`…) or first seen; `newPage` checks its `name` before it opens a page, and closes the page again when its navigation fails, so a failed call leaves no page. A target is a ref from the page's latest snapshot, refused with a hint naming the page whose snapshot it came from, or `role=button[name="Save"]`, `text="Add"` (exact) or `text=Add`, `label=…`, `testid=…` or `css=…`. `select` chooses by label, as the snapshot names options. `route` and `dialog` declare for the toolkit's scope and answer a registration (`r1`). `find` searches the latest snapshot for refs by name or text; `history` narrows console messages by `level` and network to the `failed`; and, for a toolkit given the `browser`, `tabs` lists the browser's other pages, `control` takes one, named, and `release` gives it back. The tools that act bring their page to the front first (QUIRKS.md, Q167). `CapturePolicy.strict` sends no screenshots, masks editable fields' text and all validation messages in snapshots as `•••`, preserves invalid state and refs, and leaves console text out. Its redacted snapshots show `[invalid] [validationMessage="•••"]` without the reason's text; `CapturePolicy.local` uses full snapshots that retain field text and messages, and allows screenshots and console text. A `%name%` in a parameter is a secret's value only when `secrets` has that name, and any other, such as a URL's `%C3%`, is sent as written (QUIRKS.md, Q250); every result has a secret's value put back as `%name%`. `strider mcp` serves the toolkit to an MCP client for a CLI session (CLI.md).

Snapshots:
- **Many sites aren't accessible.** Clickable `<div>`s have no role and icon buttons have no name, so the default `snapshot()` adds two kinds of inferred information to the accessibility tree:
  - *inferred interactivity:* click listeners where the backend can list them, `cursor: pointer`, `tabindex`, `contenteditable`, `onclick`;
  - *inferred names:* visible text, `title`, `placeholder`, `alt`, a nearby label.
- **Every inference is tagged with its evidence** in both the value and the text, so a model or a reader can tell `button "Save"` from `clickable "Save" [inferred: cursorPointer]`.
- **`snapshot({ sources: "aria" })` is the pure accessibility tree,** which `Expect.toMatchAria` matches against.
- **The tree is the engine's,** the one `getByRole` matches, the same on every backend. An element with no role gives its children to its parent; hidden elements are left out; text is a `text` node unless it only repeats its parent's name, so a list item's text is its child, since a list item's name doesn't come from its content; an iframe is an `iframe` node with its frame's tree inside, whose refs are prefixed (`f1e3`). Click listeners aren't inferred on any backend yet (`snapshot.clickListeners`).
- **Same node, same ref** while its document lives, so a renamed button keeps its ref. `generation` names the engine's ref table for the document. A ref never rebinds: its node removed is `StaleRef{Detached}`, its document replaced `Replaced`, a ref no snapshot of the document gave `OtherSnapshot`, and a table installed again `BindingLost`.
- **Diffs are explicit** (`snapshot.diff(previous)`), never an automatic switch between full and delta output.
- **Visual-only UIs** (canvas, maps) need screenshots and coordinate actions. The toolkit offers those as an explicit tool set rather than a fallback.

## Recordings: traces and HAR

```ts
// Trace
declare const record: (target: UserContext.UserContext | Page.Page, options?: Options | undefined) =>
  Effect<Recording, TraceError, Scope>                   // with no options: spans, logs, errors and console; nothing captured from the page
interface Options {
  readonly screenshots?: "perAction" | "off" | undefined                                    // default "off"
  readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" | undefined  // native on Firefox: its video; default "off"
  readonly domSnapshots?: boolean | undefined                                               // default false; needs network: true
  readonly network?: boolean | undefined                                                    // default false; HAR entries, so snapshots render with their resources
}
interface Recording extends Declaration.Registration {
  exportTrace(path: FilePath.Local | string): Effect<FilePath.Local, TraceError>          // Playwright's trace-viewer zip, format 9
}

// Har
declare const record: (target: UserContext.UserContext | Page.Page, options: Options) => Effect<Recording, HarError, Scope>
interface Options {
  readonly content: "embed" | "attach" | "omit"          // required: never inferred from a file extension
  readonly detail?: "full" | "minimal" | undefined       // default "full"
  readonly url?: Url.Pattern | string | undefined        // default: every request
  readonly webSocketFrames?: boolean | undefined         // default false; Unsupported on BiDi
  readonly inFlightAtStop?: "wait" | "markIncomplete" | undefined   // default "markIncomplete": stopping never waits unless asked
}
interface Recording extends Declaration.Registration {
  readonly entries: Watchable<number>
  exportHar(path: FilePath.Local | string, options?: ExportOptions | undefined): Effect<FilePath.Local, HarError>   // redacted unless include names a SecretClass
}
type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText" | "requestBodies"
```

- **Spans are the record.** Every operation is already a span (Conventions, "One span per operation"), so whatever tracer you install already receives the trace: `effect/observability`'s OTLP exporters for any OpenTelemetry backend, or `effect/devtools` to watch it live in Effect's DevTools. `Trace.record` adds what spans can't carry: page-side captures (screenshots, screencast, DOM snapshots) as span attachments, and the export.
- **Playwright's zip is one export.** `exportTrace` writes format version 9, which Playwright's trace viewer opens (research/playwright-trace-format.md). The archive, like a HAR recorded with `content: "attach"`, is written with `effect/encoding`'s `Zip` (Effect 4.0.6, experimental), so both modules are `@stability experimental`.
  - The viewer rejects files newer than itself, and version 10 is unreleased.
  - Spans become the viewer's nested steps, and logs and errors become its log and error events.
  - Actions carry our own names, never Playwright's, because the viewer special-cases Playwright's names and assumes their selector syntax.
  - Timestamps come from a real monotonic clock, never Effect's `Clock`, so `TestClock` can't freeze them.
- **Levels are opt-in, and their costs are stated.**
  - Actions, logs, errors and console output are always recorded.
  - Screenshots and the screencast cost bandwidth. BiDi has no native screencast, so it is polled at the interval you choose.
  - DOM snapshots are a capture of our own, in the engine's world, which changes nothing in the page and hooks nothing (below). They still need control, as every level does: `record` takes a `Page` or a context, never a page you may only inspect, and snapshots need `network: true`, whose body collection is a declaration.
- **Exports are explicit and redacted.** Both files cross a persistence boundary (`export*`). Classified fields are stripped under the active diagnostics preset, and raw content (bodies, snapshots, screenshots) is included only when asked for.
- **Recording failures** are `Trace.TraceError` and `Har.HarError`: `WriteFailed{path}`, `NotPermitted`, `Unsupported` (a level the backend lacks) and `BackendFailure`; a HAR's `url` that doesn't compile is `InvalidInput`. A target whose grant was released is `TargetGone{AccessReleased}`.
- **HAR recording** records requests as sent. Timings follow the HAR spec, and an entry without a body says why. On BiDi, the body collectors start when the recording scope is acquired (research/har.md).
- **As built.** A HAR has one entry per hop, from the target's requests, with the response and its end; a body is read as its hop finishes, and an export waits for those reads but never for a hop still in flight, which is `_incomplete` unless `inFlightAtStop: "wait"`. Timings are the library's own: `send` 0, `wait` from the request to the response, `receive` to the end, and `blocked`, `dns`, `connect` and `ssl` -1, since no backend reports them alike; `startedDateTime` is wall time anchored as the recording starts. On Chromium the headers are the ones the network sent and received, cookies included (QUIRKS.md, Q158); so are a `NetworkResponse`'s, while a `NetworkRequest`'s are the ones Chromium's main event gives. A recording on Chromium keeps a document's body after the page has left it (Q160), and so does one on WebKit, whose adapter reads it as its load finishes (Q179). `content: "attach"` writes one zip, `har.har` and the bodies it names by `_file`. A trace's steps are the library's operations on the target, through the span helper, nested under the caller's spans, which each span the operations recorded in them; `exportTrace` writes `trace.trace`, `trace.network` and the screenshots, frames and bodies in one zip. Entries carry Playwright's `_monotonicTime`, `_resourceType`, `_frameref`, `_transferSize`, `_failureText`, `_file` and `_webSocketMessages`, and our `_servedBy` and `_incomplete`.
- **DOM snapshots, captured our own way** (research/playwright-trace-snapshots.md). With `domSnapshots: true` (and `network: true`, else `InvalidInput`), every frame of the action's page is captured before and after each action and navigation, as `frame-snapshot` events the viewer renders: written from scratch to the viewer's format, in each document's engine world, apart from the page. A node unchanged since the frame's last capture is a reference to it; live state is the viewer's attributes (values, `checked`, `selected`, scroll offsets, open shadow roots, adopted sheets, open popovers and dialogs, canvas and iframe boxes, `currentSrc`, defined custom elements); the action's target, resolved by its locator, is marked in the capture after it; each iframe points at its frame's own capture. With no hooks in the page, every capture reads each stylesheet's `cssRules`: a `<style>`'s text, an adopted sheet's `template`, and a same-origin linked sheet as a resource override, by reference while unchanged; a cross-origin one renders from `trace.network`. Under the strict preset, the export writes a password input's value, and a field's filled with `Redacted` text, as `REDACTED`. The viewer draws canvases from screenshots (QUIRKS.md, Q192). A recording's captures in a document are one stream, so two recordings never refer into each other's, and a frame's capture that fails is left out and followed by one with no references.
- **Firefox's video** (`Capability.Video`). Firefox writes a WebM file of a page while the capability's scope lives, into the directory its context downloads to; Chromium and WebKit stream frames instead (`Screencast`), and an attached Firefox, or a context that denies downloads, is `Unsupported`. A trace's `screencast: "native"` on Firefox records each page's video, which the first export stops and adds as a `video` event, with its size read from the file (Q193).
- **HAR replay is a route,** `Route.fromHar` (Routes, above), because mocking the network is `route`'s job.
- **Requests' bodies** (QUIRKS.md, Q164). A recording reads the body each hop's request sent as the hop ends, whatever `content` says; a body collection for requests is declared for it, which BiDi needs before the request. An export writes `postData` only when `include` names `"requestBodies"`, since a body can hold a password, and writes `bodySize` always: text for a textual type, with a form's `params`; otherwise base64 with `_encoding` when embedded, or a file beside the HAR when attached. Chromium keeps only a request's last body, so an earlier hop's that its event didn't carry, such as a file's redirected by a `307`, is left out (Q182); WebKit reports a file's part without its bytes (Q184).

## Testing

**Vitest first, ready for etest.** Everything a test needs is a Layer or a scoped Effect with a lifetime. Runner specifics sit behind one per-test service, `TestRun`. When `@effect/test` (etest) is ready, an etest adapter attaches the same Layers with `Test.provide` (research/effect-test-runner.md).

```ts
import { layer } from "@effect/vitest"
import { Config, Effect } from "effect"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { VitestBrowser } from "@usestrider/vitest"

layer(VitestBrowser.layer(Chromium.layerConfig({ executablePath: Config.String("CHROMIUM_PATH") })))("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()      // a fresh context and page per test, closed after
      yield* page.goto("https://shop.example.com")
      // …
    }))
})
```

```ts
// @usestrider/browser/test: runner-agnostic
interface TestRun {                                      // per test, from the runner adapter
  readonly info: TestInfo                                // project, file, id, attempt, worker, shard
  attach(artifact: TestArtifact): Effect<void>           // Vitest: recordArtifact
}
declare const TestRun: Context.Service<TestRun, TestRun>

// @usestrider/vitest
declare const layer: <E, R>(backend: Layer<Browser.Browser, E, R>) => Layer<Browser.Browser | TestRun.TestRun, E, R>   // the backend you pass, unchanged, plus TestRun from the current test

// Browser: the fake browser, for event and lifecycle tests
declare const layerTest: (timeline: string) => Layer<Browser>   // the first page opened plays a marble timeline on Effect's clock
```

- **A test is a program.** A test gets its page from `Browser.newPage()`, the same accessor a script uses, so there is no test-only way to open one (principle 22).
- **Nothing changes because it's a test.** The layer launches exactly the backend you pass. Profile, focus, diagnostics and tracing are whatever the test chose, as anywhere else: a suite that runs many pages at once says `Chromium.layer({ profile: LaunchProfile.concurrent })` and `Browser.newPage({ focus: "emulated" })`, and a test that wants a trace calls `Trace.record` and attaches the export with `TestRun.attach` (under Vitest, `recordArtifact`).
- **Lifetimes.** One browser per layer block, which is about one per file under Vitest's default isolation, and a fresh context and page per test. Deadlines run on the clock the browser runs on: a real browser's live clock even under `TestClock`, and for `Browser.layerTest`, whose timeline runs on Effect's clock, that clock, so a test adjusts it past a deadline to see one pass.
- **Parallelism** (research/test-parallelism.md). Files run in parallel across Vitest workers, each with its own browser. Concurrent tests within a file are opt-in (`layer(…, { concurrent: true })`). One browser for a whole run waits for etest's run-wide shared layers.
- **The fake browser is `Browser.layerTest(timeline)`,** named like Effect's `layerTest` and `layerNoop` layers. Its marble timeline (PROBES.md, "Deterministic model tests") scripts model events on Effect's clock, so under `TestClock` it moves only as the test adjusts it: `-` is 10 ms, `commit` commits a document at `https://example.test/`, `load` makes it complete, `resp(name)` answers a request for `https://example.test/name`, `dialog(kind)` opens a prompt, `popup` a popup, and `crash` and `|` end the page. Its facts are folded by the same model as a real backend's. It has no DOM: locator actions and reads fail with `Unsupported`, so it tests what happens around events and lifetimes. It is `@stability experimental` until the model tests have exercised it.
- **Contexts don't isolate everything.** Launch flags, the downloads directory, browser-wide commands, extensions, and OS focus, clipboard and GPU are shared. The library always scopes commands to the context it owns.
- **No fixture magic.** Everything is a `Layer`, and dependencies are tracked in `R`.
- **`Expect` and etest's assertions.** Under etest, `Expect` will fail with `AssertionError`-shaped data and record into the attempt's `AssertionRecord`. It keeps its own retry loop, because it re-checks on change signals, which etest's interval-based `eventually` can't do.

## Errors as users see them

```ts
// Reason: shared reasons, each a Schema.Error class with a hint
class NotPermitted extends Schema.Error<NotPermitted>("@usestrider/browser/Reason/NotPermitted")({
  _tag: Schema.tag("NotPermitted"),
  required: Schema.Literals(["inspect", "control", "browserWide"]),
  hint: Schema.String                                    // "call `.control` on this page"
}) {}
// InvalidInput{input, expected}, Unsupported{capability, backend}, BackendFailure{kind, method, cause},
// EvaluationThrown{exception}, NotSerializable{path}

// Locator: the module's own reasons, then the module's error
class StrictViolation extends Schema.Error<StrictViolation>("@usestrider/browser/Locator/StrictViolation")({
  _tag: Schema.tag("StrictViolation"),
  candidates: Schema.Array(Schema.Struct({ description: Schema.String, visible: Schema.Boolean })),
  suggestions: Schema.Array(Schema.String),              // e.g. getByRole('button', { name: 'Save' })
  hint: Schema.String
}) {}
class LocatorError extends Schema.TaggedError<LocatorError>(LocatorErrorTypeId)("LocatorError", {
  operation: Schema.String,                              // e.g. "click"
  locator: Schema.String,                                // the query, or its describe label
  reason: Schema.Union([StrictViolation, StaleRef, NotEditable, FileUnreadable, Reason.InvalidInput,
    Reason.EvaluationThrown, Reason.NotSerializable, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure]),
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [LocatorErrorTypeId] = LocatorErrorTypeId
  override get message() { return `${this.operation} ${this.locator}: ${this.reason.message}` }   // the reason's message includes its hint
}
// PageError, UserContextError, DownloadError, DeclarationError, SubscriptionError, RouteError, ResponseError,
// CookieJarError, OriginStorageError, KeyboardError, MouseError, JSHandleError, BrowserWorkerError,
// FileChooserError, SnapshotError, PageClockError, CapabilityError, TraceError, HarError and BrowserError
// follow the same shape, each in its module, each with an is* guard

// Target and Deadline: the two that cross every module
class TargetGone extends Schema.TaggedError<TargetGone>(TargetGoneTypeId)("TargetGone", {
  target: Description, reason: CloseReason, diagnostics: Diagnostics.Diagnostics }) {}
// CloseReason = Schema.Union of Schema.Error classes in Target (BrowserClosed, PageClosed{by}, FrameDetached, ObligationEnded,
// DownloadEnded, HopEnded, Vanished (no cause seen), ...),
// each with a hint that its message includes, built as `new Target.PageClosed({ by: "command" })`;
// Effect.catchReason("TargetGone", "PageClosed", (closed) => ...) matches one
class Timeout extends Schema.TaggedError<Timeout>(TimeoutTypeId)("Timeout", {
  operation: Schema.String,
  phase: Schema.Literals(["resolving", "waitingForCondition", "dispatchedUnconfirmed", "postcondition", "waitingForEvent"]),
  budget: Schema.Duration,
  last: Schema.Option(Diagnostics.ObservedValue), history: Schema.Array(Diagnostics.ObservedValue),
  hint: Schema.Option(Schema.String), diagnostics: Diagnostics.Diagnostics }) {}

// recovery reads naturally:
locator.click().pipe(
  Effect.catchReason("LocatorError", "StrictViolation", (violation) => Console.log(violation.suggestions)),
  Effect.catchTag("Timeout", (timeout) =>
    timeout.phase === "dispatchedUnconfirmed" ? recheckState : Effect.fail(timeout))
)
```

`Diagnostics.Diagnostics` is the shared envelope: `operationId`, `dispatch`, `progress`, `lastObserved` and `cleanup`. It is rendered under the active preset (README.md). Because every error is a Schema, the CLI and the agent toolkit encode failures as data, envelope and hint included.

Every operation that sends the browser a command can time out, a declaration's or a cookie read's as much as a click's. The command waits for its reply until the operation's deadline, not for `Protocol.CommandTimeout`, which governs only what's sent outside an operation, such as cleanup. A read the browser never answers times out in the phase `resolving`, and a change it never confirmed in `dispatchedUnconfirmed`. A page or context whose creation finishes after the deadline is closed once it exists, and cleanup is never cut short by an operation's deadline.

A `Timeout` that leaves an operation is that operation's. One a step ran out with keeps the step's `phase`, `history` and `hint`, which say where it stopped, and takes the operation's `operation`, `budget` and diagnostics: `progress` lists its steps, each `ok`, `unsent`, `uncertain` or `rejected`, and `dispatch` is the furthest any step got. Inside the operation's body, a step's `Timeout` is still the step's, so `Effect.catchTag("Timeout", …)` around a click catches the click's. A wait bounded by `Operation.bound` times out in the phase the record shows: `postcondition` after a step that sent succeeded, `dispatchedUnconfirmed` after `markSent`, `waitingForCondition` after `observe`, otherwise `resolving`.

## Call sites (acceptance scenarios)

These are the checks for this layer. If a scenario needs protocol knowledge or repeated ceremony, the model underneath is wrong. They are type-checked in `packages/browser/scenarios/acceptance.ts`, and their requirement channels are pinned in `packages/browser/typetest/acceptance.tst.ts`.

```ts
// 1. Log in once, reuse the session
const json = yield* Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto("https://app.example.com/login")
  yield* page.getByLabel("Email").fill("me@example.com")
  yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
  yield* page.getByRole("button", { name: "Sign in" }).click()
  yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
  const state = yield* page.context.exportStorageState
  return yield* Schema.encodeEffect(StorageState.Json)(state)   // the persistence boundary: secrets written out
}))
const page = yield* Browser.newPage({ storageState: yield* Schema.decodeEffect(StorageState.Json)(json) })

// 2. Click, then wait for a named outcome
const namedOutcome = Effect.fn("namedOutcome")(function*(page: Page.Page) {
  const orders = yield* PageNavigation.next(page, { url: "https://app.example.com/orders" })   // subscribed before the click
  yield* page.getByRole("link", { name: "Orders" }).click()
  return yield* orders
})

// 3. Popup with a dialog inside it
const popups = yield* Popup.next(page)
yield* page.getByText("Connect account").click()
const popup = yield* popups              // a Page, owned by the scope that acquired `page`
yield* Dialog.handle(popup, Dialog.acceptAll)            // a dialog blocks its page, so the decision is registered first
yield* popup.getByRole("button", { name: "Allow" }).click()

// 4 + 9. Response body, decoded and filtered
const added = yield* NetworkResponse.next(page,
  { url: "https://app.example.com/api/cart", method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
  (response) => Effect.succeed(response.body.items.length > 0))   // where: typed from the decoded body
yield* page.getByRole("button", { name: "Add to cart" }).click()
const response = yield* added            // CapturedResponse<Cart>

// 5. Download
const download = yield* Download.next(page)
yield* page.getByText("Export CSV").click()
const file = yield* download
yield* file.saveAs("./export.csv")

// 6. Concurrent pages, settings isolated by context
yield* Effect.forEach(urls, (url) => Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage({ emulation: { locale: "de-DE" } })   // context + page released per URL
  yield* page.goto(url)
  return yield* page.title
})), { concurrency: 4 })

// 7. Attach, inspect one tab, control another, leave both open
const browser = yield* Browser.Browser                  // provided by Chromium.layerConnect(endpoint)
const [first, second] = yield* browser.pages
yield* Effect.scoped(Effect.gen(function*() {
  const reader = yield* first.inspect
  const text = yield* reader.getByRole("heading").readText
  const tab = yield* second.control
  const blocked = yield* tab.route("https://*.example.com/analytics/**", () => Effect.succeed(Route.abort()))
  yield* tab.getByRole("button", { name: "Refresh" }).click()
  yield* Console.log(`blocked ${yield* blocked.hits} analytics calls`)
}))                                                     // route and access released; both tabs stay open
// On Firefox, a tab in the background renders about once a second, too seldom to act on: `yield* tab.activate` first (QUIRKS.md, Q71)

// 8. Log requests until the page closes
const requests = yield* NetworkRequest.stream(page, { resourceType: "fetch" })   // subscribed now, so nothing is missed
yield* requests.pipe(
  Stream.runForEach((request) => Console.log(request.method, request.url)),
  Effect.forkScoped)                                     // background; ends normally on close, fails on crash

// 10. Paused application time
yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
yield* page.goto("https://app.example.com/session")
yield* page.getByRole("button", { name: "Start" }).click()   // no page time passes
yield* page.clock.adjust("5 minutes")
yield* page.getByText("Session expired").pipe(Expect.toBeVisible)

// 11. Ordered setup scripts
const helper = yield* page.addInitScript(installTestHooks)
yield* page.addInitScript(useTestHooks, { after: [helper] })   // dependencies only on equal or broader scope

// 12. Operational failures stay typed and evidenced; deadlines are cross-cutting
yield* page.locator("button[").click().pipe(            // invalid selector: immediate, no waiting
  Effect.catchReason("LocatorError", "InvalidInput", (reason) => Console.log(reason.hint)))
yield* page.getByRole("button", { name: "Pay" }).click().pipe(Deadline.within("5 seconds"))

// 13. One action, several outcomes, collected later
const checkout = yield* Popup.next(page)
const order = yield* NetworkResponse.next(page, { url: "https://app.example.com/api/order" })
yield* page.getByRole("button", { name: "Pay" }).click()
const [tab, placed] = yield* Effect.all([checkout, order])   // each latched, even if it arrived during the click

// 14. Watch state while doing other work
const pdf = yield* Download.next(page).pipe(Deadline.within("2 minutes"))   // the wait's budget, set where it starts
yield* page.getByText("Export PDF").click()
const report = yield* pdf
yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped)   // fork first: watching shows the present
yield* page.status.waitFor((status) => status._tag === "Open" && status.document.readiness === "complete")
yield* report.finished

// 15. What already happened: reads, not subscriptions
const errors = yield* UncaughtException.history(page)   // Subscription.History: entries, oldest first, and how many were dropped
const carts = yield* NetworkResponse.history(page, { url: "https://app.example.com/api/cart" })   // metadata only, never bodies

// 16. Structure, matched explicitly
yield* page.getByRole("navigation").pipe(Expect.toMatchAria(
  AriaPattern.node("navigation", "Main", AriaPattern.including(
    AriaPattern.node("link", "Orders", AriaPattern.unchecked)))))

// 17. An operation of the program's own: one deadline, and a Timeout named for it that says how far it got
const checkout = Operation.fn("checkout")(function*(page: Page.Page, card: string) {
  yield* page.getByLabel("Card number").fill(card)
  yield* page.getByRole("button", { name: "Pay" }).click()
  return yield* Operation.bound(confirmation(page))   // past the deadline: Timeout{checkout, postcondition}, its steps ok
}, Deadline.within("20 seconds"))

// 18+. Input held across steps, frames, cookies, origin storage, emulation, workers, WebSocket frames,
//      reads and handles, tests and the fake browser are in packages/browser/scenarios/areas.ts, type-checked.
```

## Open questions

1. **How the Vitest adapter finds the current test.** @effect/vitest passes Vitest's test context to `it.effect` as an argument, not as a service, so `VitestBrowser.layer` can't read it from the environment. Recommendation: propose that @effect/vitest provide it as a service in every `it.effect`. Until then, tests pass it explicitly. Since answered: Vitest 5's `TestRunner.getCurrentTest()` names the running test, and `TestRun.info` reads it each time.

Decided:
- **The fake browser is `Browser.layerTest(timeline)`,** public and `@stability experimental` (revision 5.25). It doesn't emulate a DOM: actions against fake pages fail with `Unsupported`. This replaces "internal first, a narrow `@usestrider/browser/testing` subpath later" (5.13).
- **No `BrowserTest` helpers.** A test opens its page with `Browser.newPage()` (5.25, reversing 5.18 and 5.21).
- **No Vitest reporter plugin.** The library stays runner-agnostic, and flakiness is classified from `test.retry` / `test.outcome` span attributes and `TestInfo`.
- **Testing ships for Vitest first, behind `TestRun`,** so that moving to etest is a new adapter, not a redesign (revision 5.18).
