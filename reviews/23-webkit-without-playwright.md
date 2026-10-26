# Design review: WebKit without Playwright's build

*2026-10-26. Review of commit `bb8eb1e` (review 22's fifth step) on the WebKit backend. Prompted by the maintainer: "I don't want to use the playwright builds at all, I want my own versions of everything, ideally using stock as much as possible. playwright builds are immediately detected by bot protection", and, on whether that is a change of direction: "How does that not align with my goal of no dependencies from the start?"*

*It isn't a change of direction. The WebKit backend has launched Playwright's patched build since L0 (PROTOCOL.md, Built for WebKit). Strider loads none of Playwright's code, but the backend depends on a browser Microsoft patches, builds and ships, whose protocol changes when they roll it, which a user can only get through Playwright's installer, and whose patches are a fingerprint. That contradicts the library's founding constraint, no dependency but Effect, as much as a package would. Review 22's fifth step showed stock WebKit is reachable; this review drives it. This commit records the review only.*

Chromium and Firefox are already stock: the backends drive the browsers their vendors ship, over CDP and WebDriver BiDi. WebKit is the one backend that changes.

## What the browsers do

Probed against WebKitGTK 2.54.1's MiniBrowser from the pinned nixpkgs, under Xvfb, with throwaway scripts (not kept), one browser at a time at low priority, and read from WebKitGTK 2.54.1's source.

| Probe | WebKitGTK 2.54.1 |
|---|---|
| **P1.** WebDriver BiDi through `WebKitWebDriver`, the WebDriver server WebKitGTK ships | Compiled out of release builds: `ENABLE_WEBDRIVER_BIDI` follows `ENABLE_EXPERIMENTAL_FEATURES` (`OptionsGTK.cmake`), the binary has no `--bidi-port`, and a session asking for `webSocketUrl` fails "Failed to match capabilities" |
| **P2.** An Automation session from our own client, over the remote inspector server `WEBKIT_INSPECTOR_SERVER` starts, with `--automation` | Works. Messages are framed as a big-endian size, a flags byte, a name and GVariant parameters (`wtf/glib/SocketConnection.cpp`). `StartAutomationSession` is answered with the browser's name and version (`MiniBrowser`, `2.54.1`) and a target list with an `Automation` target; `Setup` connects to it. Created and navigated a page; a click the page saw as `isTrusted: true`; typed `hé@` with `InsertByKey`; a screenshot; cookies with their attributes; the window resized |
| **P3.** The automated page as an inspector target | The same socket lists it as a `WebPage` target, and the inspector protocol reaches it as over the HTTP server: `Target`-wrapped messages to its inner target, where `Runtime.enable` and `Runtime.evaluate` work. Automation's own inspector tunnel (`sendInspectorMessage`) is off: it answers only a client that allows inspector testing, which WebKitGTK's doesn't |
| **P4.** Which world Automation's `evaluateJavaScriptFunction` runs in | The page's: it sees the page's globals and expandos, its writes are visible to the page, and no other execution context appears |
| **P5.** Emulation on the inspector | `Page.setEmulatedMedia`, `Page.overrideUserPreference` (`prefers-color-scheme: dark` then matches) and `Page.overrideSetting(ScriptEnabled)` work; `Page.overrideUserAgent` answers but the document's `navigator.userAgent` is unchanged; `Network.setEmulatedConditions` isn't there. The time zone is set at launch (`--time-zone`). The viewport is the window less a 38-pixel toolbar, at a device pixel ratio of 1 |
| **P6.** Dialogs | A `confirm` is reported by `isShowingJavaScriptDialog`, its message by `messageOfCurrentJavaScriptDialog`, and `acceptCurrentJavaScriptDialog` answers it (the page got `true`). Nothing announces a dialog, and nothing says its kind or a prompt's default: the browser knows both (`typeOfCurrentJavaScriptDialogOnPage`), and reports them only to its WebDriver BiDi, which is compiled out |
| **P7.** File choosers | `setFilesToSelectForFileUpload`, then a click on a file input: `fileChooserDismissed` names the files, and the input has them |
| **P8.** Popups | `window.open` from a script returns `null` (blocked); with `forceUserGesture`, the popup is a new browsing context and a new `WebPage` target. Nothing announces a browsing context: the target list is pushed when it changes |
| **P9.** A second browser process | Its session is ready 0.6 s after launch; each browser is about 0.8 GB resident across its five processes (shared pages counted in each) |
| **P10.** What the page sees | `navigator.webdriver` is `true` in automation mode, as WebDriver requires; the user agent is WebKitGTK's own (`… AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15` on X11). Review 22's attach, without automation mode, doesn't set it |
| **P11.** The two inspector servers | With `WEBKIT_INSPECTOR_HTTP_SERVER` set, `WEBKIT_INSPECTOR_SERVER` is ignored and the socket server takes a random port behind the HTTP one (`WebKitInitialize.cpp`) |
| **P12.** Licenses | Debian's per-file audit of WebKitGTK lists neither the inspector protocol's files nor `Automation.json` among its exceptions, so both are under WebKit's default, BSD-2-clause |

## Candidates

### 1. Playwright's WebKit build goes

**What goes:**
- `WebKit.layer` launching Playwright's build, the launcher's `protocol.json` check (`internal/webkitLauncher.ts`), and the adapter's Playwright profile;
- the generated `@usestrider/browser/webkit-protocol` and `packages/tools/codegen/protocols/webkit`;
- the pin (`browsers.json`'s `webkit`, `flake.nix`'s `playwright-driver`) and its drift fixture (`webkit-playwright-2359`);
- `strider browsers`'s look in Playwright's browser cache, for every browser: a Chromium Playwright installed is still one Playwright installed.

**What stays:** the documents' Built sections and QUIRKS.md's entries about Playwright's build, as history; an entry the change settles gets a marker.

**Recommendation.** Adopt.

### 2. The remote inspector server's socket, with our own client

**Where:** `src/internal/gvariant.ts`, `webkitInspectorSocket.ts` (new); `src/webkit-automation-protocol/` (generated).

- **GVariant, our own.** The subset the messages use, encoded and decoded from type strings: basic types, strings, variants, arrays, tuples and dictionary entries, with GVariant's alignment and framing offsets. No GLib, no dependency. Tested against bytes the browser sends.
- **The socket.** One connection per browser process: the frames of P2, `StartAutomationSession`, `Setup`, `SendMessageToBackend`, and the target lists the server pushes. It carries two kinds of target: the `Automation` target, and each page's `WebPage` target, which speaks the inspector protocol as review 22's HTTP transport does, so that transport's page handling (Q195's ids, Q196's list) is shared, not repeated.
- **The Automation protocol** is generated from WebKitGTK 2.54.1's `Source/WebKit/UIProcess/Automation/Automation.json`, vendored beside the inspector's, as a backend of its own.

**Recommendation.** Adopt.

### 3. Launching stock WebKit

**Where:** `WebKit.layer` (rewritten); `internal/webkitLauncher.ts`.

- **`WebKit.layer({ executablePath })`** launches a WebKitGTK or WPE browser that has an automation mode: WebKitGTK's MiniBrowser (`--automation`) or GNOME Web (`--automation-mode`). It sets `WEBKIT_INSPECTOR_SERVER` to a free port, gives the browser a temporary profile and XDG directories, and connects. `strider browsers` finds both.
- **Its window opens where the environment says** (`DISPLAY`, `WAYLAND_DISPLAY`). WebKitGTK has no headless mode (Q202): a program that wants none provides a display, as the tests do with Xvfb; the library starts no display server. `headless: true` fails `Unsupported` on WebKitGTK, and works on WPE's headless platform once WPE is packaged.
- **`WebKit.layerAttach`** stays as review 22 built it: look-only, without automation mode, through the HTTP inspector server.

**Recommendation.** Adopt.

### 4. The adapter, driving through Automation

**Where:** `internal/webkitAdapter.ts`: one adapter, its stock profile, launched or attached.

**Automation does what the inspector can't:**
- pages: `createBrowsingContext`, `closeBrowsingContext`, `switchToBrowsingContext`;
- navigation: `navigateBrowsingContext`, `goBack…`, `goForward…`, `reloadBrowsingContext`, so `goto` is a navigation the browser starts, not a script, and history works;
- input: `performInteractionSequence` for pointer and keyboard sources, trusted (P2);
- screenshots: `takeScreenshot`;
- the viewport: `setWindowFrameOfBrowsingContext`, the window sized to the viewport plus the toolbar the adapter measures once (P5);
- file choosers and file inputs: `setFilesToSelectForFileUpload` with `fileChooserDismissed`, and `setFilesForInputFileUpload` (P7);
- permissions: `setSessionPermissions`, for what it understands;
- dialogs (candidate 5).

**The inspector does the rest**, as it does on an attached page: evaluation (in the main world: P4), network events and routes, console, frames, workers, init scripts (`Page.setBootstrapScript`), cookies, and emulation of media, color scheme and JavaScript (P5).

**A page's two names.** Automation knows a page by its handle, the inspector by its target, and neither names the other (P8). As a target appears, or a page is created, the adapter reads the document's `performance.timeOrigin` and URL through both and pairs them: reading, not writing, so the page sees nothing.

**Pages the browser opens** arrive in the pushed target list, and their handles from `getBrowsingContexts`. They aren't paused: an init script or route misses a popup's first document (`pauseOnStart.popups`, `unsupported`, as when attached).

**Recommendation.** Adopt.

### 5. Dialogs

`isShowingJavaScriptDialog` says a dialog is open, and the adapter asks every 100 ms for each open page: the browser's UI process answers, and the page sees nothing. The message comes from `messageOfCurrentJavaScriptDialog`, and the decision goes back through accept, dismiss and `setUserInputForCurrentJavaScriptPrompt`. What Automation doesn't say is the dialog's kind, or a prompt's default value (P6), which `Dialog` needs. Three ways to know them:

- **(a) Symbolic breakpoints.** With the `Debugger` enabled, `Debugger.addSymbolicBreakpoint` for `alert`, `confirm` and `prompt` pauses each call, which names the kind; the adapter resumes at once. The page is unchanged. The cost: a debugger attached to every page, which makes JavaScriptCore run the page's code with debugging hooks, and a prompt's default value may still be out of reach. To be measured before it's chosen.
- **(b) A wrapper in the bootstrap script**, which records the kind, message and default before calling the browser's own dialog. Exact, but the page can see that `alert` isn't the browser's, which is what bot detection looks for.
- **(c) `Dialog.Unknown`**, a variant with the message, `accept` and `dismiss`, and `respond(text)` that fails unless the dialog was a prompt. Honest and cheap, but every exhaustive handler on every backend gains a case.

**Recommendation.** Measure (a) in the build's first step: if the slowdown is small and the default value is readable, (a); otherwise (c). Not (b).

### 6. A context is a browser process

An Automation session has one profile, ephemeral (MiniBrowser's `network-session` for automation). `Browser.newContext`, and `Browser.newPage`, which opens a page in a context of its own, launch another browser for it, with its own socket and profile, and its scope closes it. The first browser is the default context.

- **The cost** is P9's: about 0.6 s and a process tree per context. A test suite that opens a context per test pays it each time, as it would launching a browser per test elsewhere.
- **The gain:** what a process takes at launch is a context's, so the time zone (`--time-zone`) and locale (the environment's) become context options, supported when the context is created.

**Recommendation.** Adopt. Sharing one browser between contexts would give two `Browser.newPage()` calls the same cookies without saying so.

### 7. Capabilities, launched

Supported: pages, navigation with history, trusted pointer and keyboard input, dialogs (by candidate 5), screenshots (PNG), the viewport, file choosers and inputs, network events and request routes, console, frames, workers, init scripts in the main world, cookies, storage, media and color-scheme emulation, JavaScript off, time zone and locale per context.

Unsupported, and said so: isolated worlds (the engine in the page's world, Q194, and `evaluate` refused as when attached), `pauseOnStart.popups`, screencasts and video, PDF, downloads (a navigation that becomes one ends so, Q198), network throttling, geolocation, touch, device scale, a user agent for the document already loaded, and headless WebKitGTK. Keyboard layouts are checked in the build: Automation types characters and named keys, not physical ones.

### 8. Platforms

Playwright's build ran on Linux, macOS and Windows. Stock WebKit with an automation mode reachable this way is WebKitGTK and WPE, which are Linux's. On macOS, WebKit is Safari, reached through `safaridriver` (classic WebDriver, not built) or Safari Technology Preview's experimental WebDriver BiDi (`Bidi.layerConnect`); on Windows there is no stock WebKit browser. The documents say so where they name WebKit.

### 9. Tests

The conformance suite and the slices run against the MiniBrowser launched, under Xvfb, with expectations by capability; the runs against Playwright's build go. The drift test records stock WebKit's traffic, the Automation target's and the pages', as a fixture of its own. Each context is a process, so WebKit's test files stay one at a time.

### 10. The comparison scripts

Playwright drives Chromium through any Chrome, but Firefox and WebKit only through its own builds. So the Playwright-versus-Strider scripts compare on stock Chrome only, and no Playwright build runs anywhere, the comparison package included.

**Recommendation.** Adopt.

## Considered and not adopted

- **WebDriver BiDi through `WebKitWebDriver`:** compiled out of release builds (P1).
- **`WebKitWebDriver`'s classic WebDriver as the go-between:** a process more, no events, and nothing it does that the socket doesn't.
- **A WebKit build of our own, patched:** a browser to maintain, and a fingerprint of its own.
- **Keeping Playwright's build as an option:** "I don't want to use the playwright builds at all."
- **Automation's inspector tunnel:** off outside WebKit's own tests (P3).
- **One browser for every context:** no isolation (candidate 6).
- **Starting Xvfb inside the library:** a program would run a display server it didn't ask for.

## Questions for the maintainer

1. **Dialog kinds (candidate 5):** measure symbolic breakpoints and fall back to `Dialog.Unknown`, as recommended, or another way?
2. **A browser process per context (candidate 6):** acceptable at about 0.6 s and a process tree each?
3. **GNOME Web:** launch it too, or the MiniBrowser only?
4. **The comparison scripts (candidate 10):** Chrome only?

## Build

In four steps, each committed and pushed when its tests pass:

1. The GVariant codec, the socket and the generated Automation protocol (candidate 2), with candidate 5's measurement.
2. The adapter launched, with contexts as processes, and `WebKit.layer` (3, 4, 5, 6).
3. The tests on stock WebKit, and the stock fixture (9).
4. Playwright's build removed, with the documents and QUIRKS.md (1, 7, 8).

Review 22's sixth step and the release work follow, the license notices with them.

## Decision

Adopted, 2026-10-26. The maintainer asked what I would answer, and agreed to these ("sure"):

1. **Dialog kinds:** symbolic breakpoints, measured first on a JavaScript-heavy page with the debugger attached and without, and whether a prompt's default value can be read while paused. If the slowdown is small, they're used; if the kind is known but the default isn't, they're used and the prompt's default comes back to the maintainer as an API question; if the slowdown is real, `Dialog.Unknown`. Never a wrapper in the page.
2. **A browser process per context:** yes. The resident size is measured in the build, without shared pages counted twice, and documented.
3. **GNOME Web:** launched too, if its automation mode probes as the MiniBrowser's does; the tests pin the MiniBrowser. A difference defers GNOME Web, not the build.
4. **The comparison scripts:** stock Chrome only.
