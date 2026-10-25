# Design review: tooling

*2026-10-24. Review of commit `1f9c474` (attaching and access built, after review 19) on batch 5, the last of the five proposed after review 14, and everything else the package still only declares:*

- *the rest of the API surface: `LaunchProfile`'s values, `Diagnostics`' presets, `FileInput.bytes`, `AriaRole.all` and `isAriaRole`, `goto`'s `accept`, `close({ runBeforeUnload: true })`, and the tracing references `SpanNameGenerator`, `TracerDisabledWhen` and `TraceProtocolCommands`;*
- *capabilities: `Page.capability` with `AxTree` and `Screencast`;*
- *testing: `TestRun`, `VitestBrowser.layer` and `Browser.layerTest`;*
- *recordings: `Har.record` and `Trace.record`;*
- *agents: `BrowserToolkit` and `CapturePolicy`;*
- *the CLI: sessions, commands, segments (`CurrentSession`) and export (CLI.md).*

*Prompted by the maintainer: "Batch 5 let's go". This commit records the review only.*

Every earlier batch built a layer of the library that programs run on. This one builds what sits beside it: the tools that run, record and drive those programs. Almost all of it is L1 and L2 over mechanisms that exist, with three exceptions: the adapters don't report a response's status text or HTTP version, which a HAR needs; they expose no accessibility tree or screencast, which the capabilities are; and nothing renames or suppresses the library's spans, which every operation opens directly.

It is the largest batch so far, so it is built in three steps, each one committed and pushed when its tests pass on every backend: the API surface, capabilities and testing (candidates 1 to 3); recordings (candidate 4); and agents and the CLI (candidates 5 and 6).

`WebKit.layerAttach` stays unbuilt: stock WebKit's protocol is a backend of its own (review 19).

## What the browsers do

Probed through the public API, the adapters (with their raw events printed, then reverted) and a raw CDP session, on the pinned builds (throwaway tests, not kept).

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** Files made in the isolated world (`new File([bytes], name, { type })` through a `DataTransfer`) set on a file input, `input` and `change` dispatched | the page's listener reads each file's name, type, size and content as made | the same | the same |
| **P2.** A response's status text and HTTP version | `statusText`, `protocol` (`http/1.1`) in `responseReceived` | `statusText`, `protocol` in `responseStarted` | `statusText` in `responseReceived`, `protocol` in `loadingFinished.metrics` |
| **P2.** A response's timings | offsets in milliseconds from `requestTime`, in seconds since an arbitrary origin (`sendStart`, `receiveHeadersEnd`) | absolute milliseconds since the epoch (`requestStart`, `responseStart`, `responseEnd`), DNS and connect where they happened | relative to the resource's `startTime` (`requestStart`, `responseStart`); sizes in `loadingFinished.metrics` |
| **P3.** An accessibility tree | `Accessibility.getFullAXTree`: every node, ignored ones included, with its role, its name and where the name came from, and properties | none in WebDriver BiDi | per node only (`DOM.getAccessibilityPropertiesForNode`) |
| **P4.** A screencast | `Page.startScreencast`: a frame per visual change (ten a second under a 100 ms timer), epoch-second timestamps, each frame acknowledged | none in WebDriver BiDi | `Screencast.startScreencast` in the protocol, frames with their size |

## Candidates

### 1. The rest of the API surface

**Where:** `LaunchProfile`, `Diagnostics`, `FileInput`, `AriaRole`, `Page`, `Browser`; `src/internal/spans.ts` (new); the protocol client.

**What changes.**

- **`LaunchProfile.stock`, `automation` and `concurrent`** are values: each names the Chromium arguments and Firefox preferences the launchers already apply, so a profile can be read before it is used, and a launch's span records the one it used.
- **`Diagnostics.CurrentPreset` and `withPreset`.** The reference defaults to `"strict"`. Under it, a URL in a span attribute or a log keeps its origin and path, with each query value replaced by `REDACTED`, and no fragment; under `"local"` it is shown whole. Typed text is `Redacted` under both.
- **`FileInput.bytes(name, mimeType, data)`** is a file made in the page: the bytes cross into the isolated world and become a `File` set on the input through a `DataTransfer`, with `input` and `change` dispatched (P1). Its MIME type is kept, and no file system is shared with the browser, so it works with a browser the program attached to.
- **`AriaRole.all`** is the set of roles the type names, and **`isAriaRole`** tests a string against it.
- **`goto({ accept })`.** An accepted download is `PageNavigation.BecameDownload{id, url}`, and an accepted 204 `NoContent{id, url, response}`: `PageNavigation` gains those two variants, which only `accept` returns.
- **`close({ runBeforeUnload: true })`** runs `beforeunload`; the prompt is decided as any dialog is, by the page's handler or its context's policy, and `stay` fails the close with `CloseCanceled`, the page usable.
- **One helper opens every operation's span.** It reads `SpanNameGenerator` for the name and `TracerDisabledWhen` to suppress it, and it is where recordings learn of operations (candidate 4). **`TraceProtocolCommands`** opens a child span for each protocol command in the client.

**Recommendation.** Adopt.

### 2. Capabilities

**Where:** `Capability`, `Page.capability`; the adapter contract.

**What changes.**

- **`Page.capability(c)`** acquires a feature bound to the page for the caller's scope, with inspect access. A backend without it fails with `CapabilityError{Unsupported}` naming it.
- **`Capability.AxTree`** reads the browser's own accessibility tree: CDP's full tree, ignored nodes left out and their children given to their parent (P3). Firefox and WebKit have none (`capability.axTree`).
- **`Capability.Screencast`** streams the page's frames from acquisition until its scope closes: CDP's and WebKit's (P4), each frame acknowledged as it is read; BiDi has none (`capability.screencast`).
- **The contract** gains `accessibilityTree(page)` and `screencast(page)`, a stream of JPEG frames with their monotonic time and size.

**Recommendation.** Adopt.

### 3. Testing

**Where:** `TestRun`, `VitestBrowser`, `Browser.layerTest`; `src/internal/fake.ts` (new).

**What changes.**

- **`TestRun.TestRun`** is a service tag.
- **`VitestBrowser.layer(backend)`** is the backend unchanged, plus a `TestRun` that reads Vitest's current test when asked (`TestRunner.getCurrentTest`): its `info` describes the test running when it is read, and `attach` records an artifact on it with `recordArtifact`. One layer block, one browser.
- **`Browser.layerTest(timeline)`** is a fake adapter driven by a marble timeline under `TestClock`, folded by the same model as a real backend, so events, waits and lifetimes behave as they do with a browser. The first page opened plays the timeline: `-` is a tick of 10 ms, and `commit`, `load`, `resp(name)`, `dialog(kind)`, `popup`, `crash` and `|` are model events. It has no DOM: a request for the engine fails with `Unsupported`. `@stability experimental`.

**Recommendation.** Adopt.

### 4. Recordings

**Where:** `Har`, `Trace`, `NetworkResponse`; `src/internal/har.ts`, `trace.ts` (new); the adapters.

**What changes.**

- **`NetworkResponse` gains `statusText` and `httpVersion`** (P2), which every adapter reports.
- **`Har.record(target, options)`** records a page's or context's requests from the event model while its scope lives: one entry per hop, with its request and response, and the response body read when the hop finishes, as `content` asks (`embed` in the HAR, `attach` beside it, `omit`). Timings come from the library's own clock, so they mean the same on every backend: `send` 0, `wait` from the request to its response, `receive` from the response to the end, and the phases no backend reports alike (`blocked`, `dns`, `connect`, `ssl`) are `-1`. `detail: "minimal"` drops headers, cookies and timings; `url` filters; `webSocketFrames` records `NetworkConnection` frames (`Unsupported` on BiDi); `inFlightAtStop` marks or waits. `entries` counts them.
- **`exportHar(path, { include })`** writes HAR 1.2. Cookies, `Authorization` and `Proxy-Authorization` headers, credentials in URLs, and typed text are redacted unless `include` names their class. With `content: "attach"`, the HAR and the bodies are written as one zip with `effect/encoding`'s `Zip`.
- **`Trace.record(target, options)`** records each library operation on its page or context as a step, through the span helper: its name, its attributes as params, its duration, its error, and the caller's enclosing spans as the steps it is nested in. Console messages and uncaught exceptions are recorded too. `screenshots: "perAction"` takes one after each action; `screencast` uses `Capability.Screencast` where there is one and polls screenshots where asked; `network` adds the HAR's entries.
- **`exportTrace(path)`** writes Playwright's trace format version 9 (research/playwright-trace-format.md): `trace.trace` with `context-options` and the steps, `trace.network`, and `resources/`, in a zip. Timestamps come from the monotonic clock, never Effect's `Clock`. Params are redacted under the current preset.
- **Not built: DOM snapshots** (`domSnapshots: true`): they need Playwright's capture script, vendored and pinned to a release, in the page's main world; it fails as `NotBuilt`.

**Recommendation.** Adopt.

### 5. Agents

**Where:** `BrowserToolkit`, `CapturePolicy`; `src/internal/toolkit.ts` (new).

**What changes.**

- **`BrowserToolkit.toolkit`** is the tool definitions, as `effect/ai` `Tool`s with Schemas for parameters, results and failures, and `failureMode: "return"`: `pages`, `newPage`, `goto`, `back`, `snapshot`, `screenshot`, `click`, `fill`, `press`, `select`, `scroll`, `next`, `await`, `expect`, `history`, `route` and `dialog`. Every page tool names its page.
- **A target** is a ref (`e12`), checked against the page's latest snapshot, or a locator string that maps to one query: `role=button[name="Save"]`, `text="Add to cart"`, `label=Email`, `testid=cart`, `css=…`. A bad string fails at once.
- **`BrowserToolkit.make({ context, secrets, capture })`** binds the handlers to a context. A `%name%` in a parameter is replaced by its secret at dispatch, and never appears in a result or a log.
- **No tool waits after it acts.** Each result is the call's outcome, then a digest of what the event logs recorded since the previous call: navigations, popups, dialogs and who decided them, downloads, uncaught exceptions, console errors and failed requests.
- **`CapturePolicy.strict`** sends no screenshots, masks input values in snapshot text and leaves console text out; **`local`** allows everything.

**Recommendation.** Adopt.

### 6. The CLI

**Where:** `src/bin/strider.ts`, `src/cli/`, `src/internal/cli/` (new).

**What changes.** CLI.md as written, built:

- **A daemon per session,** started by `strider start` with its browser named (`--chromium`, `--firefox`, `--webkit` or `--attach`), in the session's directory, `$XDG_RUNTIME_DIR/strider/<name>/` (the OS temporary directory where there is none). It holds the browser, the session's one context and its handles, and serves commands over a Unix socket there. It ends at `strider stop`, after its idle timeout, or when `--owner-pid` exits.
- **The client** forwards its arguments over the socket without loading Effect, and prints what the daemon answers: text, or `--json`. The daemon parses them with `effect/cli`, into the toolkit's tools and the session commands. Every command names its session (`-s` or `STRIDER_SESSION`) and every page command its page (`-p`).
- **Session commands:** `start`, `stop`, `sessions`, `page new`, `page name`, `control`, `run`, `state save`, `export test` and `prune`.
- **Segments:** `strider run file.ts` imports the file in the daemon and runs its default export with `CurrentSession` and a scope; pages it returns are named into the session.
- **`export test`** writes the session's successful commands as a Vitest test, refs as the locators their snapshots name, secrets as config.
- **Not built:** an MCP server command; `McpServer.toolkit(BrowserToolkit.toolkit)` serves the tools to a program today.

**Recommendation.** Adopt.

## Considered and not adopted

- **Recording timings as each backend reports them.** Three time bases (P2) would make one HAR mean three things; the library's clock is one, and its phases are the ones every backend reports alike.
- **`FileInput.bytes` as a temporary file.** It needs a file system the browser shares and loses the MIME type; a file made in the page needs neither (P1).
- **The browsers' accessibility trees for snapshots.** Snapshots stay the engine's (review 18); `AxTree` is the browser's own, for whoever needs it.
- **A polled screencast in `Capability.Screencast`.** A capability is what the backend has; `Trace` polls when asked to.
- **Playwright's DOM snapshot script now.** Its contract with the viewer is private and unversioned, so a vendored copy is a pinning decision of its own.
- **One daemon for every session.** CLI.md keeps one browser per session, so a crash ends one session.

## Decision

Adopted, 2026-10-24, under the maintainer's direction to build batch 5. The revisions follow this commit, in three steps, and each records where the build differs.
