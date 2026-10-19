# HAR recording and replay

Sources:
- A full clone of `microsoft/playwright` at `b335271`, at `/tmp/prior-art/playwright`. Paths are relative to `packages/playwright-core/src` unless noted, and "tests/" means `tests/library/`.
- The WebDriver BiDi spec source, `/tmp/prior-art/webdriver-bidi/index.bs`.
- The other clones under `/tmp/prior-art`.
- The W3C HAR draft page. It was checked online, not recalled from memory.

Every claim was **read** from source; nothing was run.

## Summary

- **Playwright is the only driver that replays HARs.**
  - Its recorder has three timing bugs against the spec and redacts nothing: cookies and `Authorization` are stored verbatim.
  - Its replay matcher has several implicit behaviors that break rule 23: header-count tie-breaking, a body check for POST only, stalling forever on status −1, silent fallthrough on malformed files, CORS headers added automatically, and `update` turning replay into record.
- **BiDi** can record most of a HAR: partial timings, response bodies through collectors, and request bodies in the newer spec. It has no remote address and no WebSocket frames. **Patched WebKit** has good metrics, but redirect hops have none.
- **The design to adopt:** recording as a scoped acquisition with an explicit export that redacts by default, and replay as a scoped route registration with a documented matching rule and explicit options for every choice Playwright makes implicitly.

## The HAR spec

- **Status.** The W3C draft (Odvarko, Jain and Davies, August 2012) carries a banner: "DO NOT USE… never published… abandoned". HAR 1.2 on softwareishard.com is the de facto spec.
- **Timings.** `ssl` is included in `connect`, and `entry.time` is the sum of the timings, excluding any `-1`.
- **Content.** `content.text` is stored HTTP-decoded.
- **`postData`.** `text` and `params` are mutually exclusive.
- **Extensions.** Custom fields start with `_`.

## 1. Recording in Playwright

**Events.**
- The recorder listens to Playwright's normalized context events: request, response, finished, failed, aborted, fulfilled, continued and websocket (`server/har/harTracer.ts:109-120`).
- **On CDP,** those come from `Network.requestWillBeSent` and its `ExtraInfo`, `responseReceived` and its `ExtraInfo`, `loadingFinished`, `loadingFailed`, `requestServedFromCache` and `webSocket*` (`chromium/crNetworkManager.ts:72-92`).
- **On BiDi,** they come from `network.beforeRequestSent`, `responseStarted`, `responseCompleted` and `fetchError` (`bidi/bidiNetworkManager.ts:50-54`).

**Timings.** They come from CDP's `response.timing` (`crNetworkManager.ts:386-412`), converted at `harTracer.ts:603-616`. There are three bugs against the spec:
- `send` is hard-coded to 0 and `blocked` is never set, so send time ends up inside `wait`.
- `ssl` is computed as `connectEnd - secureConnectionStart`. On plain HTTP, `secureConnectionStart` is −1, which gives a bogus positive value.
- The total adds `ssl` on top of `connect` (`:644-652`), counting it twice.

**Bodies.**
- `content` is `"embed"`, `"attach"` or `"omit"` (`:548-566`). `"attach"` writes a file named by SHA-1 plus extension and references it through `_file`.
- The default depends on the file extension: a `.zip` path means attach, anything else means embed (`client/browserContext.ts:191-199`).
- `mode: "minimal"` drops security details, cookies, timings, server IP, sizes and pages (`:86-93`).
- `urlFilter` is a glob or regex, matched against `baseURL` (`:132-134`).
- Bodies are fetched after the request finishes. If that fails, the body is missing with no warning (`:375-390`).

**Redirects.** Each hop is its own entry. The previous entry's `redirectURL` is filled in when the next hop starts (`:300-304`). Redirect responses have no body (`server/network.ts:688-689`).

**Service workers.** Requests made by a service worker get `_serviceWorkerRef` (`:292-294`). Responses served from a service worker are synthesized on CDP (`crNetworkManager.ts:456-466`), but nothing marks them.

**WebSockets.**
- With `embed`, frames go into `_webSocketMessages` as `{type, time, opcode, data}`. With `attach`, they go into a JSONL `_file`.
- Frames are recorded by default, and a hidden environment variable, `PLAYWRIGHT_HAR_NO_WEBSOCKET_FRAMES`, turns them off (`harRecorder.ts:67`, `harTracer.ts:445-546`).

**Playwright's extensions** (`packages/isomorphic/trace/versions/har.ts:57-163`):
- `_frameref`, `_monotonicTime`, `_serverPort`, `_securityDetails`;
- `_wasAborted`, `_wasFulfilled`, `_wasContinued`;
- `_serviceWorkerRef`, `_apiRequestRef`, `_resourceType`, `_webSocketMessages`;
- `_transferSize`, `_failureText`, `_file`.

**No redaction.** The raw `Cookie` and `Set-Cookie` headers are parsed into `cookies[]`, and `Authorization` is stored verbatim (`:310-317`, `:621-642`). The HAR code contains no redaction of any kind.

**Other hidden behavior:**
- Request overrides from routes are recorded as sent, not as the page requested them (`:319-326`).
- Page titles and timings are read by a script in the page's utility world (`:174-200`), which forces the Runtime domain on.
- Favicons are dropped from events and from the HAR (`frames.ts:334-353`, `network.ts:259`).

## 2. Replay in Playwright (`routeFromHAR`)

**Where it runs.**
- The client route handler (`client/harRouter.ts:47-110`) calls `localUtils.harLookup`, which runs in the local driver (`server/localUtils.ts:150-186`). Thin clients are rejected (`client/browserContext.ts:401-410`).
- The route covers `**/*` unless `url` is given. Routes are ordered last-registered-first.

**Matching** (`server/harBackend.ts:96-157`):
1. **URL and method.** Both must match exactly (`:102`).
2. **Body.** The body is compared only for POST, and only when both sides have one. If the bytes differ, the comparison is retried with the multipart boundary stripped (`:104-117`). So a recorded POST without `postData` matches any POST, and PUT or PATCH bodies are ignored.
3. **Several matches.** The candidate with the most exact `name:value` header matches wins, and ties go to file order (`:126-135`, `:164-172`). In a test (`browsercontext-har.spec.ts:361-397`), an unknown request for `baz4` is answered with the recorded `baz1`.
4. **Redirects.** 3xx `Location` chains are followed with a cycle check. POST is rewritten to GET where the Fetch spec does so (`:142-153`).
5. **Final URL.** If a navigation ends at a different URL, a fresh `goto` of the final URL is started (`:60-62`, `frames.ts:682-690`). Other requests are served the final response under their original URL.

**Implicit behavior that conflicts with rule 23:**
- **Stalls.** An entry with `status: -1` stalls forever (`harRouter.ts:66-72`, test `browsercontext-har.spec.ts:582-613`).
- **Silent fallthrough.** Lookup errors and malformed HARs (such as `{log:{}}`) are only debug-logged, then fall through to `notFound` (`:100-109`, test `browsercontext-har.spec.ts:60-67`).
- **CORS.** `fulfill` adds CORS headers automatically (`server/network.ts:460-476`).
- **Headers.**
  - Headers are lowercased into a map, so repeated headers collapse. The exception is `set-cookie`, whose values are joined with `\n` (`harRouter.ts:75-90`).
  - The recorded `content-length` is kept (`client/network.ts:422-432`).
  - `content-encoding` is stripped on the BiDi path only (`bidiNetworkManager.ts:354`).
- **`notFound`** defaults to `"abort"`.
- **`update: true`** turns routing off entirely. It re-records the file, defaulting to `attach` and `minimal`, and overwrites the file on close (`client/tracing.ts:129-140`). `notFound` is ignored in that mode.
- The documented matching rule is at `docs/src/mock.md:417`.

## 3. Backend coverage

**BiDi**, through Playwright's BiDi backend:
- **Timings.** They are mapped from `FetchTimingInfo` (`bidiNetworkManager.ts:136-152`). The spec has no `tlsEnd` (Playwright assumes it equals `connectEnd`) and no `responseHeadersEnd` (`index.bs:8952-8968`). So `send` can't be derived, `wait` is `responseStart - requestStart`, and `receive` is `responseEnd - responseStart`.
- **Missing fields.** There is no server IP or port, no security details, and no raw headers (`:154-158`). `ResponseData` has no remote address (`index.bs:9296-9309`).
- **Sizes.** The body size is marked "TODO: body size is the encoded size" (`:166-170`).
- **Request bodies.** Playwright's backend has none ("TODO: missing in the spec?", `:297-298`), but the spec now has a `"request"` data type (`index.bs:8941`).
- **Collectors.** Playwright collects responses only, up to 20 MB (`bidi/bidiBrowser.ts:89-92`). A collector must exist before the request starts.
- **WebSocket frames.** None.

**Patched WebKit:**
- `loadingFinished.metrics` supplies the remote address, TLS protocol, HTTP version and encoded sizes (`webkit/wkPage.ts:1155-1180`).
- Timings and bodies come from `Network.getResponseBody` (`webkit/wkInterceptableRequest.ts:73-88`), and WebSocket frame events exist (`wkPage.ts:409-412`).
- The server address and security details arrive late, so Playwright stopped waiting for them (issue #21182, `harTracer.ts:336-337`).
- Comma-folded `Set-Cookie` headers are broken (test `har.spec.ts:290-291`).
- Redirect hops carry no metrics (`wkPage.ts:1102-1112`).

## 4. Pitfalls

- **Binary request bodies are lost in embed mode.** `application/octet-stream` becomes `text: ""`, and other types go through lossy UTF-8 (`harTracer.ts:715`, test `har.spec.ts:184-196`). Such POSTs can never be replayed. Form posts also set `text` and `params` together, which the spec forbids.
- **HTTP/2.**
  - CDP provides no `headersText`, so the header size is 0 and `bodySize` absorbs the header bytes (`crNetworkManager.ts:884`, with the fallbacks in `network.ts:740-760`). Sizes fall back to synthesized HTTP/1.1 text.
  - Nothing filters pseudo-headers. From memory, CDP's extra-info events include `:authority` and others.
- **Mixed time bases.** `receive` combines the `requestWillBeSent` timestamp with `requestTime`, so it absorbs queueing time (`:397-400`, `crNetworkManager.ts:492`).
- **Unfinished requests.** Slow or chunked responses stay without bodies (issue #21182). Unfinished requests are recorded with status −1 and then stall on replay (issue #29311).
- **Smaller issues:**
  - Cached resources have no timing (issue #11435).
  - HARs over 512 MB needed streamed writes (issue #36707, `harRecorder.ts:111-139`).
  - A failed save used to leave the context hanging (issue #42231).
  - Service-worker-intercepted requests aren't replayed (`docs/src/api/class-browsercontext.md:1259`).
- **Keepalive and beacon requests.** No specific handling was found.

## 5. Other drivers

Nobody else replays HARs. Selenium, rod and chromium-bidi have no HAR code at all. Puppeteer only links the third-party `puppeteer-har` (`puppeteer/docs/examples.md:59`). Some others record:
- **pydoll** records in a scope, with an explicit save: `async with tab.request.record() as capture` and `capture.save()` (`pydoll/browser/requests/request.py:273-310`). Its timings follow the spec: `blocked` and `send` are filled, and `ssl` stays inside `connect` (`har_recorder.py:364, 475-520`). This is the closest model for us.
- **vibium** builds HAR entries from BiDi events, with coarse timings. It redacts structurally on serialization: `authorization`, `cookie`, `set-cookie`, token query parameters and URL userinfo (`clicker/internal/api/recording_privacy.go:11-80`, `recording.go:1056-1115`). WebdriverIO's trace mode reuses vibium's format (`website/blog/2026-06-18-webdriverio-tracing.md:23`).
- **browser-use** copies Playwright's options, but silently records HTTPS only (`watchdogs/har_recording_watchdog.py:214-215`).
- **agent-browser** has `network har start/stop` with `--content text|all|none` and a 2 MB cap (`docs/content/docs/network.mdx:61-85`).
- **chromedp** has HAR types only (`cdproto/har/types.go`), plus an external example.

## What to keep and what to replace

**Keep from Playwright:**
- HAR 1.2 with `_` extensions, Playwright-compatible where possible: `_file` with SHA-1 names, zip archives, `_webSocketMessages`, `_wasFulfilled`;
- one entry per redirect hop;
- recording requests as actually sent;
- streamed writes and path-escape checks;
- method rewriting on redirects;
- navigation redirects that update `document.URL`, as an option.

**Replace with explicit choices:**

| Playwright behavior | Explicit replacement |
|---|---|
| ties broken by counting headers | an `ambiguity` option |
| body compared only for POST | body compared for any method that has one |
| entries with status −1 stall forever | an `incomplete` option |
| malformed or missing files fall through silently | the archive and its referenced files are validated when opened; failure is a `HarError` |
| `update: true` | removed; use `Har.record` instead |
| `content` chosen from the file extension | `content` is required |
| WebSocket frames controlled by an environment variable | a `webSocketFrames` option |
| favicons dropped | nothing excluded; the `url` pattern filters |
| page timings read by an in-page script | opt-in |
| CORS headers added automatically | a named option |
| headers collapsed into a map, compressed `content-length` kept | header lists preserved; one documented rule for `content-encoding`, `content-length` and pseudo-headers |
| no redaction | classified fields redacted on export unless explicitly included |
| bodies dropped silently | entries marked with a reason (`_unavailable`: not collected, evicted, over limit, redirect) |
| timings that violate the spec | spec-correct timings, with `-1` where a backend lacks the data |

On BiDi, the request and response collectors start when the recording scope is acquired.
