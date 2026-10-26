# Design review: everything deferred

*2026-10-26. Review of commit `ab80395` (review 21 complete) on every piece the documents still defer or list as not built. Prompted by the maintainer: "I want to flesh out the full design instead of deferring". Three directions came with it:*

- *the trace's DOM capture is written from scratch, with Playwright's as inspiration only: "I want everything to be effect native otherwise", and no dependency but `effect`;*
- *`strider control` "seems important";*
- *and a question, whether an MCP server is needed at all (candidate 3).*

*This commit records the review only.*

The list comes from PROTOCOL.md's "Not built yet" entries, CLI.md's Built section and its candidates, API.md and CONCEPTS.md's deferrals, and QUIRKS.md's open entries. Every item gets a design here. Two of them can't be built against the pinned browsers, and say why: WebMCP, which no browser ships, and stock WebKit, if it can't run on this machine.

The release work the maintainer agreed to after review 21 comes after this, since these designs change what is released. The build is in six steps, each committed and pushed when its tests pass on every backend. Integration runs go one file at a time at low priority, as the maintainer asked, so the machine stays usable.

## What the browsers do

Probed through the public API, over raw CDP and WebDriver BiDi, and against nixpkgs, on the pinned builds (throwaway tests and scripts, not kept). Tests ran one browser at a time, at low priority.

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** What a script in Strider's isolated world reads, on a page that changed its `<style>` sheet with `insertRule`, a linked sheet the same way, adopted constructed sheets on the document and a shadow root, form state, a scroll offset, a canvas and a same-origin iframe | Everything: each sheet's `cssRules` with the inserted rules, the adopted sheets' rules, the shadow root's HTML, `value`, `checked`, `selectedIndex`, `scrollTop`, `canvas.toDataURL()`, the iframe's document. `customElements` is `null`: an isolated world has no registry | Everything, through Xrays; `customElements` is the page's | Everything; `customElements` is the page's |
| **P2.** `browsingContext.startScreencast` and `stopScreencast` | — | Start answers `{ path, screencast }`; stop answers the path; the file is WebM (EBML header), 11.5 kB for 1.5 s, in the browser's downloads folder | — |
| **P3.** An HTML drag dispatched from the isolated world: `dragstart`, `dragenter`, `dragover`, `drop`, `dragend`, sharing one `DataTransfer` made there | (has native drags, Q76) | The page's `drop` handler reads the data `dragstart` set; `isTrusted` false | The same |
| **P4.** Changing a paused response's status and headers only | `Fetch.continueResponse({ responseCode, responseHeaders })` | `network.continueResponse({ statusCode, headers })`, which replaces the headers (Q93) | Only `Network.interceptWithResponse`, which needs the whole body, which WebKit can't read (Q94) |
| **P5.** WebMCP: `navigator.modelContext`, with `--enable-experimental-web-platform-features`, `--enable-features=WebMCPTesting` or `WebMCP` | Absent under all four, and no CDP domain for it | — | — |
| **P6.** Stock WebKit on this machine (nixpkgs, evaluated, not built) | — | — | WebKitGTK 2.54.1 and GNOME Web 50.4 are packaged, WPE isn't; WebKitGTK needs a display |
| **P7.** Mouse modifiers (Q72) | — | — | The adapter sends `Input.dispatchMouseEvent` with the protocol's bit field (Alt 1, Ctrl 2, Meta 4, Shift 8) to the page proxy's session, as Playwright's client does; nothing in the adapter explains the lost modifiers |

## Candidates

### 1. DOM snapshots in traces, captured our own way

**Where:** `Trace`; `src/internal/capture.ts` (new), `trace.ts`.

**What changes.**

- **A capture script of our own,** written from scratch, page-side JavaScript kept as a string the engine installs, as the engine's is. The format it writes is the trace viewer's, which trace.playwright.dev renders. Playwright's snapshotter is the reference for what the viewer expects, never code we copy or ship.
- **It runs in the isolated world, not the page's.** P1 shows an isolated world reads everything a capture needs. The page can't see the script or tamper with it, and nothing hooks the page's CSSOM methods, which is what Playwright's needs the page's world for.
- **Stylesheets come from `cssRules`, every time.** With no hooks to say which sheets changed, each capture serializes every sheet it can read: `<style>` sheets, same-origin `<link>` sheets, and constructed sheets adopted by the document or a shadow root. A sheet whose serialized text matches the frame's previous capture is a "same as N snapshots ago" reference, so an unchanged sheet costs one line. A cross-origin sheet, whose rules no world can read, is served from the HAR entry for its URL, as the viewer does for any resource.
- **The node encoding is the viewer's.** A node is text, `[name, attributes, ...children]`, or a back-reference `[[snapshotsAgo, index]]` into that frame's earlier captures, indices in post-order. The script keeps the frame's last capture in the isolated world, and a new document starts afresh.
- **Live state as the viewer's attributes:** form values, `checked`, `selected`, scroll offsets, open shadow roots, an element's box for the action's target, and a canvas as its image data. The attribute names are a private contract between Playwright's script and its renderer, with no version of its own (research/playwright-trace-format.md). The build records that contract from Playwright's source at a pinned release in a research note, which a check compares on each roll, as the protocol audit does.
- **Custom elements** are recognized by the `:defined` pseudo-class and a hyphenated name, since Chromium's isolated world has no `customElements` registry (P1).
- **Frames.** Each document is captured in its own isolated world. The iframe element in its parent points at the frame's capture, which needs the element's binding, which the engine has.
- **When.** `Trace.record({ domSnapshots: true })` captures every frame of the target's pages before and after each recorded action and navigation, as `frame-snapshot` events in `trace.trace`. Images, fonts and cross-origin CSS render from `trace.network`, so `domSnapshots` requires `network: true`. Without it the option fails with `InvalidInput` saying so, rather than turning network recording on unasked.
- **Redaction.** Under the strict preset, the value of a password input, and of a field filled with `Redacted` text, is `REDACTED` in the capture, as typed text is in spans.

**Recommendation.** Adopt.

### 2. Video: Firefox's file screencast

**Where:** `Capability`, `Trace`; the BiDi adapter.

**What changes.**

- **`Capability.Video`** records the page to a file while the capability's scope lives. On Firefox it is `browsingContext.startScreencast`, and the scope's close stops it and returns the WebM file's path (P2). The handle's `file` is an `Effect` that completes with the path once recording stops.
- **Where the browser writes it.** The file is written to the browser's downloads folder, so a browser the program shares no file system with fails `Unsupported`.
- **Traces.** `Trace.record({ screencast: "native" })` on Firefox records the video, and the export adds the trace format's `video` event with the file. Chromium and WebKit keep streaming frames, as now.
- **Chromium and WebKit can't record a video file:** only their frames come over the protocol, and encoding frames into a video needs an encoder, which would be a dependency. `Capability.Video` is `Unsupported` there.

**Recommendation.** Adopt.

### 3. Agents: an MCP command, searching a snapshot, page tools

**Where:** `src/internal/cli/`, `BrowserToolkit`.

**What changes.**

- **3a. `strider mcp`.** Is an MCP server needed? Not strictly. A program can already serve the toolkit itself with `McpServer.toolkit(BrowserToolkit.toolkit)`, and an agent that runs shell commands is better served by the CLI, which costs its context nothing until it runs a command. An MCP command is for clients that can't run commands, such as desktop chat apps and IDE chat panels. Built, it is a front end to a session, never a second way to hold a browser:
  - `strider mcp -s shop` serves session `shop`'s tools over stdio and forwards each call to the session's daemon, so an agent over MCP and a person at the shell share pages, refs and waits;
  - `strider mcp --start --chromium <path>` starts a session for the client, which ends when the client disconnects, unless `--keep`;
  - it uses `effect/ai`'s `McpServer` and the daemon's socket, and nothing else.
- **3b. Searching a snapshot.** A `find` tool, and `strider find`, query the page's latest structured snapshot by role, name or text, exact or not. They return the matching refs, each with its role, its name and its path in the tree, so an agent can target an element without printing the whole page. Refs it returns are targets as any ref is.
- **3c. Tools a page provides (WebMCP).** The draft API has a page register tools with `navigator.modelContext.registerTool`, and only the browser lists them. No pinned browser ships it (P5).
  - **Design:** an init script in the page's world wraps `registerTool` and `unregisterTool` before the page's own scripts, and keeps the tools on a symbol only the library knows (as the page clock does, Q108). `Page.modelTools` is a watchable of their names, descriptions and input schemas. The toolkit's `pageTools` lists them, and `callPageTool` calls one with arguments the model gives, checked against the tool's schema. Every result is marked as the page's, untrusted input. `@stability experimental`.
  - **Testing:** a fixture page that implements the draft API itself, as pages using a polyfill do.

**Recommendation.** Adopt 3b. Adopt 3a as a session front end, unless the maintainer would rather not have it (Questions, below). Adopt 3c's design; whether to build it before a browser ships the API is the maintainer's call (Questions).

### 4. CLI sessions: control, keeping a segment's pages, downloads, history, the ledger

**Where:** `src/internal/cli/`, `CurrentSession`, `UserContext`; `src/internal/ledger.ts` (new).

**What changes.**

- **4a. `strider control`** (Q169). An attached session sees the browser's own tabs, and a launched one its first tab (Q141), as observed pages.
  - `strider tabs` lists the pages the session doesn't hold: id, URL and title.
  - `strider control <id>`, or `--url <pattern>` matching one tab, acquires control for the session's scope (`Page.control`) and names it (`--name`, else `p1`, `p2`…).
  - `strider release -p <name>` lets it go: its declarations are removed, and the tab stays open.
  - The toolkit gains a `control` tool to the same effect, for agents.
  - The daemon holds each grant in a scope of its own, which `release` and `stop` close.
- **4b. Keeping a segment's pages** (Q173). `CurrentSession.keep(page, name?)` transfers a page the segment opened from the segment's scope to the session's, as CONCEPTS.md §3 allows: the page's owner becomes the session's scope, and the segment's release passes it by. Only `keep` transfers; returning a page names it, as now, but doesn't keep it.
- **4c. Where downloads go** (Q25). `UserContext.Options.downloads` is `"temporary"` (the default: a directory made for the context, removed after it, as now), `"deny"`, or `{ directory }`, which the caller owns. The CLI's session context uses `{ directory: <session>/downloads }`.
- **4d. `history --level` and `--failed`.** The CLI's `history` and the toolkit's `history` tool filter console messages by level and network requests to the failed ones, through the modules' own filters.
- **4e. A ledger of what a connection owns** (CONCEPTS.md §3, Ownership ledger; Q146). `Ledger.layer(directory)` records, while the program runs:
  - each browser it launched, by PID and process start time;
  - its profile and temporary directories;
  - the contexts it made on a browser it attached to.

  A clean exit removes the record. `strider prune` reads the records whose program is gone, telling a reused PID by its start time: it lists what each left, and with `--yes` kills an orphaned browser, removes its directories, and removes its contexts on an attached browser it can still reach. That is also how a Firefox locked by a dead program's session is freed (Q146): kill the browser. The CLI's daemons use the ledger always. A program uses it only by providing the layer, since writing files unasked would be implicit.

**Recommendation.** Adopt.

### 5. Network: headers sent, request bodies, HAR replay, route patterns, response headers

**Where:** `NetworkRequest`, `Har`, `Route`; the adapters.

**What changes.**

- **5a. A request's headers as sent** (Q158). `NetworkRequest.headersSent(request)` waits until the request's headers as sent are known, and returns them:
  - on Chromium, from `requestWillBeSentExtraInfo`, which a response's `hasExtraInfo` says will come (CDP documents the flag for both of a request's `ExtraInfo` events), or the request event's own headers when it says none will;
  - on Firefox and WebKit, the request event's headers, at once.

  The event's `headers` stay what the request event gave.
- **5b. Request bodies in a HAR** (Q164). A recording keeps each request's body:
  - CDP: `postData` from `requestWillBeSent`, or `Network.getRequestPostData` when it was too large to carry;
  - BiDi: a request data collector and `network.getData`;
  - WebKit: `postData` from `requestWillBeSent`.

  The HAR's `postData` has its MIME type, and `params` for a form. A request body can hold a password, so the export leaves bodies out unless `include` names `"requestBodies"`.
- **5c. HAR replay.** `Route.fromHar(path, options)` is a route handler that answers from a recorded HAR, a `.har` file or the zip `content: "attach"` writes:
  - it matches an entry by method, URL and, where both have one, request body; the latest matching entry wins;
  - `notFound: "abort"` (the default) fails a request no entry matches, and `"fallthrough"` leaves it to the next route.

  It is a route like any other: `page.route("**/api/**", Route.fromHar("api.har"))`. Recording stays `Har.record`'s.
- **5d. A `URLPattern` route pauses only what could match** (Q106). Its fixed prefix, from the protocol through the host and the path up to the first variable part, becomes the glob L0 intercepts, and the route still matches the pattern itself.
- **5e. A response-phase decision that changes only the status and headers** (Q93). `Route.continueWith({ status, headers })` at the response phase, on CDP and BiDi (P4); `Unsupported` on WebKit, under its own capability, `interception.responseHeaders`.
- **5f. A document's body on WebKit** (Q179). Where a body collection is declared, the WebKit adapter reads a document's body as its load finishes, before the next commit can clear it.

**Recommendation.** Adopt.

### 6. Pages: frames' navigations, workers, iframe trees, layouts, drag, handles

**Where:** `PageNavigation`, `Keyboard`, `Locator`, `Capability`, `UserContext`; the adapters; `packages/tools/codegen` (keyboard layouts).

**What changes.**

- **6a. A frame's own navigations as events.** `PageNavigation.next(page, { frames: "all" })`, `stream` and `history` include child frames' navigations, each naming its frame. The default, `"main"`, is the main frame alone, as now.
- **6b. Init scripts and the page clock in dedicated workers.** A worker gets the context's init scripts declared `{ workers: true }`, and its clock, before its own script runs:
  - on CDP, while it is attached paused at start;
  - on WebKit, before the adapter sends `Worker.initialized`, which its protocol holds a new worker for.

  WebDriver BiDi's preload scripts run in browsing contexts only, so `initScripts.workers` and `clock.workers` are `Unsupported` on Firefox.
- **6c. An iframe's accessibility tree.** `Capability.AxTree` stitches each child frame's tree in at its iframe node: `getFullAXTree` with the frame's id in process, and on the frame's own session out of process.
- **6d. Keyboard layouts** (Q86).
  - `Keyboard.Layout` values: `us`, the default, and the common European ones (`uk`, `de`, `fr`, `es`, `it`).
  - They are generated from Unicode CLDR's keyboard data, vendored with its license and generated as the protocols are, with no dependency.
  - `UserContext.Options.keyboardLayout` chooses one, and `type` and `press` then map each character to the layout's key and modifiers, AltGr included.
  - The page sees the `key` and `code` the layout gives; the browser's own layout is unchanged.
- **6e. HTML drag where the protocol can't finish one** (Q76). `dragTo(target, { html: "synthetic" })` dispatches `dragstart`, `dragenter`, `dragover`, `drop` and `dragend` with one `DataTransfer` from the isolated world (P3). The events are untrusted, which the option's name says. The default, `"native"`, stays what it is, and fails `Unsupported` where the backend has no drag, with a hint naming `"synthetic"`. Chosen everywhere, a test drags the same way on every backend.
- **6f. Handles released in one command per realm** (Q132). Handles made in a scope join an object group per realm (CDP and WebKit `objectGroup`), released in one `Runtime.releaseObjectGroup` when the scope closes; on BiDi, one `script.disown` per realm with all of them.

**Recommendation.** Adopt.

### 7. Attaching to stock WebKit

**Where:** `WebKit.layerAttach` (new); `src/webkit-stock-protocol/` (generated); `packages/tools/codegen/protocols/webkit-stock/`.

**What changes.**

- **The protocol.** Stock WebKit's inspector protocol is vendored from WebKitGTK 2.54's source and generated as a backend of its own (review 19). It has no `Playwright` domain and no page proxies.
- **`WebKit.layerAttach(endpoint)`** connects to a remote inspector endpoint: WebKitGTK's and WPE's inspector server (`WEBKIT_INSPECTOR_HTTP_SERVER`), or a proxy such as ios-webkit-debug-proxy that speaks the same protocol. It is attach-only:
  - the browser's pages are observed, and `inspect` and `control` grant access as on the other backends;
  - stock WebKit can't make contexts or pages over its protocol, so `newContext` and `newPage` fail `Unsupported`.
- **Testing.** Tests run WebKitGTK's MiniBrowser under a headless display server in the Nix environment, if nixpkgs' WebKitGTK ships MiniBrowser and it runs headless (P6). The build checks that first. If it can't run here, the backend stays unbuilt and says so: there is no endpoint to test against.

**Recommendation.** Adopt, subject to the build's check.

### 8. The open quirks

- **Q72** (WebKit's mouse modifiers) is checked against Playwright's own client in the scenario work, which installs Playwright in a workspace package of its own: never a dependency of the library (P7).
- **Q180** (a crash another client causes, unreported under load) reproduces only under synthetic load. Tracing it needs the stress harness, which waits for the maintainer's go-ahead, since the machine is in use.
- **Q82 and Q103** (costs the library accepted) are measured in the scenario work, on real sites. 5d resolves Q106, and 6f Q132.
- **Q2** (whether Firefox's `about:certerror` names the intended URL as its `neterror` page does) needs a TLS fixture: a test generates a self-signed certificate with the Nix environment's `openssl` and checks it.
- **Q14** (Firefox's `reload` with `ignoreCache`) waits for Firefox; there is nothing to design.

**Recommendation.** Adopt.

## Considered and not adopted

- **Playwright's capture script, vendored.** The maintainer wants no dependency, and ours can run in the isolated world (P1), which Playwright's can't.
- **A trace viewer of our own.** The format is the viewer's, and trace.playwright.dev runs anywhere; a viewer would be a second product.
- **A video from Chromium's or WebKit's frames.** It needs a video encoder, which is a dependency.
- **Serializing only the stylesheets a page changed, found by hooking CSSOM methods.** The hooks need the page's world, where the page can see and break them; `cssRules` from the isolated world needs neither.
- **Falling back to synthetic drag on its own** where the backend has no drag. Untrusted events would stand in for input without the caller choosing them.
- **Downloads and `FileInput.local` on a remote browser with no file system shared with the program.** No protocol carries a download's bytes, so `Unsupported` stays.
- **Console objects rendered one way on every backend** (Q33). WebDriver BiDi serializes an `Error` without its message (review 21).
- **A fake browser with a DOM for `layerTest`.** It would be a second engine to keep honest, and real browsers are cheap to launch.
- **Reclaiming automatically from the ledger.** `prune` lists what dead programs left, and only `--yes` acts.

## Questions for the maintainer

1. **The MCP command (3a):** build it as a front end to a session, or leave it out, since a program can serve the toolkit itself and agents with a shell have the CLI?
2. **WebMCP (3c):** build the experimental hook now, against the draft API and a fixture page, or design only, until a browser ships it?
3. **`vitest`:** the package has two optional peer dependencies. `@effect/platform-node` is Effect's own. `vitest` is loaded only by `VitestBrowser`. Keep it, or move `VitestBrowser` to a package of its own so `@usestrider/browser` names nothing but Effect?
4. **Q180:** may the stress harness run at a time you're away from the machine?

## Build

In six steps, each committed and pushed when its tests pass on every backend, after `@usestrider/vitest` is split out:

1. CLI sessions and agents (candidates 3a, 3b and 4).
2. Network (5).
3. Pages (6).
4. Traces (1 and 2).
5. Stock WebKit (7).
6. The open quirks' checks (8).

## Decision

Adopted, 2026-10-26, under the maintainer's direction to design everything deferred. The maintainer's answers:

1. **The MCP command:** asked how it would be used. Claude Desktop launches it from its configuration and speaks MCP over its standard input and output; with `-s`, it joins a session started with `strider start`. Built as a session front end unless the maintainer says otherwise.
2. **WebMCP:** "I don't know what WebMCP is". Explained as a draft standard for pages to offer agents tools, which no pinned browser ships. Design only: built once a browser ships it.
3. **`vitest`:** "yeah separate @usestrider/vitest or something". `VitestBrowser` moves to a package of its own, `@usestrider/vitest`, ahead of step 1, so `@usestrider/browser` names nothing but Effect.
4. **Q180:** "another time". It stays open.

Each step records where its build differs.
