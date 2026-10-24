# Design review: the other event modules

*2026-10-23. Review of commit `660ef9f` (events, popups and dialogs built, after review 13) on the nine event modules still declared but not built: `Download`, `FileChooser`, `ConsoleMessage`, `UncaughtException`, `PageNavigation`, `NetworkRequest`, `NetworkResponse`, `BrowserWorker` and `NetworkConnection`, and `AutoResolution`'s file-chooser subject. Prompted by the maintainer: "Please do all of the event modules". This commit records the review only.*

Review 13 built the mechanism (a channel per kind and target, fed by the fold, with `next`, `stream` and `history` over it) and said the remaining modules should be mostly a matter of mapping facts onto it. Mostly, they are. What they bring that popups and dialogs didn't:

- **Attribution.** A popup and a dialog name their page. A request names the frame or worker that made it, a console message its realm, and a service worker no page at all, so the fold has to know which page and context each one belongs to.
- **Delivery that does work.** A response's body arrives after the response, and a navigation waited for with `waitUntil` ends after it commits, so delivering an event can take an effect, and can fail.
- **Live handles with their own lifetimes.** A download, a worker and a WebSocket each have state and an end.
- **A second obligation.** A file chooser is decided like a dialog.
- **Backends that can't see.** Each backend misses something that another reports, which the API has to say rather than hide.

## What the browsers do

Every question below was probed on the three pinned builds through their adapters (a throwaway test, not kept), as review 13's were.

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** A download in a context with no download behavior set | canceled | saved to `$HOME/Downloads` | saved to `$HOME/Downloads`, path not reported |
| **P2.** A download allowed into a directory, while it runs | written to `<guid>.crdownload`, renamed `<guid>` when done | `<name>.<random>.bin.part`, renamed to the suggested name | `<uuid>.wkdownload`, renamed `<uuid>` |
| **P2.** Its progress | reported, with the total | not reported | not reported |
| **P3.** The context removed while a download runs | reported canceled, partial file deleted | no end reported | reported *completed*, a zero-byte file |
| **P4.** Canceling a download (from each protocol's schema) | `Browser.cancelDownload` | no command | `Playwright.cancelDownload` |
| **P5.** A file chooser the adapter intercepts, decided `Cancel` | nothing fires on the input | the picker stays open, and later clicks open nothing (today's `file: "ignore"`) | nothing fires |
| **P6.** The same, with Firefox's `unhandledPromptBehavior.file: "dismiss"` | — | reported; the input gets `cancel` at once; `input.setFiles` afterwards fires `input` and `change`; later clicks are reported again | — |
| **P7.** A file input clicked with no interception | the input gets `cancel` at once | reported anyway | nothing |
| **P8.** `input.showPicker()` | reported | not probed (P5 left the picker open) | not reported |
| **P9.** `console.log({ a: 1 })`, and `console.log("%s and %d", "x", 5)` | `Object`; `%s and %d x 5` | `Object(2)`; `x and 5` | `Object`; `%s and %d x 5` |
| **P9.** A message's source line | 0-based | 0-based | 1-based |
| **P10.** `throw "a string"` | reported with the message `Uncaught` (the adapter reads the wrong field) | `uncaught exception: a string` | `Error`, `a string` |
| **P10.** An unhandled rejection | marked `Uncaught (in promise)` | indistinguishable from a throw, and without a stack | marked |
| **P11.** Dedicated, shared and service workers | all three; the page is named; the context is known to the adapter | all three; the owner realm is named, the page isn't; no context for shared and service | dedicated only, with its page |
| **P11.** Evaluating in a worker | works | fails: `Realm with id … not found` | works |
| **P11.** A dedicated worker's `fetch` | initiated by the worker | by the page's document | by the page's document |
| **P11.** Console from shared and service workers | reported | not reported | not reported |
| **P12.** A frame's requests | carry the frame's navigable, and `FrameAdded` links it to its page | the same | the same |
| **P13.** A redirect hop's body, asked for | fails as an id the connection didn't mint | the same | the same |
| **P14.** An `EventSource` | a request of type `eventSource`, and a connection with its messages | a request of type `other` | a request of type `eventSource` |
| **P14.** Its body | never finishes, so a read waits forever | the same | the same |
| **P15.** A WebSocket | opened, frames, closed | only its handshake, as an `http:` request answered 101 | opened, frames, closed, and the close handshake as two binary frames |
| **P16.** `pushState`, then a fragment | started, URL changed, ended `SameDocument` with `via` | the same | the same |

## Candidates

### 1. Every event is attributed to a page and its context

**Where:** the model; the adapter contract (`RealmAdded`); the BiDi adapter.

**What changes.** The fold publishes an event to its page's channel and its context's, so it has to know both. Facts name a navigable or a realm, so the model keeps two indexes:

- **Navigables.** A page is its own navigable; a frame (`FrameAdded`) belongs to its page, until `NavigableRemoved`. A request initiated by a frame's document reaches its page (P12).
- **Realms.** A window realm belongs to its navigable's page. A dedicated worker belongs to its page; a shared or service worker to its context, when the backend says which.
- **The contract.** `RealmAdded`'s worker kind gains `context: Option<UserContext.Id>`. The CDP adapter knows it for every worker target; the BiDi and WebKit adapters fill it from the page for dedicated workers, and BiDi has nothing to fill it from for shared and service workers (P11). The BiDi adapter also names the page of a dedicated worker, from its owner realm, which it leaves out today.
- **Unattributed.** An event whose page and context are unknown reaches no channel, and the capability's limitations say which (candidate 4).

**Recommendation.** Adopt.

### 2. Delivering an event can take an effect

**Where:** `src/internal/events.ts`.

**What changes.** A `Kind` maps an entry to what a caller sees synchronously. Two modules need more:

- a `NetworkResponse` subscription with a `body` delivers the response once its body has loaded and been decoded;
- `PageNavigation.next` with `waitUntil` delivers once the document reaches it, and fails when the navigation it matched failed.

So `next` and `stream` take an optional effectful delivery, run in the subscriber (the `next` worker, the stream's consumer), never in the fold, as `where` is. Its failure fails the deferred or the stream. A `Kind` keeps its synchronous projection for `history`, which never waits.

**Recommendation.** Adopt.

### 3. `history` checks its filter as `next` does

**Where:** every event module's `history`; `Subscription.SubscriptionError`; API.md, State and events.

**What changes.** `history(target, filter?)` returns `Effect<History<A>>`, so a filter it can't apply has nowhere to go. `Popup.history(page, { url: "https://x/:(" })` dies today, because the pattern throws inside the read. And a backend that can't report an event (candidate 4) would answer an empty history, which reads as "none happened".

- **`history` fails with `SubscriptionError`,** as `next` and `stream` do, for the same reasons: a filter that doesn't compile (`InvalidInput`) or that the backend can't apply (`Unsupported`). It still never waits.
- **`SubscriptionError`'s doc** says it fails the call that took the filter, `next`, `stream` or `history`, before any event.

**Recommendation.** Adopt.

### 4. What a backend can't report is a capability, and a filter that needs it fails

**Where:** each adapter's capability set; `Subscription`; `BrowserWorker`, `NetworkConnection`, `Download`, `UncaughtException`.

**What changes.** Every probe found a backend that misses something. The rule, as for any capability (CONCEPTS.md §7, an unmet requirement fails and never silently degrades):

- **A filter that asks for events the backend can't report** fails `next`, `stream` and `history` with `SubscriptionError{Unsupported}`, naming the capability: `NetworkConnection` on BiDi, `kind: "eventSource"` on WebKit, `BrowserWorker` `kind: "shared"` or `"service"` on WebKit, and on BiDi from a context, since BiDi can't say whose they are.
- **An unfiltered subscription** gets what the backend reports, and the capability's limitations say what that leaves out.
- **New capability entries:**
  - `networkConnections`: CDP supported; WebKit partial (no `EventSource` connections); BiDi unsupported (only the handshake, P15).
  - `workers`: CDP supported; BiDi partial (shared and service workers belong to no context, and a dedicated worker's requests and console are attributed to its page); WebKit partial (dedicated workers only).
  - `workers.evaluate`: unsupported on BiDi (P11).
  - `downloads.progress`: CDP only (P2).
  - `downloads.cancel`: unsupported on BiDi (P4).
  - `exceptions.kind`: partial on BiDi (P10).
- **Operations** on a handle that need a missing capability (`download.cancel`, `worker.evaluate`) fail with their module's error and `Unsupported`.

**Recommendation.** Adopt.

### 5. Console messages and uncaught exceptions are data from every realm

**Where:** `ConsoleMessage`, `UncaughtException`; the three adapters.

**What changes.**

- **Channels.** Both are published to the page and its context, from window realms and from workers (`origin: Worker{realm}`). A dedicated worker's message reaches its page, a shared or service worker's only its context.
- **Text is the browser's.** Firefox applies format specifiers and the others don't, and every browser renders an object as its class name (P9). `text` is what the browser reports, documented, not reformatted: the arguments themselves would need handles, and reformatting would guess.
- **Locations are 1-based** in line and column, as stack traces print them. CDP and BiDi report 0-based lines, and the adapters convert (P9).
- **A thrown value that isn't an `Error`** reads as an `Error` whose message is the value, on every backend. The CDP adapter's `Uncaught` and Firefox's `uncaught exception` name are gone (P10).
- **`kind` gains `"unknown"`.** Firefox reports a rejection exactly as a throw (P10), so its exceptions are `kind: "unknown"`, which `exceptions.kind`'s limitation says, as `servedBy` has `cacheOrServiceWorker` for the same reason. Firefox's stack is built from its stack trace, where it gives one.
- **Filters:** `level`, and `text` or `message` as a substring or a `RegExp`.

**Recommendation.** Adopt.

### 6. A navigation is an event when it ends, with its URL

**Where:** `PageNavigation`; the model.

**What changes.**

- **When.** A navigation of the page's main frame is published when it ends, with its outcome; a frame's navigations wait for frames. Navigations `goto` starts are published too.
- **`url` on every variant.** A `PageNavigation` doesn't say where the page went: `SameDocument`, `Restored` and `Activated` have no URL at all, so a history of navigations is a list of ids. Every variant gains `url: Url.Url`: the committed document's URL, after redirects, or the URL a same-document navigation set. The filter's `url` matches it.
- **`next` settles on the first matching navigation to end, as `goto` would.** A success latches the `PageNavigation`; a failure fails the deferred with the `PageError` `goto` would give (`NavigationFailed`, `NavigationCanceled`, `NavigationSuperseded`, `BecameDownload`, `NoContent`), matched by the URL it was going to. So recovery reads the same whichever way the navigation came, as the module's doc promises.
- **`waitUntil`.** After a `Committed` match, `next` waits for the document to reach it, under the same deadline, as `goto` does, and its hint says when it committed but didn't load.
- **`stream` and `history`** report successes only, since `PageNavigation` has no failure variants.

**Recommendation.** Adopt.

### 7. Requests and responses, and bodies on request

**Where:** `NetworkRequest`, `NetworkResponse`; the model; the adapters' `responseBody`.

**What changes.**

- **Events.** A request is published per hop when it is sent, and a response when it arrives, to the initiator's page and context (candidate 1). The model keeps each hop's request until the hop ends, bounded, so a response can be filtered by its request's `method`.
- **`toHttpClientRequest`** builds Effect's `HttpClientRequest` from the hop's method, URL and headers. Redacted header names stay redacted.
- **Bodies are collected for a subscription, not always.** `NetworkResponse.next` and `stream` with `body` declare body collection for the page or context in the subscription's scope before they return (BiDi needs a collector before the request starts; CDP and WebKit keep bodies on their own).
- **The limit is stated:** `NetworkResponse.BodyLimit`, a `Context.Reference<ByteSize>` read at subscription, 10 MiB unless set with `NetworkResponse.withBodyLimit`. Effect's `HttpIncomingMessage.MaxBodySize` bounds what this process reads, has no default, and isn't what the browser keeps.
- **Delivery waits for the body** (candidate 2): the hop's end, then the bytes, then the decoder, then `where`.
  - A redirect hop (3xx with `Location`) has no body: `BodyUnavailable{redirect}`, without asking the browser, which fails it as a foreign id today (P13).
  - Over the limit: `overLimit`.
  - Gone from the browser: `evicted`.
  - A hop that failed after its response started: a new `why`, `failed`.
  - A body that hasn't finished by the deadline, such as an `EventSource`'s (P14): `next` times out (`waitingForEvent`, with a hint saying the response matched but its body hadn't finished), and `stream` fails with `BodyUnavailable{streaming}` after `Deadline.DefaultBudget`, read at `stream`.
- **`CapturedResponse<B>`** is the response's metadata, an `HttpIncomingMessage<ResponseError>` over the owned bytes (so `HttpIncomingMessage.schemaBodyJson` reads it), and `body`, what the decoder produced.

**Recommendation.** Adopt.

### 8. Downloads go to a directory each context owns

**Where:** `Download`; `UserContext`; the model; the adapter contract (`cancelDownload`).

**What changes.**

- **Every context the library creates allows downloads into a directory it owns.** P1 shows what happens otherwise: one browser cancels them and two save them into the user's home. The directory is temporary, made before the context and removed after it (`FileSystem.makeTempDirectoryScoped`, in the context's scope). This is stated in `UserContext`'s doc and recorded on the context's span, and there is no option yet; a route can abort a download's request. The default context, which the library doesn't create, keeps the browser's own behaviour.
- **Status.** `InProgress{received, total}` from the start, updated where the backend reports progress (`downloads.progress`, P2), then `Completed`, `Canceled` or `Failed{reason}`. The fold ignores whatever a backend reports after a download's context ended: the context's end cancels it (P3). A download outlives its page, and ends with its context.
- **Waiting.** `finished` waits for a terminal status under the deadline: `Completed` succeeds, `Canceled` and `Failed` fail with `DownloadError` (`DownloadCanceled`, `DownloadFailed`).
- **`saveAs` and `stream` wait for it too.** Every browser writes into a partial file and renames it at the end (P2), so the bytes are read once the download completes, and `stream` can't deliver them "as they arrive". Both wait under the deadline in force when called, so their error types gain `Target.TargetGone` (the file went with its context) and `Deadline.Timeout`. Copying needs the program's `FileSystem`, captured by a launched browser's layer; without it they fail with `Unsupported`.
- **`cancel`** sends the backend's command, `cancelDownload`, new in the adapter contract. BiDi has none (P4), so it fails with `Unsupported` there.
- **One handle per download,** so `next`, `stream` and `history` hand out the same `Download`.

**Recommendation.** Adopt.

### 9. A file chooser is data; a handler's argument adds the decisions

**Where:** `FileChooser`; `AutoResolution`; `FileInput`; the model; the BiDi adapter.

**What changes.** As review 13 found for dialogs, the declared `FileChooser` carries `select` and `cancel`, which do nothing for an observer, and can't be encoded.

- **`FileChooser.FileChooser` becomes data:** `Single{}` or `Multiple{}`. **A handler receives `FileChooser.Pending`:** each shape with `select` and `cancel`. `choose` takes a `Pending`; call sites are unchanged.
- **Armed on every page of a context the library creates,** so every chooser is reported and decided; that is what makes its default, `Cancel`, true.
- **Deciding.** The page's latest `FileChooser.handle` decides, chosen when the chooser opens, with `Deadline.DefaultBudget` as read at `handle`, exactly as dialogs are decided. Failing, being interrupted or running out of time leaves it to the policy: cancel, published as `AutoResolution{subject: FileChooser, decision: "cancel", policy: 'fileChoosers: "cancel"'}`. There is one policy, and no option changes it.
- **Firefox gets `file: "dismiss"`.** With `"ignore"`, a canceled chooser stays open and the page's later clicks open nothing (P5). With `"dismiss"` the chooser is still reported and still takes files, but the input gets a `cancel` event as it opens (P6). That is the lesser difference, and `fileChooser` is `partial` on BiDi, saying so.
- **Files.** `FileInput.local(path)` resolves a relative path with Effect's `Path`, captured by the layer when it is there (`InvalidInput` when it isn't), and `FileInput.remote(path)` is sent as it is. `FileInput.bytes` stays unbuilt: writing the bytes to a file would lose the MIME type it is given.

**Recommendation.** Adopt.

### 10. Workers are handles you can evaluate in

**Where:** `BrowserWorker`; `Page.workers`, `UserContext.workers`; a new serialization of values for evaluation.

**What changes.**

- **Events.** A worker is published when its realm is added: to its page for a dedicated worker, and to its context for every kind. One handle per realm.
- **`closed`** waits until the realm is removed or its page or context ends, and gives the reason.
- **`evaluate(fn, ...args)`** calls `fn` in the worker. Arguments go as WebDriver BiDi local values (primitives, `bigint`, special numbers, arrays, plain objects, `Date`, `RegExp`, `Map`, `Set`), and the result comes back by value. Something that can't cross fails with `NotSerializable{path}`, a throw with `EvaluationThrown`. The serialization is new, internal, and what `page.evaluate` will use. On BiDi it fails with `Unsupported` (P11).
- **`page.workers` and `context.workers`** are built: the live workers as a `Watchable`.

**Recommendation.** Adopt.

### 11. WebSockets and event streams are handles with frames

**Where:** `NetworkConnection`; `Target.CloseReason`; the CDP and WebKit adapters.

**What changes.**

- **Events.** A connection is published when it opens, to its page and context. One handle per connection.
- **`frames`** subscribes from now on to that connection's frames, and ends when it closes.
- **`closed`** gives why it ended. A connection closed by the page or the server needs a reason, which `CloseReason` doesn't have: it gains `NetworkConnectionClosed`. `ConnectionLost` is taken by the browser's connection.
- **Control frames aren't messages.** WebKit reports the close handshake as two binary frames (P15), and the adapter drops them.
- **Not on BiDi** (candidate 4).

**Recommendation.** Adopt.

### 12. Tests, on every backend

**Where:** `test/integration/slice/`; the conformance suite.

**What changes.** A third slice suite runs, through the public layers:

- call sites 2, 4 + 9, 5, 8 and 15;
- a download's status, `finished`, `stream` and `cancel`;
- a chooser a handler answers, one the policy cancels, and one given too many files;
- console messages and exceptions by filter, with their locations, encoded as data;
- same-document navigations, a navigation `next` fails with its reason, and `waitUntil`;
- a frame's request reaching its page;
- a redirect hop's `BodyUnavailable`;
- a worker evaluated in and closed;
- a WebSocket's frames;
- each `Unsupported` where a backend lacks the capability.

The conformance suite gains the adapter changes: 1-based locations, a thrown string, worker contexts, skipped control frames, `cancelDownload`.

**Recommendation.** Adopt.

## Considered and not adopted

- **Reading a download's bytes while it runs.** Each browser writes a partial file of its own naming, and Firefox's carries a random part (P2).
- **Keeping Firefox's `file: "ignore"`** and leaving canceled choosers open, which breaks the page's later uploads (P5).
- **Synthesizing Firefox's WebSocket connections from the handshake.** It reports no frames and no close, so `closed` could never end (P15).
- **A `downloads: "deny"` option.** Nothing needs it yet, and a route can abort a download.
- **Guessing Firefox's rejections from a missing stack.** A throw can lack a stack too.
- **Attributing a worker's requests to the worker on Firefox and WebKit.** The backends name the page's document, and the model reports what they say (P11).
- **`FileInput.bytes` through a temporary file.** The page would see a MIME type guessed from the name, not the one given.
- **Effect's `HttpIncomingMessage.MaxBodySize` as the collection limit** (candidate 7).

## Decision

Adopted, 2026-10-23, under the maintainer's direction to build every event module. The revision follows this commit, and the build records where it differs.
