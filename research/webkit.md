# WebKit and Safari automation routes for an Effect-native protocol client (as of 2026-10-18)

## Summary

### Routes
- **Playwright's patched WebKit (Route 1)** is the only WebKit you can launch and own with CDP-like depth: browser-level `Playwright.*`, plus `Input`, `Emulation`, `Dialog` and `Screencast`, over a fd-3/4 NUL-framed pipe. It runs on Linux GTK/WPE, macOS 14+ and Windows WinCairo or WSL. It is **not Safari**, it is pinned per revision (r2378), and about 27% of rolls change the protocol.
- **Real Safari over BiDi (Route 2)** works only experimentally in STP.
  - **Enabling it:** both `webSocketUrl: true` and `safari:experimentalWebSocketUrl: true` are required. WPT doesn't send the latter, so wpt.fyi shows STP 254 at 0/4338 BiDi subtests against 2722/3319 classic.
  - **Gaps:** no `network` module, no Cocoa user contexts, and console logs are not delivered.
  - **Stable Safari:** Safari 27.0 (2026-09-14) shipped `safaridriver --mcp` and no BiDi.
- **WebKitGTK/WPE BiDi (Route 3)** passes about 23% of BiDi WPT (1338/5732), with no `network` or `emulation` modules and one session per driver. It is off in every distro build; use Igalia's CI bundles.
- **Classic `safaridriver` (Route 4)** gives one session per Mac, a glass-paned window, and no events, interception or console. In practice it is the BiDi bootstrap.
- **iOS (Route 5)** is reachable through the **stock WebKit Inspector protocol** (`ios_webkit_debug_proxy`, Appium, pymobiledevice3 over `com.apple.webinspector[.shim.remote]`). Playwright main already has an undocumented `webkit.connectOverCDP` backend for it. The other path is classic `safaridriver`. There is no iOS BiDi.

### Recommendation in one line
- **One WebKit Inspector Protocol (WIP) client, two profiles:** *patched* (launch, P0) and *stock* (attach, P2).
- **Safari and WebKitGTK as quirk profiles of the generic BiDi backend** (P1, experimental).
- **Classic WebDriver** only to bootstrap BiDi.
- **Capabilities as services in `R`:** "unsupported" is a type error for a static backend and a typed `Unsupported` failure for a dynamic one.

### Evidence base
- Playwright clone @ `b335271c` (2026-10-17).
- WebKit `main` protocol JSON.
- STP release notes 229 and 247–254.
- wpt.fyi raw results from 2026-10-18.
- Selenium PR #17729.
- pymobiledevice3 source.
- Apple's WebDriver documentation JSON.
- A delegated GitHub-API and wpt.fyi pass on WebKitGTK and Playwright churn.

## Route 1 — Playwright's patched WebKit ("Juggler-for-WebKit")

Sources: `/tmp/prior-art/playwright` @ `b335271c` (2026-10-17). `browsers.json`: webkit rev **2378**, `browserVersion` 27.2, with `revisionOverrides: { mac14: 2251, mac14-arm64: 2251 }`, which freezes macOS 14 at an older build. `browser_patches/webkit/UPSTREAM_CONFIG.sh` pins `BASE_REVISION=5b391e6d…` (WebKit `319524@main`).

### 1.1 What `bootstrap.diff` adds
- **Size:** 20,476 lines in `patches/bootstrap.diff`, touching **349 files**. It adds about 10.3k lines and creates 53 new files.
- **Where the added lines land:** WebKit UIProcess/WebProcess/Shared about 6.8k, WebCore about 1.9k, JavaScriptCore protocol JSON and agents about 1.1k, MiniBrowser about 350.
- **License of the new files:** "Copyright (C) 2019 Microsoft Corporation" under BSD-2-clause (for example `Source/WebKit/UIProcess/BrowserInspectorPipe.cpp`).

**New inspector domains** (new `Source/JavaScriptCore/inspector/protocol/*.json` files):

| Domain | Commands / events | Lives in |
|---|---|---|
| `Playwright` (browser-level; this is what older docs call `Browser.*`) | `enable/disable/getInfo/close`, `createContext{proxyServer,proxyBypassList,enableStoragePartitioning}→browserContextId`, `deleteContext`, `createPage{browserContextId}→pageProxyId`, `navigate{url,pageProxyId,frameId,referrer}→loaderId`, `grantFileReadAccess`, `takePageScreenshot`, `setIgnoreCertificateErrors`, `setPageZoomFactor`, `closePage{runBeforeUnload}`, `getAllCookies/setCookies/deleteAllCookies`, `setGeolocationOverride`, `setLanguages`, `setDownloadBehavior`, `cancelDownload`, `clearMemoryCache`; events `pageProxyCreated{browserContextId,pageProxyId,openerId}`, `pageProxyDestroyed`, `provisionalLoadFailed`, `windowOpen`, `downloadCreated/FilenameSuggested/Finished` | `UIProcess/InspectorPlaywrightAgent.cpp` (about 1,070 lines) |
| `Input` | `dispatchKeyEvent` (with `macCommands`), `dispatchMouseEvent`, `dispatchWheelEvent`, `dispatchTapEvent`, `dispatchTouchEvent` | `UIProcess/WebPageInspectorInputAgent{,Mac,Gtk,…}`. These synthesize **native** platform events in the UI process, so the page sees them as trusted. |
| `Emulation` | `setDeviceMetricsOverride`, `setJavaScriptEnabled`, `setAuthCredentials`, `setActiveAndFocused`, `grantPermissions`, `resetPermissions`, `setOrientationOverride` | `UIProcess/WebPageInspectorEmulationAgent*` |
| `Dialog` | `enable`, `handleJavaScriptDialog`; events `javascriptDialogOpening/Closed` | `UIProcess/InspectorDialogAgent.cpp` |
| `Screencast` | `startScreencast/stopScreencast/screencastFrameAck`; event `screencastFrame` (used for video recording) | `UIProcess/Inspector/Agents/InspectorScreencastAgent.cpp` |

**Changes to existing domains:**
- **Page:** adds `goBack/goForward`, `overridePlatform`, `setForcedColors`, `setTimeZone`, `setTouchEmulationEnabled`, `insertText`, `setInterceptFileChooserDialog`, `setDefaultBackgroundColorOverride`, `createUserWorld`, `setBypassCSP`, `crash`, `updateScrollingState`. New events: `frameAttached`, `navigatedWithinDocument`, `willCheckNavigationPolicy/didCheckNavigationPolicy`, `fileChooserOpened`.
- **DOM:** adds `describeNode`, `scrollIntoViewIfNeeded`, `getContentQuads`, `setInputFiles`. `resolveNode` now accepts `objectId`, `frameId` and `executionContextId`.
- **Runtime:** adds `addBinding` and the `bindingCalled` event.
- **Network:** adds `setEmulateOfflineState`.
- **Target:** adds `activate`, and `targetDestroyed` gains a `crashed` field.

Upstream already has `Page.setBootstrapScript`, `Page.overrideSetting/overrideUserAgent/overrideUserPreference/setEmulatedMedia/setScreenSizeOverride/snapshotRect`, cookie commands, the `Target` multiplexer, and **request and response interception** (`Network.setInterceptionEnabled/addInterception{stage:request|response}/interceptContinue/interceptWithRequest/interceptWithResponse/interceptRequestWithResponse/interceptRequestWithError`, `ResourceErrorType = General|AccessControl|Cancellation|Timeout`). WebKit added these upstream for Web Inspector "Local Overrides", so **interception is not Playwright-only**. Upstream `Page` lacks `navigate`, `frameAttached` and `navigatedWithinDocument`. Upstream protocol directory: 28 domain files (`Animation … Worker`, including an unrelated upstream `Browser` domain for extensions).

**Embedder** (`browser_patches/webkit/embedder/Playwright/{mac,win}`):
- **macOS:** a minimal Cocoa `Playwright.app`. `AppDelegate.m` parses `--headless`, `--no-startup-window`, `--inspector-pipe`, `--user-data-dir` and `--proxy`. It creates contexts as `initNonPersistentConfiguration` data stores and calls `[_WKBrowserInspector initializeRemoteInspectorPipe:headless:]`.
- **Windows:** a WinCairo `Playwright.exe`.
- **Linux:** the patch modifies `Tools/MiniBrowser/{gtk,wpe}` instead. The GTK MiniBrowser gains `--inspector-pipe`, `--remote-debugging-port`, `--user-data-dir`, `--headless` (a no-op on GTK) and `--no-startup-window`. `pw_run.sh` switches to **WPE MiniBrowser when `--headless`** is passed, so Linux headed runs use the GTK port and headless runs use WPE. One zip ships both `minibrowser-gtk/` and `minibrowser-wpe/`.

### 1.2 Launch and transport
- **Launch:** `webkit.ts#defaultArgs` passes `['--inspector-pipe', ('--headless'), ('--user-data-dir=…' | '--no-startup-window'), '--proxy=…']`. Graceful shutdown sends `Playwright.close` with the magic id `-9999`.
- **Pipe:** `RemoteInspectorPipe.cpp` reads fd **3** and writes fd **4** (on Windows via `_get_osfhandle`, the same as Chromium's `--remote-debugging-pipe`). Framing is **NUL-terminated JSON**: `WriteBytes(message); WriteBytes("\0", 1)`. Writes are chunked at 64 KiB on a dedicated `WorkQueue`. Reads go through a 256 KiB buffer on a reader thread that splits on `'\0'` and dispatches to the main `RunLoop`.
- **WebSocket alternative:** GLib ports also offer `--remote-debugging-port=N` (`glib/BrowserInspectorWebSocketServer.cpp`, a libsoup server named `"WebKit-Playwright-WSS"`). It accepts **one** WebSocket connection. Playwright's Windows **`webkit-wsl`** channel uses it: it runs the Linux build inside a WSL distro with `--remote-debugging-port=0` and scrapes `Playwright listening on ws://…` from stderr.

**Three-level session addressing.** This is the key difference from CDP's flat `sessionId`:
1. **Browser level:** no routing key. These are `Playwright.*` commands.
2. **Page-proxy level (UI process):** the client adds `"pageProxyId": "<id>"` to the top-level message. `InspectorPlaywrightAgent::dispatchMessageFromFrontend` intercepts any message carrying `pageProxyId` and forwards it to that `WebPageProxy`'s inspector controller. Replies come back stamped with both `browserContextId` and `pageProxyId` (`PageProxyChannel::addTabIdToMessage`). Domains served here: `Target`, `Input`, `Emulation`, `Dialog`, `Screencast`.
3. **Target level (WebContent process):** `Target.sendMessageToTarget{targetId, message: <stringified JSON>}`, with replies and events arriving as `Target.dispatchMessageFromTarget{targetId, message}`. Domains served here: `Page`, `Runtime`, `DOM`, `Network`, `Console`, `Worker`, and the rest. The inner message is a **JSON string inside JSON**, so it is parsed twice.

```ts
// wkConnection.ts — demux on pageProxyId; WKSession per pageProxy and per target
if (message.pageProxyId) {
  const payload = { message, pageProxyId: message.pageProxyId };
  this.browserSession.dispatchMessage({ method: kPageProxyMessageReceived, params: payload });
  return;
}
// wkPage.ts — target session = Target.sendMessageToTarget wrapper
const session = new WKSession(conn, targetInfo.targetId, (message) => {
  this._pageProxySession.send('Target.sendMessageToTarget', { message: JSON.stringify(message), targetId });
});
```

### 1.3 Mapping onto page, frame and context
- **Browser and context (`wkBrowser.ts`):**
  - `Playwright.enable` must be sent first.
  - `Playwright.createContext` returns a `browserContextId`, which is an ephemeral `WebsiteDataStore`/`PAL::SessionID`.
  - Pages are announced by **`Playwright.pageProxyCreated`**, which fires for `createPage`, popups (`openerId`) and `window.open`. They end with `pageProxyDestroyed`.
  - Unknown context ids fall back to the default (persistent) context. A FIXME notes "no context lifecycle events".
- **Page (`wkPage.ts`):**
  - **Per page-proxy:** `Dialog.enable` and `Emulation.setActiveAndFocused`.
  - **Per target:** `Page.enable` + `Page.getResourceTree`, then `Runtime.enable`, `Page.createUserWorld{name:'__playwright_utility_world__'}` ("Worlds are per-process"), `Network.enable`, and `Runtime.addBinding`. Interception setup is `Network.setInterceptionEnabled` + `setResourceCachingDisabled` + `addInterception{url:'.*',isRegex:true,stage:'request'}`. Init scripts go through `Page.setBootstrapScript`, along with UA, media, timezone, offline, touch, file-chooser and `overrideSetting` flags. Targets that start `isPaused` are released with `Target.resume`.
  - **Navigation** is the UI-level `Playwright.navigate{pageProxyId, frameId}`, which returns a `loaderId` used as the document id.
- **Process swaps (`wkProvisionalPage.ts`):** cross-origin or COOP navigations create a **provisional target** (`targetCreated{isProvisional:true}`). The page is **re-initialized in full** on the new session while the old one keeps running. `Target.didCommitProvisionalTarget{oldTargetId,newTargetId}` swaps the two; if the load fails, `targetDestroyed` discards the provisional target. Network events from the provisional session have their `frameId` rewritten to the main frame. The COOP request that started in the old process is *adopted* by matching URL (`_adoptRequestFromNewProcess`).
- **Site isolation:** WebKit's site isolation adds `type:'frame'` targets. Playwright put frame sessions behind `enableFrameSessions = revision >= 2245 && <= 2255`, so the feature was on for 11 revisions and is now **off** at 2378. Upstream's last 35 protocol commits (2026-07-16 → 10-16) are mostly "[Site Isolation] Web Inspector: …" (`FrameDOMAgent`, frame targets for Canvas, IndexedDB and DOMStorage). Expect `frame` targets to return.
- **Realms (`wkExecutionContext.ts`):** `Runtime.executionContextCreated{id, type:'normal'|'user'|'internal', name, frameId}`. `normal` is the main world, and `user` with the utility name is the utility world. Evaluation uses `Runtime.evaluate{contextId, returnByValue}` and `Runtime.callFunctionOn{objectId, arguments, returnByValue, emulateUserGesture:true, awaitPromise:true}`. Handles are released with `Runtime.releaseObject`.
- **Input (`wkInput.ts`):** keyboard, mouse, wheel and tap go to the **page-proxy** session (`Input.dispatch*`, native events). `insertText` and `updateScrollingState` go to the target session.
- **Interception (`wkInterceptableRequest.ts`):**
  - Abort is `interceptRequestWithError{errorType}`.
  - Fulfil is `interceptRequestWithResponse{status,headers,content,base64Encoded}`. Redirect statuses are rejected.
  - Continue is `interceptWithRequest{url,method,headers,postData}`.
  - Bodies are fetched with `Network.getResponseBody`.
  - The response stage exists upstream but Playwright doesn't use it.

### 1.4 How `protocol.d.ts` is generated
`utils/roll_browser.js webkit <rev>` downloads the build and calls `generateWebKitProtocol(executablePath)`. That reads **`protocol.json` from the root of the build zip**, which is the combined protocol JSON for that exact revision, and runs `jsonToTS({domains})`. The generator filters out iOS-only commands (`condition === 'defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY'`). The result is about 10,105 lines and 34 domains, emitted as `CommandParameters`, `CommandReturnValues` and an `EventMap`. A second script, `update-webview-protocol.js`, builds `webview/protocol.d.ts` (8,452 lines) from **upstream** `Source/JavaScriptCore/inspector/protocol/*.json` via the GitHub API. **Implication:** we can generate Effect `Schema`s from the `protocol.json` inside each installed build, and **verify our schemas against it at launch**.

### 1.5 Builds, ports, distribution and license
- **Not Safari.** `docs/src/browsers.md`: "derived from the latest WebKit main branch sources… Playwright doesn't work with the branded version of Safari since it relies on patches". Codecs also differ by OS.
- **Ports:**
  - macOS: the real Cocoa port in a bare embedder, without Safari's app-level features (extensions, Apple Pay, FairPlay, Private Relay).
  - Linux: GTK for headed runs, WPE for headless (GStreamer, libsoup).
  - Windows: WinCairo `win64` (curl networking, `--disable-accelerated-compositing`), or `webkit-wsl`.
- **CDN:** mirrors in order are `cdn.playwright.dev/dbazure/download/playwright`, then `playwright.download.prss.microsoft.com/dbazure/download/playwright`, then `cdn.playwright.dev`. Path: `builds/webkit/<rev>/webkit-{ubuntu-22.04|24.04|26.04, debian-12|13, mac-14|15|26}[-arm64].zip` or `webkit-win64.zip`. Ubuntu 20.04 and macOS 13 and older have no builds. Host override: `PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST`.
- **License:** the repo is Apache-2.0 and the new patch files are BSD-2. WebKit itself is LGPL-2.1 (WebCore, JavaScriptCore) plus BSD, so the binaries are LGPL-derived. Source is available as the upstream revision plus the public patch.

### 1.6 Can a third party use these builds?

**Legally:** probably yes. Spawning an LGPL/BSD binary and speaking JSON over a pipe imposes no copyleft on our code. Don't re-host the zips, because re-hosting carries LGPL source obligations. Resolve them from Playwright's CDN, or reuse `~/.cache/ms-playwright/webkit-<rev>`. Microsoft has published no statement that permits or forbids this, and there is no SLA. A HEAD request on `…/builds/webkit/2378/webkit-ubuntu-24.04.zip` returns 200 at 108.8 MB.

**Practically:** the protocol has no version handshake, only the build revision.
- **Roll frequency:** 168 "roll to rNNNN" commits from r2122 (2025-01-02) to r2378 (2026-10-16), about **7.7 per month**.
- **How often the protocol changes:** `protocol.d.ts` changed in 48 commits, so **about 27% of rolls change the protocol**. Breaking examples:
  - r2137 removed the `ApplicationCache` domain.
  - r2221 removed `Page.frameStartedLoading/frameStoppedLoading/frameScheduledNavigation`.
  - r2235 removed `Page.accessibilitySnapshot`.
  - r2378 made `Emulation.setAuthCredentials.credentials` required.
- **Revision gates in Playwright's own code:** the `enableFrameSessions` 2245–2255 window above, and "Since https://commits.webkit.org/298732@main, WebKit doesn't provide frame id for navigations converted into downloads".
- **Patch mirroring:** patches are developed in an internal `playwright-browsers` repo and mirrored roughly monthly (`roll_from_upstream.sh`).
- **Existing direct clients:**
  - `salamaashoush/ferridriver` (Rust, "Minimal serde-typed surface of Playwright's WebKit Inspector protocol"). It tracks Playwright main's `browsers.json` without pinning.
  - `itsjamie/bperf` (Rust).
  - `hardkoded/playwright-native` (C#).

**Conclusion:** pin to one Playwright release's revision, regenerate Schemas per roll, and own a compatibility test suite.

### 1.7 Bonus route found in Playwright main: stock WebKit Inspector Protocol (`webkit/webview/`)
- **What it is:** Playwright main (since #41010 "wk_webview experiment", May 2026) contains `WVBrowser`, reached through `webkit.connectOverCDP(endpointURL | ConnectOverCDPTransport)`. The client throws "only supported in Chromium and WebKit". It is undocumented. It attaches to **unpatched** WebKit, either through `ios_webkit_debug_proxy` (`GET <proxy>/json` → `webSocketDebuggerUrl`; "No Mobile Safari tabs found … — open Safari first") or through a caller-supplied transport.
- **Missing on stock WebKit, and the workarounds Playwright uses:**
  - **Navigation:** no `Page.navigate`, so it runs `window.location.href = url`. Only the main frame can be navigated ("Navigating subframes is not supported on stock WebKit RDP").
  - **Input:** no `Input` domain. Keyboard and mouse events are **synthesized in page JS** (`__pwWebViewInput.mouseMove/keydown/insertText`), so `isTrusted === false`.
  - **Bindings and dialogs:** no `Runtime.addBinding` and no `Dialog` domain. A local **`SyncServer`** (HTTP on 127.0.0.1 with GUID paths) receives **synchronous XHR** from injected scripts, and a dialog bridge monkey-patches `alert/confirm/prompt`.
  - **Same-document navigation:** no `navigatedWithinDocument`. It patches `History.prototype.pushState/replaceState` and reports through `console.debug('__pw_same_document_navigation__', href)`.
  - **Not implemented:** new pages and contexts, viewport emulation, file choosers, screencast, permissions, geolocation, offline, and HTTP credentials. These throw "Method not implemented".
  - **Cookies** go through page-scoped `Page.getCookies/setCookie/deleteCookie`.
- **What works on stock WebKit:** `Runtime.*`, `DOM.*`, `Network.*` events, **interception** (`Network.addInterception`), `Page.setBootstrapScript` init scripts, `Page.snapshotRect` screenshots, workers, console, and `Target.*` provisional swaps (`Target.setPauseOnStart`).
- **Why it matters:** this is the realistic iOS Safari / WKWebView route (Route 5) and the floor for any WebKit backend.
- **Linux equivalent:** stock WebKitGTK and WPE apps (Epiphany, Cog, MiniBrowser) expose the same unpatched protocol when started with `WEBKIT_INSPECTOR_HTTP_SERVER=host:port` and `enable-developer-extras`. `UIProcess/Inspector/glib/RemoteInspectorHTTPServer.cpp` serves `/` as an HTML target list (not `/json`) and a WebSocket at `/socket/<connectionID>/<targetID>/<type>`, which routes to `RemoteInspectorClient::sendMessageToBackend`.


## Route 2: real Safari over WebDriver BiDi (Safari Technology Preview)

### Where the code lives
- **Browser side (shared with GTK/WPE):** BiDi is implemented in WebKit's UI process, in `Source/WebKit/UIProcess/Automation/WebDriverBidiProcessor.cpp` plus one agent per module: `BidiBrowserAgent`, `BidiBrowsingContextAgent`, `BidiScriptAgent`, `BidiInputAgent`, `BidiStorageAgent`, `BidiPermissionsAgent`, `BidiSessionAgent`, `BidiUserContext` and `BidiDigitalCredentialsAgent`. Dispatchers are generated from `protocol/Bidi*.json`, and `PlatformEnableCocoa.h` enables `ENABLE_WEBDRIVER_BIDI`.
- **Driver side (`safaridriver`):** closed source. It relays to the browser through the Automation protocol (`Automation.json`: `processBidiMessage{message}`, event `bidiMessageSent`, `emitActiveBidiScriptRealmCreatedEvents`).
- **Command surface on WebKit `main` (2026-10):**

| Module | Commands | Events |
|---|---|---|
| `session` | `subscribe`, `unsubscribe`, `status` | none |
| `browser` | `close`, `createUserContext`, `getUserContexts`, `removeUserContext` | none |
| `browsingContext` | `activate`, `captureScreenshot`, `close`, `create`, `getTree`, `handleUserPrompt`, `locateNodes` (CSS only), `navigate`, `reload`, `setViewport`, `traverseHistory` | `contextCreated/Destroyed`, `navigationStarted/Committed/Failed/Aborted`, `fragmentNavigated`, `domContentLoaded`, `load`, `userPromptOpened/Closed` |
| `script` | `addPreloadScript`, `removePreloadScript`, `evaluate`, `callFunction`, `disown`, `getRealms` | `realmCreated`, `realmDestroyed` |
| `input` | `performActions`, `releaseActions` (landed 2026-10-07/13), `setFiles` (returns NotImplemented) | `fileDialogOpened` |
| `storage` | cookie commands | none |
| `log` | none | `entryAdded` |
| `permissions` | `setPermission` (`storage-access` only) | none |

  **Absent:** `network`, `emulation`, `webExtension`, `script.message`/channels, `session.new` (PR #75992 is open, GLib-only), and `print`.
- **Cocoa-specific gaps:** `createUserContext` returns "User context creation is not implemented for this platform yet." `callFunction` ignores `awaitPromise`, `resultOwnership` and `serializationOptions`.

### Enabling it
1. Run `safaridriver --enable`, or turn on Settings → Developer → "Allow remote automation…".
2. Use STP's own driver, `/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver`.
3. Send `POST /session` with **both** `webSocketUrl: true` and `safari:experimentalWebSocketUrl: true`. Selenium PR #17729 (merged 2026-07-14): "Safari only exposes a usable BiDi websocket when both `webSocketUrl` and the vendor `safari:experimentalWebSocketUrl` capabilities are set". The Ruby bindings warn "Safari's WebDriver BiDi support is experimental".

### Observed gaps
Selenium marks these specs pending for Safari and Safari Preview (as of July 2026):
- "Safari does not support BiDi user contexts or getClientWindows"
- "Safari does not support the BiDi network domain"
- "Safari does not deliver BiDi log entries for console messages"
- "Safari does not support BiDi browsingContext.traverseHistory" (since added on main)
- "Safari always reports session.status ready: true"
- "Safari does not focus the activated context"

### Release notes, one by one
- **STP 254 (2026-10-08, 321068–322634@main):** "Added initial support for the WebDriver BiDi `browsingContext.captureScreenshot` command, which captures the page viewport as a PNG" (321353@main). Classic fixes: serialized per-session command queue, navigation-wait hang, stale-element error.
- **STP 253 (2026-09-23):** "Fixed … WebDriver BiDi's `script.call_function` trimmed error messages incorrectly" (320205@main), plus classic cookie and modifier-key fixes.
- **STP 252 and 251:** no WebDriver entries.
- **STP 250:** "consume user activation" extension command.
- **STP 248 and 249:** WebDriver Digital Credentials commands.
- **STP 247 (2026-07-01):** Safari MCP server, and a fix for clipped full-page screenshots.
- **STP 229 (2025-10-02):** storage-access endpoints (classic).

I did not read every 2025 release, so the date BiDi first appeared in STP notes is unconfirmed (see Open questions).

### Signals for stable Safari
- "WebKit Features for Safari 27.0" (2026-09-17) never mentions BiDi.
- WPT's Safari runs (`safari-254_preview`, macOS 27.0, bundle 22627.1.2.1) have 402 BiDi files reporting `OK` with every subtest `ERROR: setup error: StopAsyncIteration`, and 26 files timing out. In other words, the harness never gets a BiDi socket.
- Apple has made no roadmap statement. All BiDi agent commits since mid-2025 are mostly by Apple engineers (Burg, Deh, Panta, Caliman, Olusanya). The direction is clear but the date is not.

### Safari MCP (Safari 27+ and STP)
`/usr/bin/safaridriver --mcp` is an MCP stdio server with 17 tools: tabs, `navigate_to_url`, `evaluate_javascript`, `screenshot`, `page_interactions`, `browser_dialogs`, `browser_console_messages`, `list_network_requests`/`get_network_request` (headers, body, timing), `set_viewport_size` and `set_emulated_media`. It is the only *stable-Safari* surface with console and network observation, but it is polled, coarse, unversioned and agent-oriented. Not a backend target.

## Route 3: Igalia's WebKitGTK/WPE BiDi (`WebKitWebDriver`, `WPEWebDriver`)

### Architecture
- The same UI-process agents as Route 2. The driver is open source (`Source/WebDriver/`), with a libsoup WebSocket server on `--bidi-port`.
- The driver handles only `session.status` itself (`s_bidiCommands[] = {"session.status"}`) and relays everything else via `processBidiMessage`.
- **Hard limits:** "BiDi-only sessions are not supported yet. Rejecting handshake." You need Classic `POST /session` with `webSocketUrl:true`, then `ws://host:port/session/<id>`. There is one session per driver process ("FIXME Properly support multiple sessions"), and no `wss`.
- `createUserContext` works on GLib ports, unlike Cocoa.

### Availability
- `ENABLE_WEBDRIVER_BIDI` defaults to `${ENABLE_EXPERIMENTAL_FEATURES}`, which is **OFF** in tarball builds on every branch from 2.48 to 2.54. It first appeared in 2.47.4 as "experimental".
- Debian (`webkitgtk-webdriver` 2.54.1), Fedora and Arch packages don't enable it.
- **Practical source:** Igalia's relocatable bundles at `https://webkitgtk.org/built-products/x86_64/release/{nightly,beta,stable}/MiniBrowser/LAST-IS` (about 250 MB, kept for about 1 month), the same ones WPT uses.
- Capabilities: `webkitgtk:browserOptions{binary,args,certificates,targetAddress}` and `wpe:browserOptions`.

### Coverage on wpt.fyi (2026-10-18)
Overall: WebKitGTK 2.55.0 (main) **1338/5732**, WPE 1327/5838, Chrome 6079/6310, Firefox 5717/6496. That is up from 331/4779 a year earlier.

| Module | Passing (WebKitGTK) |
|---|---|
| browsingContext | 406/1147 |
| script | 284/1012 |
| input | 516/691 |
| storage | 25/348 |
| log | 3/87 |
| **network** | **2/922** |
| **emulation** | **0/810** |

Meta bug 281932 tracks the work: 26 dependent bugs, 17 of them open.

**Verdict:** usable on Linux CI as a *conformance and smoke* "WebKit via BiDi" lane, pinned to a bundle snapshot you mirror yourself. Not a primary WebKit backend for 12–24 months.

## Route 4: classic WebDriver via `safaridriver` (macOS)

### Apple's documented constraints ("About WebDriver for Safari")
- "Only one Safari browser instance can be active at any given time, and only one WebDriver session at a time can be attached to the browser instance."
- "Test execution is confined to special automation windows … recognize these windows by their orange Smart Search field. Like a private browsing session, an automation session always starts from a clean slate."
- "Safari installs a transparent 'glass pane' over the automation windows … If a running test gets stuck, you can interrupt it by 'breaking' the glass pane … the test's connection to the browser is permanently severed."

### Setup and capabilities
- Run `safaridriver --enable` once.
- STP has its own driver, and the two drivers can run side by side.
- `safari:automaticInspection` and `safari:automaticProfiling` (plus the experimental BiDi capability above).

### What's possible
- The Automation protocol (`Automation.json`, 48+ commands) is what `safaridriver` speaks to Safari: browsing contexts, navigation, `evaluateJavaScriptFunction`, trusted `performInteractionSequence`/`performKeyboardInteractions`, `takeScreenshot`, frame resolution, accessibility role and label, dialog accept/dismiss/text, file upload, cookies, `GetUserMedia` session permission, virtual authenticators, web extensions (macOS), and storage-access policy.
- All of it is request/response. There is **no browsing-context-created event** (`browsingContextCleared` is the only one).

### What's impossible
- Network events or interception.
- Console logs.
- Preload or init scripts.
- Isolated worlds.
- Multiple contexts.
- Downloads.
- Headless runs.
- Parallel sessions on one Mac.
- Attaching to the user's profile.

`Automation.sendInspectorMessage`/`receiveInspectorMessage` ("Relay a Web Inspector backend message … when the session permits Inspector-protocol testing") exist under `ENABLE(REMOTE_INSPECTOR)`. They appear to be internal test plumbing; I found no public WebDriver endpoint for them.

## Route 5: iOS Safari and WKWebView

- **Remote inspector transport:**
  - On device, `webinspectord` exposes the lockdown service `com.apple.webinspector`, or `com.apple.webinspector.shim.remote` over the iOS 17+ RSD tunnel (pymobiledevice3 `services/webinspector.py`). The Simulator uses a unix socket.
  - Messages are binary-plist RPC: `_rpc_reportIdentifier:`, `_rpc_getConnectedApplications:`, `_rpc_forwardGetListing:`, `_rpc_forwardSocketSetup:`. Inspector JSON travels inside `_rpc_forwardSocketData:{WIRSocketDataKey}` and comes back as `_rpc_applicationSentData:{WIRMessageDataKey}`.
  - WKWebViews require `isInspectable = true` (iOS 16.4+).
- **Stock WebKit Inspector protocol (WIP) clients** on that transport:
  - `google/ios-webkit-debug-proxy` (`/json` plus per-page WebSocket). v1.9.2 shipped 2025-07-02 and maintenance is low; open issues include Target-routed CSS hangs and large messages.
  - Appium's `remote-debugger`, now in `appium/appium-ios`, last released 2026-09-21. It drives pages with Selenium atoms.
  - pymobiledevice3.
  - Playwright's `WVBrowser` (1.7).

  Capabilities stay at the stock floor described in 1.7.
- **Automation over webinspectord.** pymobiledevice3 sends `_rpc_forwardAutomationSessionRequest:` and then speaks **`Automation.*` itself** (`createBrowsingContext`, `evaluateJavaScriptFunction`, `takeScreenshot`, `getAllCookies`). In other words, it is its own `safaridriver` for iOS when Settings → Safari → Advanced → Remote Automation is on. This private protocol also carries `processBidiMessage`. Whether iOS Safari builds enable BiDi is unknown.
- **`safaridriver` for iOS (classic).** `platformName: iOS` with `safari:useSimulator` or `safari:deviceUDID`. It requires `safaridriver --enable` on the Mac host and Remote Automation on the device. Safari 27 notes say WebDriver now "launch[es] Device Hub instead of Simulator". **No iOS BiDi** in any source found.
- **Playwright** has never supported real iOS Safari via launch. Its "Mobile Safari" device descriptors are desktop WebKit with emulation.

## Capability matrix

Key:
- **Y**: supported.
- **P**: partial.
- **N**: not supported.
- **poll**: obtainable only by polling.
- **shim**: emulated in injected page JS.

| Feature | 1 PW-patched WebKit | 1.7/5 stock WIP (iOS, WKWebView, GTK inspector) | 2 Safari BiDi (STP) | 3 GTK/WPE BiDi | 4 safaridriver classic | 5 iOS safaridriver |
|---|---|---|---|---|---|---|
| Real Safari app | N (WebKit main) | Y on iOS | Y | N | Y | Y |
| OS | Linux, macOS 14+, Windows | iOS (host: macOS or Linux usbmuxd), Linux | macOS | Linux | macOS | iOS via macOS |
| Own process / headless | Y / Y | N (attach) / n/a | Y / N | Y / P (WPE) | Y / N | Y / N |
| Parallel isolated contexts | Y | N | N (Cocoa) | Y | N (1 session/Mac) | N |
| Page/popup events (opener) | Y | poll `/json` | Y | Y | N | N |
| Frame tree and nav lifecycle | Y | P (no frameAttached; same-doc via shim) | P | P | N | N |
| Evaluate, handles, realms | Y | Y | P | P | P (JSON only) | P |
| Isolated world | Y | N | P (preload sandbox, unverified) | P | N | N |
| Init scripts | Y | Y | P (`addPreloadScript` defined; untested) | P | N | N |
| Trusted input | Y (native) | N (shim) | P (performActions just landed) | P | Y | Y |
| Network events | Y | Y | N | N | N (MCP: poll) | N |
| Request interception | Y (request stage; response stage upstream) | Y (`addInterception`) | N | N | N | N |
| Console | Y | Y | N (not delivered) | P | N (MCP: poll) | N |
| Dialogs | Y | shim | Y | Y | Y (blocking endpoints) | Y |
| Downloads | Y | N | N | N | N | N |
| Screenshot / video | Y / Y | Y / N | P (viewport) / N | P / N | Y / N | Y / N |
| Emulation (viewport, UA, tz, geo, perms, offline) | Y | P (UA, media) | P (viewport) | P | P (window size) | N |
| Cookies | Y (context) | P (page-scoped) | P | P (WPT storage 25/348) | Y | Y |
| File upload | Y | N | N | N | Y | P |
| Protocol stability | revision-pinned, ~27% of rolls change it | upstream, varies per Safari version | spec-stable, implementation partial | same | stable | stable |

## Recommendation

### Order of backends
1. **P0: `WebKit.playwright` (Route 1).**
   - **Why first:** the only WebKit target that can satisfy the full core contract: contexts, interception, trusted input, downloads, dialogs and screencast.
   - **How:**
     - Implement it as the **patched profile of a single WIP client**.
     - Pin `revision` to a Playwright release's `browsers.json` and resolve builds from Playwright's CDN or an existing `ms-playwright` cache (don't re-host).
     - Generate Schemas from that build's `protocol.json`.
     - Run a compatibility probe at launch.
2. **P1: `BiDi` with `Safari` and `WebKitGTK` quirk profiles (Routes 2 and 3).**
   - **Why:** this is the only standards path to *real Safari*, and it shares code with the Firefox and Chromium BiDi backends.
   - **Quirk profiles carry:**
     - the extra capability (`safari:experimentalWebSocketUrl`);
     - Classic-first bootstrap;
     - single-session locking;
     - "status always ready";
     - a capability set computed by probing.
   - **Status:** ship it labelled *experimental*.
3. **P2: `WebKit.attach` (stock profile).**
   - **Targets:** iOS via `ios_webkit_debug_proxy` (later our own webinspectord/usbmux transport), inspectable WKWebViews, and WebKitGTK `WEBKIT_INSPECTOR_HTTP_SERVER`.
   - **Cost:** about 70% of the code is shared with P0, as Playwright's near-mirror `wv*.ts` / `wk*.ts` files show.
4. **P3, optional: `Safari.classic`.**
   - **Scope:** a deliberately small backend (navigate, evaluate, locate, actions, screenshot, cookies, dialogs) for stable Safari until BiDi ships.
   - **Not targeted:** `--mcp`.

### How each route shows up to users (API ergonomics)

**Identical common path.**
```ts
const run = Effect.gen(function* () {
  const page = yield* Browser.page            // launchers: new page; attachers: lease an existing tab
  yield* page.goto("https://example.com")
  yield* page.locator("role=button[name='Sign in']").click()
  return yield* page.evaluate(() => document.title)
})
run.pipe(Effect.provide(WebKit.playwright({ revision: "2378" })))
run.pipe(Effect.provide(Safari.bidi({ channel: "technology-preview" })))
run.pipe(Effect.provide(WebKit.attach({ endpoint: "http://localhost:9221" })))
```
`Browser.page` is `Effect<Page, BrowserError, Browser | Scope>`. Launchers create a page and close it with the `Scope`. Attachers take an exclusive lease on a tab with a `Semaphore` and navigate it back to `about:blank` on release. So `newPage` isn't on the common path.

**Capabilities as services in `R`.**
- Each backend `Layer` provides `Browser` plus the capability tags it truly supports: `Cap.Interception`, `Cap.TrustedInput`, `Cap.Contexts`, `Cap.Downloads`, `Cap.Screencast`, `Cap.NetworkEvents`, `Cap.Console`, `Cap.InitScripts`, `Cap.IsolatedWorlds`.
- Capability APIs require their tag. For example, `page.route(pattern, handler): Effect<void, never, Cap.Interception | Scope>`.
- `Effect.provide(Safari.bidi())` followed by `page.route(…)` is therefore a **type error**, which is what you want when the backend is known statically.

**Runtime-chosen backends** (test matrices, environment variables):
- `Backend.dynamic(config)` provides *every* tag. A missing capability is a stub that fails with:
  ```ts
  class Unsupported extends Data.TaggedError("Unsupported")<{
    capability: CapabilityId; backend: BackendId; reason: string
    alternatives: ReadonlyArray<BackendId>
  }> {}
  ```
- `Unsupported` is kept separate from `NotImplementedYet` (the protocol could, we haven't) and `ProtocolError`.
- A `Capabilities` service exposes a Schema'd record, for example `{ input: "native" | "webdriver" | "synthetic", interception: { phases }, contexts: "isolated" | "single", ownership: "launched" | "attached", engine: "webkit-main" | "safari" | "webkitgtk" | "wpe" }`.
- That record supports `Effect.when` branching and test skipping.

**No silent degradation.**
- Fallbacks are an explicit backend option and are visible in spans. Examples: synthetic input on stock WIP, polling `/json` for pages, the History-patch same-document shim, the sync-XHR binding bridge.
- Defaults:
  - `WebKit.attach` defaults to `fallbacks: "allow"`, since synthetic input is that backend's only option.
  - Everything else defaults to `"forbid"`, which raises `Unsupported` instead.
- `Capabilities.input` reports which kind of input ran.

## Lessons for a protocol-neutral core (each mapped to Effect primitives)

*Primitive names are as I know them. Check for renames in `effect@4`.*

1. **Session addressing is not uniform.**
   - CDP uses a flat `sessionId`.
   - Patched WebKit has three levels: browser, then `pageProxyId` (a top-level key), then `targetId` (JSON-in-JSON via `Target.sendMessageToTarget`).
   - Stock WebKit uses one WebSocket per page plus `Target.*`.
   - BiDi puts the `context` inside params.

   The core sees one `ProtocolSession { send: (method, params) => Effect<A, ProtocolError>; events: Stream<Event> }`. Inside the implementation:
   - Sub-sessions live in an `RcMap<SessionKey, Session>`.
   - Each in-flight request has a `Deferred`, owned by the connection fiber.
   - On transport close, all pending requests fail with `ProtocolError.Closed`. A sub-session's `Scope` finalizer fails only its own requests.
2. **Process swaps make the page's session mutable** (`isProvisional` → `didCommitProvisionalTarget`).
   - Keep the current session in a `SubscriptionRef`.
   - Keep page configuration (init scripts, UA, emulation, intercept patterns, bindings) as declarative state. A `PageSetup` effect re-applies it to every new target.
   - Paused targets resume under `Effect.ensuring(resume)`, so an interrupted setup can't leave a frozen tab.
   - CDP's `setAutoAttach{waitForDebuggerOnStart}` + `runIfWaitingForDebugger` is the same pattern, so this belongs in the core.
3. **Realms die with processes** ("Worlds are per-process").
   - Every handle belongs to a realm `Scope`, a child of the page `Scope`. It closes on `executionContextDestroyed`, a target swap or `script.realmDestroyed`.
   - Using a handle afterwards fails with a typed `StaleHandle`.
   - Isolated worlds are a capability. Stock WebKit has none.
4. **Input fidelity is a backend property.** The three levels are native (patched WebKit or CDP `Input.*`, BiDi `performActions`), webdriver (classic actions) and synthetic (stock WebKit JS). Keep the `Locator.click` signature everywhere, and report the fidelity level in `Capabilities` and in spans.
5. **Interception differs in phases and shape.**

   | Protocol | Phases | Notes |
   |---|---|---|
   | CDP `Fetch` | request, response, auth | |
   | WebKit Inspector | request, response | regex URLs; no auth phase (credentials preset via `Emulation.setAuthCredentials`); redirect fulfil rejected |
   | BiDi | beforeRequestSent, responseStarted, authRequired | |
   | Classic WebDriver | none | |

   Model `Interception` as a capability carrying its set of `Phase`s. Handlers run in a `FiberMap<RequestId>`. `Effect.onExit` guarantees that every paused request is resolved exactly once, defaulting to `continue` on interruption or when the page `Scope` closes, so the network never stalls.
6. **Ordering.** Playwright warns: "do no introduce await in this function, otherwise we lose the ordering."
   - One reader fiber per connection decodes with `Schema` and publishes in arrival order to a per-session `Queue`.
   - Derived state (frame tree, request map) is updated synchronously in that fiber *before* events are re-emitted through `PubSub`.
7. **Revision-pinned protocols.**
   - Generate Schemas from `protocol.json` and decode with `onExcessProperty: "ignore"`.
   - Log unknown events instead of failing.
   - When the browser is acquired, diff the build's `protocol.json` against our compiled schemas and fail with `IncompatibleBrowserRevision{missing}`.
8. **Ownership.** Encode `launched | attached` in the `Browser` resource. The `Scope` finalizer kills the process (`Command` + `acquireRelease`) or only detaches. Attached backends (iOS, the GTK inspector server, WKWebView) usually can't create pages or contexts, which is why the common path uses `Browser.page` leases.
9. **Polled discovery.** `ios_webkit_debug_proxy` only has `GET /json`. Synthesize page events with a scheduled poll (`Stream` + `Schedule.spaced`) and `Stream.changes`, so `pages: Stream<PageEvent>` has the same type on every backend.
10. **Single-client constraints.** The patched-WebKit WebSocket server accepts one connection. `safaridriver` allows one session per Mac, and `WebKitWebDriver` one per process. Model the browser as an `RcRef`/`Layer.scoped` singleton and multiplex contexts inside it. Guard launch with a `Semaphore(1)` per backend and profile.
11. **Dialogs deadlock evaluation.** A modal `alert` blocks `Runtime.evaluate`. Require a dialog policy: `Stream<Dialog>` with a default dismiss after a `Duration`, and race evaluations against dialog-opened events.
12. **Popups and downloads arrive at different layers.** Patched WebKit sends browser-level events keyed by `pageProxyId`/`openerId`; BiDi sends context events. Normalize both into page-scoped `Stream`s with a stable opener field.

## Open questions

1. Does `safari:experimentalWebSocketUrl` work with **stable** Safari 27's `/usr/bin/safaridriver`, or only in STP? Selenium's CI tests STP only. Also: which STP release first exposed BiDi? I didn't read the 2025 notes before STP 229.
2. When does WebKit get a `BidiNetworkAgent` (interception) and an `emulation` module? Neither exists on `main`, and meta bug 281932 has 17 open dependencies. This decides whether BiDi can ever replace Route 1 for WebKit.
3. What powers `safaridriver --mcp`'s network and console tools? Is it `Automation.sendInspectorMessage` or something else, and will Apple expose a public inspector pass-through for automation sessions? Such a pass-through would make a "Safari BiDi + WIP" hybrid backend possible on stock Safari.
4. Does iOS Safari (iOS 26 or 27) accept BiDi through `safaridriver` (`platformName: iOS`) or through a webinspectord automation session (`processBidiMessage`)? No evidence either way.
5. Microsoft's stance on third-party use of `cdn.playwright.dev` WebKit builds. Nothing published either way. Should we rely on users' existing `ms-playwright` caches by default?
6. Which iOS versions ship `Network.addInterception` with both stages, and `Target.setPauseOnStart`? This is the stock-profile floor for iOS. It needs a device matrix test.
7. Site isolation: when Playwright re-enables `frame` targets (its experiment was gated to r2245–2255), will WebKit's per-frame agents force a CDP-OOPIF-like session tree into the WIP profile?
8. Will Playwright's own `webview` experiment become public API? If so, its shims (`SyncServer` binding/dialog bridge, synthetic input) become a de facto reference for the stock profile.
