# Design review: attaching and access

*2026-10-24. Review of commit `7c25851` (a page's contents built, after review 18) on batch 4 of the five proposed after review 14, all still declared but not built:*

- *connecting to a running browser: `Chromium.layerConnect`, `Firefox.layerConnect` and `Bidi.layerConnect`;*
- *access levels: `ObservedPage.inspect` and `control`, `ObservedUserContext.control`, and `TargetGone{AccessReleased}`;*
- *what a connection can see but didn't make: `Browser.pages`, the default context's `pages`, `workers` and `control`, and popups of pages it observes;*
- *call site 7: attach, inspect one tab, control another, leave both open.*

*Prompted by the maintainer: "Go for it, batch 4". This commit records the review only.*

L0 already attaches. Each adapter takes `ownership: "attached"`: the CDP adapter adopts the targets it finds and pauses only the frames and workers of pages it attached to, and the BiDi adapter adopts the browsing contexts `getTree` reports. A Chromium attach test has passed since review 08. What is missing is everything above it:

- **No public layer connects.** `Chromium.layerConnect`, `Firefox.layerConnect` and `Bidi.layerConnect` are declarations, and nothing resolves an endpoint or ends what a connection started.
- **Every handle has full control or none.** `Runtime.page` gives a handle only to pages in contexts the connection created, so a launched browser's own first tab, every tab of an attached browser and their popups have no handle at all. `inspect` and `control` fail as `NotBuilt`.
- **Access isn't held by a scope.** CONCEPTS.md §3 says an upgrade lasts as long as the scope that acquired it, and then fails with `TargetGone{AccessReleased}`; nothing implements it.

`WebKit.layerAttach`, for stock WebKit's remote inspector (Safari, WKWebView, WebKitGTK), needs stock WebKit's protocol, which differs from Playwright's and isn't generated: it is a backend of its own and stays unbuilt. Playwright's WebKit takes only a pipe, so it has no `layerConnect`. `Page.capability` (`AxTree`, `Screencast`) belongs with the tooling, batch 5.

## What the browsers do

Probed through the CDP and BiDi adapters, raw BiDi, and the browsers' HTTP endpoints, on the pinned builds (a throwaway test, not kept).

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** A launched browser before any page is created | one tab in the default context, `about:blank` | the same | the same |
| **P2.** Two tabs open when a connection attaches | adopted: each tab's document, and its main world's realm; an isolated world and an intercept work on them | the same | — (Playwright's WebKit has no endpoint to connect to) |
| **P3.** Headless with two URLs on the command line | refuses: "Multiple targets are not supported in headless mode" | opens both | — |
| **P4.** The HTTP endpoint | `/json/version` names the browser's WebSocket (`webSocketDebuggerUrl`); `PUT /json/new?url` opens a tab | none: the remote agent is WebSocket only, at `/session` | — |
| **P5.** Several clients | any number, each with its own session | one WebDriver BiDi session at a time: a second `session.new` fails "Maximum number of active sessions" | — |
| **P6.** The connection closes | the tabs stay open; what the client declared ends with its session | the tabs stay open, and the session lives on: no new session for 13 s and counting, until the browser restarts. `session.end` frees it at once; a second socket to the session's own URL is refused | — |
| **P7.** A dialog open when the client disconnects | stays open; a client attaching later is told nothing about it, and gets no document for its page while it is open | — | — |
| **P8.** The adapter's contexts at connect | as the browser reports them | the tabs land in a context of their own, not the default: Firefox reports existing contexts as `session.subscribe` is answered, before the adapter has mapped `"default"` (the adapter's) | as the browser reports them |

## Candidates

### 1. Layers that connect

**Where:** `Chromium`, `Firefox`, `Bidi`; `src/internal/connect.ts` (new); the BiDi adapter.

**What changes.**

- **`Chromium.layerConnect(endpoint, options?)`** takes the browser's WebSocket URL (`ws://` or `wss://`), or the HTTP endpoint (`http://host:port`), which it resolves through `/json/version` (P4) with Effect's `HttpClient` over the runtime's `fetch`, provided inside the layer. The span records the URL it connected to.
- **`Firefox.layerConnect(endpoint, options?)`** takes the remote agent's WebSocket (`ws://host:port`, `/session` added when the URL has no path) and starts a session. **`Bidi.layerConnect(endpoint, options?)`** takes any WebDriver BiDi endpoint as given, such as a grid's.
- **A session the connection started ends with it.** Firefox keeps a session after its socket closes, and allows only one (P5, P6), so a program that attached and finished would lock every later client out until the browser restarts. The BiDi adapter sends `session.end` when its scope closes, bounded by a second, whenever it sent `session.new`. A connect refused because another client holds the session fails with `ConnectionFailed{handshake}`, and the hint says why.
- **`ConnectOptions.headers`** go with the WebSocket handshake, and with the HTTP lookup.
- **What a connection leaves.** The browser keeps running, and the pages and contexts it didn't create stay as they were; the contexts and pages the connection created are released with their scopes, as now (CONCEPTS.md §3).
- **The session's settings are the whole browser's on BiDi.** A session's `unhandledPromptBehavior` applies to every context, so an attached session doesn't dismiss file choosers, which would cancel the user's own: it leaves them to the browser, and `fileChooser` is `partial` on it.
- **The adapter maps Firefox's default context before it subscribes** (P8).

**Recommendation.** Adopt.

### 2. Access is held by a scope

**Where:** `src/internal/access.ts` (new); `page.ts`, `locator.ts`, `browser.ts`, `handles.ts`; `Expect`, `Dialog`, `FileChooser`.

**What changes.**

- **Who controls what.** A page the connection created, or a page in a context it created, is controlled for its whole life, as now. Any other page is *observed*: a launched browser's first tab (P1), every tab of an attached browser (P2), and their popups. An observed page's handle has the observe members only: its state, frames, workers, `closed`, and the event modules, which take an `ObservedPage`.
- **`inspect` and `control` acquire a grant** in the caller's scope and return a `ReadonlyPage` or a `Page`. `inspect` installs the isolated world in the current document, or fails with `InitializationFailed{step}`; it never changes what the page shows. On a page that is controlled for its life, both return the page itself.
- **A released grant fails what it granted.** When its scope closes, every member above observe, and every locator made through the handle, fails with `TargetGone{AccessReleased}`. The declarations made through it (routes, init scripts, emulation, a clock, `Dialog.handle`, `FileChooser.handle`) are removed with it, whichever scope they were made in, so nothing a released grant made stays in force. The page stays open.
- **`ObservedUserContext.control`** grants a context for the scope: the default context, or one another client made. Its pages are `Page`s under the same grant, its `newPage` makes pages the caller owns, and its cookies, storage state and declarations work as an owned context's; released, they fail with `AccessReleased`. A page's `context`, for a page whose context isn't controlled, fails with `NotPermitted{control}`.
- **Dialogs and choosers on observed pages are nobody's to decide.** A context the connection didn't create has no policy, so a dialog waits for a handler or the user (CONCEPTS.md §5), and an operation blocked by it fails with `PromptBlocking`.
- **Handles are one per page.** An observed page, its `ReadonlyPage` and its `Page` are equal, as any two handles for one tab are.

**Recommendation.** Adopt.

### 3. What a connection sees

**Where:** the model; `Browser`, `UserContext`, `Popup`.

**What changes.**

- **`Browser.pages`** is every page of the browser, in the order they were added: `Page` handles for the pages the connection controls for their life, observed handles for the rest.
- **The default context** gets `pages` and `workers`, observed, and `control` (candidate 2).
- **Popups of observed pages** are delivered as observed pages, `LeaveOpen`.
- **A page with no document yet** is reported, but stays opening until a document commits. A page attached while a dialog is open stays so until the dialog closes (P7), and an operation on it times out with a hint that says why.

**Recommendation.** Adopt.

### 4. Tests, on every backend that can

**Where:** `test/integration/slice/`; the conformance suite.

**What changes.** A seventh slice suite:

- **Access, on all three backends,** through a launched browser's first tab and its default context: `inspect` and `control` for a scope, `AccessReleased` after it, declarations removed with the grant, the page left open, and a dialog nobody decides.
- **Call site 7, on Chromium and Firefox,** against a browser the test starts with two tabs and the layer attaches to; Chromium through its HTTP endpoint too.
- **Firefox's session,** ended with the layer so another client can connect, and refused while another holds it.

The conformance suite adds the default context's mapping on connect.

**Recommendation.** Adopt.

## Considered and not adopted

- **Reusing the browser's session.** Firefox refuses a second socket to a session started over a socket (P6), and a grid's session is the caller's to give, as its endpoint.
- **Pausing an attached browser's pages.** It would stall the user's tabs while a client starts; CDP pauses only the frames and workers of pages it attached to, as now.
- **Deciding dialogs on observed pages, or dismissing their file choosers.** They are the user's.
- **A persisted ledger of what a connection owns,** to reclaim it from a later connection. CONCEPTS.md §3 defers it: reclaiming needs the browser's incarnation and the claimant's identity verified.
- **Enforcing access per protocol command, in the adapters.** Access is a library contract (CONCEPTS.md §3); L0 stays one level, and L1 enforces it at the handle.
- **`WebKit.layerAttach`, and `Page.capability`.** A backend and a tooling batch of their own.

## Decision

Adopted, 2026-10-24, under the maintainer's direction to build batch 4. The revision follows this commit, and the build records where it differs.
