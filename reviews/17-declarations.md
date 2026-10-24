# Design review: declarations

*2026-10-23. Review of commit `e59eacd` (interacting and asserting built, after review 16) on the declarations, which are all still declared but not built: routes, init scripts, emulation, permission grants and the page clock, with the automatic decision for a paused request. Prompted by the maintainer: "Okay, let's do the next batch", batch 2 of the five proposed after review 14. This commit records the review only.*

L0 has carried all of this since review 08. Every adapter takes intercepts, init scripts and overrides as scoped declarations, pauses requests as obligations, and grants permissions, and the conformance suite checks each on all three backends. What is missing is everything above it:

- **Routes.** No handler decides a paused request yet. `Route`'s decisions are declarations with nothing behind them, `Intercepted.fetch` has no mechanism, and `AutoResolution`'s `PausedRequest` subject is never published.
- **Init scripts.** `after` and `DependencyReleased` exist only as types, and L0 orders scripts without knowing their dependencies.
- **Emulation.** `emulate` and `UserContext.Options.emulation` map onto L0's overrides one field at a time, but nothing says which field each backend can apply, or whether it takes effect at once or at the next document.
- **Permissions.** L0's reset clears every grant in a context, so removing one registration would remove the others.
- **The page clock.** It has no implementation at all: no backend has a clock to drive, so it has to be ours.

`UserContext.Options.storageState`, cookies and origin storage stay in batch 3 (storage), and attaching to a running browser in batch 4.

## What the browsers do

Probed through the three adapters on the pinned builds, and Firefox through raw BiDi (a throwaway test, not kept). The site gained `/echo`, which answers with the request it got, and `/auth`, a Basic challenge.

**Routes**

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** A navigation fulfilled at the request phase, with `Set-Cookie` | commits the route's document; the cookie is set | the same | the same |
| **P2.** A fetch fulfilled with `302` and `Location` | followed; the target pauses too, as the request's next hop | the same | not followed: the page's fetch gets the `302` itself |
| **P3.** Continued with a new URL, method, headers or body | each applied, a cross-origin URL too | method and headers applied; a body of the same length applied, a longer one arrives broken (Firefox keeps the old `Content-Length`); a new URL aborts the request | each applied |
| **P4.** A navigation failed with each reason the adapter contract has | `net::ERR_FAILED`, `ERR_TIMED_OUT`, `ERR_ACCESS_DENIED`, `ERR_CONNECTION_REFUSED`; `aborted` leaves the navigation without an end (the adapter's) | `NS_ERROR_ABORT` for every reason | "Blocked by Web Inspector" for every reason |
| **P5.** The response phase | status and headers; the adapter can't read the body, though `Fetch.getResponseBody` can; a fulfill replaces the response; a continue with new headers ignores them | status and headers, no body; a fulfill is `Unsupported` (`network.provideResponse`) and leaves the request paused; a continue with new headers replaces the response's | status and headers, no body; a fulfill replaces the response; new headers are ignored |
| **P6.** A Basic challenge | the adapter's auth intercept pauses the `401` at the response stage, and `continueWithAuth` is refused (the adapter's) | credentials sign in; cancel shows the `401` page; the default leaves the navigation waiting on Firefox's own prompt, headless, forever | unsupported (WebKit answers challenges from credentials set in advance) |
| **P7.** A navigation that redirects | each hop pauses: one request, redirect count 0 then 1 | the same | only the first hop pauses |
| **P8.** A dedicated worker's fetch | pauses, attributed to its page | the same | the same |
| **P9.** A cross-origin fetch fulfilled without, then with, CORS headers | fails, then arrives | the same | the same |
| **P9.** A cross-origin `PUT` with a custom header | the `OPTIONS` preflight pauses first, then the `PUT` | only the `PUT` pauses | only the `PUT` pauses |
| **P10.** A `POST`'s body at the pause | in `Fetch.requestPaused` (`postData`); the adapter drops it | `network.getData` gives it, with a request data collector | in `Network.requestIntercepted` (`postData`); the adapter drops it |
| **P11.** A paused request's resource type | a `fetch()` is `XHR` at the pause, `Fetch` in the network events | as in the events | `other` for every pause |

**Init scripts**

| Probe | Chromium | Firefox | WebKit |
|---|---|---|---|
| **P12.** Order: two page scripts and a context script, registered page, context, page | the context's first, then the page's, each in registration order | the same | the same |
| **P12.** What a script sees | no `document.documentElement` yet | the same | the same |
| **P12.** A script that throws | the next still runs; the throw reaches the console | the same | the same |
| **P12.** An isolated-world script | runs, and can't see the main world's globals | the same | `Unsupported` |
| **P12.** Same-origin and cross-site iframes | both run the page's scripts | the same | the same |
| **P12.** A script added after the page loaded, then removed | not in the current document; in the next; not after removal | the same | the same |

**Emulation**, declared on a loaded page, read at once, after a reload, and in a page created after it

| Probe | Chromium | Firefox | WebKit |
|---|---|---|---|
| **P13.** User agent | at once, everywhere | at once | requests at once; `navigator.userAgent` at the next document |
| **P13.** Viewport 400×700 at 2×, mobile | mobile layout: 980 CSS px wide without a `meta viewport`, DPR 2, `screen` 400 | 400 wide, DPR 2; `screen` and `mobile` unchanged | 400 at 2× at once; after a reload, 979 wide at DPR 0.82 |
| **P13.** Media type `print`, and features (reduced motion, forced colors, contrast, color scheme) | at once | `Unsupported` (`emulation.setMediaFeaturesOverride`) | at once; reduced motion is `reduce` without emulation |
| **P13.** Touch, 5 points | `maxTouchPoints` at once, `ontouchstart` at the next document | `Unsupported` | no effect: 0 points, and `ontouchstart` always there |
| **P13.** Locale | at once, page or context | the same | per context, and only before its pages exist |
| **P13.** Time zone | at once, page or context | the same | the same |
| **P13.** JavaScript disabled | at the next document | `Unsupported` | at the next document |
| **P13.** Offline | at once | the same | the same |
| **P13.** Focus emulation | `hasFocus()` is already true | `Unsupported` | `hasFocus()` false without it, true with it |
| **P14.** Geolocation, with the permission | the position | the position | the position, per context only |
| **P14.** Geolocation `"unavailable"` | error 2 | the declaration is rejected (`InvalidArgument`) | ignored: the position still arrives |

**Permissions and time**

| Probe | Chromium | Firefox | WebKit |
|---|---|---|---|
| **P15.** Each of the 12 names `Permission` lists most often, granted to an origin, then reset | each granted and reset; four are granted before (`clipboard-write`, `background-sync`, `storage-access`, `screen-wake-lock`) | `clipboard-read`, `clipboard-write`, `background-sync` and `local-fonts` rejected (`InvalidArgument`: not its names); `storage-access` `Unsupported`; the rest granted and reset | every name accepted, but its Permissions API can't query most of them; `storage-access` stays `denied` |
| **P15.** Granted to every origin | granted | `Unsupported` (WebDriver BiDi grants per origin) | granted |
| **P16.** `Date.now`, `performance.now`, `requestAnimationFrame` and `setTimeout` replaced in the main world by an environment-phase init script | the page sees the replacements; the isolated world keeps the real ones, and its frame fires | the same | the same |

## Candidates

### 1. Routes decide paused requests, as handlers decide dialogs

**Where:** `Route`; `page.route` and `context.route`; `src/internal/routes.ts` (new); the model's obligation fold.

**What changes.** A route is a handler registration over paused requests, built on review 13's mechanism for dialogs: a fiber of the registration's scope, with the requirements captured at `route` and `Deadline.DefaultBudget` as read then, per request, and a resolver in the model's scope that delivers the decision, apart from the handler.

- **Matching.** L1 declares an intercept wide enough for the pattern (its origin, or everything for a `URLPattern`) and matches the pattern itself, with `Url.Pattern`'s own rules, as event filters do. A paused request no route matches continues at once.
- **Which route decides.** The page's routes, then its context's; within each, the most recent first. A decision ends it, and `fallthrough` asks the next. `hits` counts the requests a route was asked about.
- **The default is continue.** It applies when every route falls through, or one fails, is interrupted, runs out of time, or returns a decision the backend can't apply. The failure is logged at `References.UnhandledLogLevel`, and the decision is published as an `AutoResolution{PausedRequest}` on the page and its context.
- **A route registers one phase**, `"request"` unless `options.phase` says `"response"` or `"auth"`. The handler's argument and its decisions are typed by it (candidate 2).
- **A decision a backend can't apply** fails with `Unsupported` before it is sent, and the default applies, so a request is never left paused (P5: Firefox left one paused after a refused fulfill).

**Recommendation.** Adopt.

### 2. Decisions are typed by phase

**Where:** `Route`.

**What changes.** `Decision<in P>` is a decision valid at the phases `P`. Because it's contravariant, one valid at more phases is accepted where fewer are asked for, so the module-level constructors and call sites 7 and the scenarios stay as they are:

- `continue`: any phase; at `auth`, the page gets the challenge's `401` response. Never the browser's own prompt, which waits forever on headless Firefox (P6).
- `fallthrough`: any phase.
- `continueWith(change)`: the request phase. `change` transforms an `HttpClientRequest`, and L1 sends what changed. A new URL is `Unsupported` on Firefox (P3), and a new body sends its own `Content-Length` there.
- `fulfill(response)`: the request and response phases. It takes an `HttpServerResponse`, read whole. A response-phase fulfill is `Unsupported` on Firefox (P5).
- `abort(reason?)`: the request and response phases. Without a reason, the page sees a failure on every backend. A reason is CDP's alone (`interception.abortReason`), since the others report one failure for every reason (P4).
- `provideCredentials(credentials)`: the auth phase.

The handler gets `Intercepted<P>`:

- at every phase, `request` and `requestBody`, the body as sent, if any (P10);
- at the response phase, also `response`, and `responseBody` where the backend can read it (`interception.responseBody`, CDP's `Fetch.getResponseBody`);
- at the auth phase, also `challenge` (origin, scheme, realm).

**`fetch` and `fetchWith` are removed** (Considered and not adopted). A response-phase route is how to see, and change, what the server sent.

**Recommendation.** Adopt.

### 3. What routes see differs, and is said

**Where:** API.md, Network; capabilities; QUIRKS.md.

**What changes.** Nothing is papered over:

- Chromium shows a route the preflight of a cross-origin request (P9), with method `OPTIONS`, and the others don't. A route that fulfills cross-origin requests on Chromium answers it too, or lets it continue to the server.
- A fulfilled cross-origin response needs CORS headers everywhere (P9).
- WebKit pauses only a redirect's first hop (P7), and doesn't follow a redirect a route fulfills (P2).

New capability entries:

- `interception.responseBody` (CDP);
- `interception.responseFulfill` (BiDi unsupported);
- `interception.continueUrl` (BiDi unsupported);
- `interception.abortReason` (CDP);
- `interception.redirects` (WebKit partial).

**Recommendation.** Adopt.

### 4. Init scripts, ordered and dependent

**Where:** `InitScript`; `page.addInitScript` and `context.addInitScript`; L0's bundle (`src/internal/declarations.ts`); the adapter contract.

**What changes.**

- **Sources.** A function is sent as `(${fn})()`, so it must be self-contained, as an evaluated function must; `{ source }` is a script; `{ path }` is read with the layer's `FileSystem` when the script is added, a relative path resolved with `Path`.
- **Order** is L0's, which the probe confirms on every backend (P12): the environment phase first, broader scopes first, then registration order. `after` therefore never reorders anything. It validates: a dependency must be in force and of equal or broader scope, or the registration fails with `DependencyReleased` or `InvalidInput`. And it gates: L0's `InitScript` declaration gains `after`, and the bundle runs a script only if each of its dependencies ran without throwing. The bundle is one block statement, so its bookkeeping is hidden from the page and the scripts' own top-level declarations stay global.
- **A dependency's removal** removes its dependents from future documents, in the same finalizer.
- **A script that throws** is reported with `reportError`, so it arrives as the page's `UncaughtException` rather than a console line.
- **Worlds.** The default is the main world. `world: "isolated"` runs in one isolated world for code of the caller's (`__strider_isolated__`), apart from the engine's, where `page.evaluate` will run when it is built. It is `Unsupported` on WebKit (P12).
- **Timing.** A script runs before anything of the document, with no `document.documentElement` yet (P12), in every frame, cross-site ones included. Added to a loaded page, it runs from the next document. `timing: "bestEffort"` is accepted; on the pages the library creates, every backend gives `beforeAuthorScript`.

**Recommendation.** Adopt.

### 5. Emulation: one registration per call, every field a capability

**Where:** `Emulation`; `page.emulate`, `context.emulate`, `UserContext.Options.emulation`; the adapters' overrides and capabilities.

**What changes.**

- **One registration per call.** An `emulate` call declares one override per field, in a scope of its own, and removing it removes them all. A field the backend can't apply fails the call with `DeclarationError{Unsupported}` naming it, before anything is applied. `UserContext.Options.emulation` is the same declaration, held for the context's life and made before its first page, which is what WebKit's locale needs.
- **Capability entries, named for the public fields,** say what each backend can do, and the adapters refuse what they can't rather than ignoring it:
  - `emulation.viewport`: every backend. `emulation.viewport.mobile`: unsupported on BiDi, which has no mobile flag.
  - `emulation.userAgent`, `emulation.timezone`, `emulation.network.offline`: every backend.
  - `emulation.locale`: partial on WebKit (per context, before its pages exist).
  - `emulation.geolocation`: partial on WebKit (per context). Its `"unavailable"` is unsupported on BiDi and WebKit (P14).
  - `emulation.media`, `emulation.javaScript`, `emulation.focus`: unsupported on BiDi.
  - `emulation.touch`: CDP only. WebKit ignored it (P13), which the adapter now refuses.
  - `emulation.network.throttling` and `emulation.cpuSlowdown`: CDP only, as two new L0 overrides (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`).
- **When it takes effect** is documented per field (P13). Most apply at once. JavaScript, touch handlers and WebKit's `navigator.userAgent` apply at the next document.
- **`focus: "emulated"`** in `UserContext.Options` is built, on the focus override.

**Recommendation.** Adopt.

### 6. Permission grants are registrations L1 recomputes

**Where:** `context.grant`, `UserContext.Options.permissions`.

**What changes.**

- **Recomputing.** L0's reset clears every grant in a context, so L1 keeps the grants in force and recomputes on each change: on a removal, it resets, then grants what remains.
- **Names.** A name a backend rejects (P15: Firefox's list is shorter) fails with `InvalidInput` naming it.
- **Every origin** (no `origin`) is `permissions.anyOrigin`, unsupported on BiDi.
- WebKit accepts any name, so its grants are taken as given.

**Recommendation.** Adopt.

### 7. The page clock is a shim of ours

**Where:** `PageClock`; `page.clock`, `context.clock`; `src/internal/clock.ts` (new).

**What changes.** No backend has an application clock to drive, so the clock is a script of ours:

- **The shim.** It is an environment-phase, main-world init script at the page's or context's scope that replaces:
  - `Date` (constructor and `now`);
  - `performance.now`;
  - `setTimeout` and `setInterval`, with their clears;
  - and in controlled mode, `requestAnimationFrame` and `cancelAnimationFrame`.
- **Modes and operations.**
  - **`fixed`** freezes wall time and leaves timers real.
  - **`offset`** shifts wall time.
  - **`controlled`** moves wall time, `performance.now`, timers and frames only when told. `adjust` advances it, running each due timer in order. `setTime` jumps it, running each due timer at most once.
  - **`resume`** turns any mode into an offset from now.
  - The wrong operation for the mode is `WrongMode`, and any operation before `install` is `NotInstalled`.
- **One timeline per scope** (CONCEPTS.md §7). L1 keeps the timeline's state: mode, the current time, the offset. Each operation is applied to every current document of the scope by evaluation in its main world, every frame included. The init script is declared again with the new state, so later documents start where the timeline is. Replaying the log reduces to its state.
- **The engine is untouched.** It runs in its own world, which keeps the real timers and frames (P16), so actionability and expectations run on native rendering, whatever the page's clock says.
- **Where the page can see it.** The shim's controls live on a `Symbol.for` key with a random token, so page script can't stumble on them, though one that enumerates the window's symbols can.
- **What it doesn't cover.** Workers aren't covered (an opt-in, not built). Neither are CSS animations and `document.timeline`.

**Recommendation.** Adopt.

### 8. L0: what the probes found

**Where:** the three adapters; the adapter contract; the conformance suite.

**What changes.**

- **The CDP adapter:**
  - its auth intercept is fixed: auth registers no stage of its own, a request no other intercept wants continues, and `Fetch.authRequired` is the obligation (P6);
  - a navigation failed with `aborted` ends (P4);
  - a paused request takes the resource type its network events gave it (P11).
- **New operations.** The contract gains `requestBody(obligation)`:
  - CDP's and WebKit's `postData`;
  - BiDi's request data collector, declared with each request-phase intercept.

  It also gains `responseBody(obligation)` at the response phase, which is CDP's `Fetch.getResponseBody` and `Unsupported` elsewhere.
- **The BiDi adapter:**
  - refuses a continue with a URL and a response-phase fulfill, as `Unsupported`;
  - sends a new body with its own `Content-Length`;
  - refuses a mobile viewport and an unavailable geolocation.
- **The WebKit adapter** refuses touch, and an unavailable geolocation.
- **New capability entries** (candidates 3, 5 and 6).
- **Q46** (Chromium's interception flake under load) is investigated, since routes depend on every paused request being reported.

**Recommendation.** Adopt.

### 9. Tests, on every backend

**Where:** `test/integration/slice/`; the conformance suite.

**What changes.** A fifth slice suite, through the public layers:

- **Routes:**
  - fulfill, `continueWith`, abort, and fallthrough between a page's route and its context's;
  - `hits`;
  - a failing handler's `AutoResolution`;
  - the request body;
  - the response phase, with the body on Chromium;
  - authentication where supported;
  - `Unsupported` where not;
  - call site 7's route on a page of our own.
- **Init scripts:**
  - order and `after`;
  - a dependency that throws, and one released;
  - the isolated world;
  - frames;
  - a function, a source and a path.
- **Emulation:**
  - each field, or its `Unsupported`;
  - creation options;
  - removal restoring;
  - call site 6.
- **Grants:** a grant and its removal; every origin, or `Unsupported`.
- **The clock:**
  - call site 10;
  - each mode;
  - a navigation keeping the timeline;
  - a context clock across two pages;
  - `WrongMode` and `NotInstalled`.
- **Call site 11.**

The conformance suite adds:

- request bodies;
- response bodies at the response phase;
- authentication on CDP;
- the aborted navigation's end;
- the refusals above.

**Recommendation.** Adopt.

## Considered and not adopted

- **`Intercepted.fetch` performed by this program, as Playwright's `route.fetch` is.** It's a second HTTP client hidden behind a route: its cookies, proxy, TLS, cache and service workers aren't the browser's. A handler that wants it can say so: `NetworkRequest.toHttpClientRequest(intercepted.request)`, its own `HttpClient`, and `Route.fulfill(HttpServerResponse.fromClientResponse(response))`.
- **`Intercepted.fetch` through the response phase, in one handler.** On BiDi and WebKit, every matching response would have to pause in case a handler asks, and only CDP can read the body. A response-phase route says the same thing, explicitly.
- **Answering Chromium's preflights for routes, as Playwright does.** It would hide a request the page made. QUIRKS.md records the difference, to reconsider.
- **The browser's own authentication prompt as the default.** It waits forever on headless Firefox (P6).
- **Decisions as members of a pending object, as dialogs have.** Typing decisions by phase gives the same guarantee and keeps the module's constructors and the call sites.
- **Applying what a backend can of an `emulate` call and ignoring the rest.** A field the backend can't apply fails the call.
- **Dropping an abort reason a backend can't convey.** That would silently degrade the decision. An unsupported decision is a handler failure, and the default applies, logged.
- **A clock from the backends' own virtual time** (CDP's `Emulation.setVirtualTimePolicy`). It is Chromium's alone, and it stops rendering, which actionability depends on.

## Decision

Adopted, 2026-10-23, under the maintainer's direction to build the next batch. The revision follows this commit, and the build records where it differs.
