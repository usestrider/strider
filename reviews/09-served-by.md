# Design review — who served a response

*2026-10-20. Review of commit `86fd642` (revision 5.25, with the protocol layer built for CDP, BiDi and patched WebKit) on one field: `servedBy`, which CONCEPTS.md puts on the request snapshot and every adapter sets to `network`. Evidence: probes run that day against Chromium 155.0.8059.79, Firefox 158.0 and Playwright's WebKit 2359, each loading a cacheable script fresh, again in the same document, again in a new document and on reload, then fetching one response a service worker made and one it passed through from the network, and one an intercept fulfilled. This commit records the review only.*

CONCEPTS.md §2 gives each request snapshot `servedBy: "network" | "cache" | "serviceWorker"`, and `NetworkRequest` carries it. But a request's snapshot is reported when the request is sent, and nothing at that point says what will answer it: every backend says so with the response. So every adapter reports `network`, which is wrong for every cache hit and every service-worker response, and the H17 hazard (a service worker answers a request) has nothing to stand on.

## Probe results

| Case | Chromium 155 (CDP) | Firefox 158 (BiDi) | WebKit 2359 |
|---|---|---|---|
| First load | `responseReceived`, no cache flags | `fromCache: false` | `response.source: "network"` |
| Same document, script loaded again | **no network events at all** | `fromCache: true`, 0 bytes | **no network events at all** |
| New document, script cached | `requestServedFromCache` between `requestWillBeSent` and `responseReceived`, whose `fromDiskCache` is still `false`; 0 encoded bytes | `fromCache: true`, 0 bytes | `source: "memory-cache"` |
| Reload | as the new document | as the new document | as the new document |
| A response the worker made (`respondWith(new Response(…))`) | `fromServiceWorker: true`, `serviceWorkerResponseSource: "fallback-code"` | **`fromCache: true`**, 0 bytes | `source: "service-worker"` |
| A response the worker fetched (`respondWith(fetch(…))`) | `fromServiceWorker: true`, `serviceWorkerResponseSource: "network"`; the worker's own fetch is a separate request on its own target | **`fromCache: true`**; the worker's fetch doesn't appear | `source: "service-worker"` |
| A response an intercept fulfilled | no flag: it reads as `network` | `fromCache: false`: it reads as `network` | `source: "inspector-override"` |

Every backend sends a request event before a service worker's response, so H17's "response with no request" didn't occur. WebKit's protocol also defines `Network.requestServedFromMemoryCache`, a request answered from the memory cache without a load; none of these cases sent it, and the adapter drops it today, request and all.

## Candidates

### 1. `servedBy` belongs to the response

**Where:** CONCEPTS.md §2 (`RequestSnapshot`, `ResponseSnapshot`); `NetworkRequest`, `NetworkResponse`; the `RequestSent` and `ResponseReceived` facts.

**What changes.** `servedBy` moves from `NetworkRequest` to `NetworkResponse`, and each adapter sets it when it reports the response, from that response's evidence. A request is what was asked for; who answered is a property of the answer, known exactly when the answer is, and a request that fails has no answer to describe. A redirect hop's response is described the same way, from the redirect response.

**Recommendation.** Adopt.

### 2. Four sources, and a fifth for what a route made

**What changes.** `servedBy: "network" | "cache" | "serviceWorker" | "cacheOrServiceWorker" | "route"`:

- `cache`: the browser's HTTP cache, memory or disk.
- `serviceWorker`: a service worker's `respondWith`, whether it made the response or fetched it.
- `cacheOrServiceWorker`: not the network, and the browser doesn't say which. Firefox's `fromCache` is true for both (recorded), and calling a service worker's response `cache` would be a guess.
- `route`: a response the client fulfilled through an intercept (`Decision.Fulfill`). Chromium and Firefox report it as an ordinary network response, and WebKit as `inspector-override` (recorded), so the adapter marks the request when it sends the decision, before the response can arrive.

Each backend maps its evidence, and nothing else:

| Backend | `cache` | `serviceWorker` | `cacheOrServiceWorker` |
|---|---|---|---|
| CDP | `requestServedFromCache` for the request, or `fromDiskCache`, or `fromPrefetchCache` | `fromServiceWorker` | — |
| BiDi | — | — | `fromCache` |
| WebKit | `source` `memory-cache` or `disk-cache` | `source` `service-worker` | — |

**Recommendation.** Adopt.

### 3. A capability says how precise it is

**What changes.** A new capability entry, `network.servedBy`: `supported` on CDP and WebKit, `partial` on BiDi with the limitation that a cache and a service worker look alike. Code that needs to tell them apart reads the capability, not the backend.

**Recommendation.** Adopt.

### 4. What reports no request is said, and what does is never dropped

**What changes.** A script reused from the memory cache within one document produces no network events on Chromium or WebKit, so that request isn't seen at all there; PROTOCOL.md says so, and Firefox reports it. WebKit's `requestServedFromMemoryCache` becomes a request, a `cache` response and its end, with the frame and initiator it names, instead of being dropped.

**Recommendation.** Adopt.

### 5. The conformance suite checks it

**What changes.** The suite loads a cacheable script fresh and again (`network`, then `cache`, or `cacheOrServiceWorker` where the capability is partial), registers a service worker and fetches a response it made (`serviceWorker`, or `cacheOrServiceWorker`), and fulfills a request through an intercept (`route`).

**Recommendation.** Adopt.

## Considered and not adopted

- **Keeping `servedBy` on the request, with a fact that updates it when the response arrives.** Every request snapshot would be provisional until then, and the field would mean nothing on a request that fails. The answer's properties belong on the answer.
- **Reporting Firefox's `fromCache` as `cache`.** It is true for service-worker responses too, recorded above.
- **Telling Firefox's cases apart by asking the page** (`navigator.serviceWorker.controller`). It races the response and runs in the page.
- **How a worker produced its response** (CDP's `serviceWorkerResponseSource`). Only CDP says; it can be added later as an `Option`.
- **CDP's `ExtraInfo` headers** (what the network stack added, such as cookies). They do change the request after it is reported, which is a different question; they stay listed as not built.

## Decision

Adopted, 2026-10-20: the maintainer flagged `servedBy` as important after the protocol layer was finished. The revision follows this commit.
