# QUIRKS: weird behaviors to reconsider

*Started 2026-10-23, at the maintainer's request: "record all the weird behaviors we amass as we build, so we can go back and reconsider them when we're done." Back-filled from the probes (PROBES.md, Results), the reviews and PROTOCOL.md's Built sections, up to review 14's revision (`ebe4b16`).*

Two kinds of entry:

- **Browser:** something a browser or protocol does that is surprising, inconsistent with the other browsers, or at odds with its spec.
- **Ours:** a compromise in Strider itself: a workaround a browser forced, a shape the platform or Effect forced, or a choice that reads oddly out of context.

Each entry says what is weird, where it was seen (with the builds: Chromium 155.0.8059.79, Firefox 158.0, Playwright's WebKit 2359), what Strider does about it now, and what to reconsider. None is resolved by being listed here; this is the list to walk when the library is built. Entries are never removed, only marked **Resolved** with the commit that resolved them.

**Adding one.** When building or probing turns up something weird, add it here in the same commit, at the end of its section, with the next number. Numbers are stable, so reviews and code comments can cite them (`QUIRKS.md, Q12`).

## Browsers: navigation, history and documents

**Q1. Chromium commits its error page under the failed navigation's loader id** (Browser). A navigation that fails is reported failed on `Network.loadingFailed`, and Chromium then commits `chrome-error://chromewebdata/` with `frameNavigated` and no `frameStartedNavigating`, under the failed navigation's own loader id.
- *Seen:* review 12's slice (PROTOCOL.md, Found by the slice), CDP probe findings.
- *We:* keep a failed navigation on its frame by loader id until the frame's next commit, and make the error page its document (`createdBy: ErrorPage`), not a navigation of its own. Before that, it superseded the next `goto`.
- *Reconsider:* whether the error document should be visible to callers at all, and whether `Failed{errorDocument}` is the right shape.

**Q2. Firefox reports a refused navigation as its error page's URL** (Browser). A navigation Firefox refuses at once, such as to a port browsers don't use (9), starts as `about:neterror?e=deniedPortAccess&u=…`, not the URL it was going to; an error page also commits under a navigation id `navigationStarted` never announced.
- *Seen:* review 14's revision; BiDi probe findings.
- *We:* report where it was going, from the error page's `u` parameter (`intended` in the BiDi adapter).
- *Reconsider:* whether to report the error page's URL anywhere, and whether other `about:` pages (`certerror`) carry the same parameter in every case.

**Q3. WebKit reports nothing at all for a navigation to a restricted port** (Browser). A link to port 9 produces no navigation, request or failure event on the inspector targets; only `Playwright.provisionalLoadFailed` and a `security` console message for a command's navigation.
- *Seen:* review 14's revision probe; WebKit probe 15.
- *We:* nothing: a `PageNavigation.next` waiting for it times out.
- *Reconsider:* reporting the console message's evidence as a failed navigation, or a hint on the timeout.

**Q4. Back/forward-cache restores look different on every backend** (Browser).
- Chromium restores under the restored document's *original* loader id (`frameNavigated{type: BackForwardCacheRestore}`), creating its context before the commit, and refuses a page's commands with "Not attached to an active page" for a moment while it swaps documents.
- Firefox restores with no `navigationCommitted`, `domContentLoaded` or `load`: the old realm goes and a new one comes, and `traverseHistory` replies after. Leaving its JSON viewer before it has loaded, it doesn't even send `navigationStarted`. A console message the restored page logged when it loaded comes again.
- WebKit keeps no back/forward cache: going back loads the page again.
- *Seen:* PROTOCOL.md, History and restores; probes 3.
- *We:* report each as `Restored` where the evidence allows, inferring Firefox's from a new main-world realm while a traversal is in flight.
- *Reconsider:* the inference on Firefox, which is timing-dependent (Q5), and the duplicate console message.

**Q5. Firefox can reply to `traverseHistory` before the restored document's realm arrives** (Browser). Under load, the reply came first, and the adapter, which looked for a waiting realm only at the reply, never ended the traversal.
- *Seen:* review 14's revision, in two full integration runs of four.
- *We:* restore the traversal when the realm arrives (`restoring` on the navigable).
- *Reconsider:* whether Firefox will ever report restores with a commit, which would remove both this and Q4's inference.

**Q6. Chromium retries are needed for "Not attached to an active page"** (Ours). Chromium refuses a page's commands for a moment while it swaps documents.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send a history command it refused that way again, every 50 ms for up to a second.
- *Reconsider:* this is a fixed retry cadence, which sits uneasily with "no magic delays" (README, principles). Waiting for the swap's evidence would be better if one exists.

**Q7. Firefox's realms come before their commit, sometimes after a transient one** (Browser). The new document's realm is created before `navigationCommitted`, sometimes after a realm with origin `null` that is destroyed at once. Chromium and WebKit create it after the commit.
- *Seen:* probe 1.
- *We:* hold a main-world realm created for a context whose document already had one until the next commit, and never report one destroyed before it.
- *Reconsider:* nothing yet; it is the spec's ordering question.

**Q8. Initial `about:blank` reuse differs** (Browser). Chromium and Firefox keep the initial `about:blank` realm into a same-origin first document; WebKit creates a new one.
- *Seen:* probe 2.
- *We:* model realms as siblings of documents (`RealmDocumentAdded`).
- *Reconsider:* nothing; recorded for completeness.

**Q9. Orphaned frames are reported differently** (Browser). Chromium sends no `frameDetached` for the children of a document a cross-document navigation replaced; Firefox and WebKit report them.
- *Seen:* probe 8.
- *We:* end a replaced document's children ourselves on Chromium.
- *Reconsider:* nothing yet.

**Q10. A 204 or a download reports its failure late, or as a fetch error, on Firefox** (Browser). For a 204, Firefox sends `navigationFailed` only when the next navigation starts, after an error reply to `navigate`.
- *Seen:* probe 15.
- *We:* end it as `NoContent` from the response and the reply.
- *Reconsider:* nothing yet.

**Q11. `document.open()` shows differently on every backend** (Browser). Chromium: `documentOpened` and lifecycle events again under the same loader. Firefox: `historyUpdated`, then `domContentLoaded` and `load` again. WebKit: only the load events again.
- *Seen:* probe 17.
- *We:* report a new generation of the same document.
- *Reconsider:* nothing yet.

**Q12. WebKit fires `load` before `DOMContentLoaded`** (Browser). `loadEventFired` usually comes before `domContentEventFired` for the same frame, and a parent's can come before its children's load.
- *Seen:* WebKit probe findings.
- *We:* fold readiness as each arrives; a `waitUntil: "domContentLoaded"` accepts `complete`.
- *Reconsider:* whether readiness should ever go backwards when they arrive out of order.

**Q13. A cross-site navigation in WebKit swaps targets and frame ids** (Browser). It loads in a provisional target whose main frame has a new id; the old target's `didCheckNavigationPolicy` says `cancel: true` though the navigation goes on.
- *Seen:* WebKit probe findings.
- *We:* map the new frame id onto the page's main frame and follow the loader id across.
- *Reconsider:* nothing yet.

**Q14. Firefox's `reload` refuses `ignoreCache` whatever its value** (Browser). "Argument "ignoreCache" is not supported yet", as `unsupported operation`.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send it only to bypass the cache, which then fails as `Unsupported`.
- *Reconsider:* when Firefox supports it.

**Q15. Firefox renders JSON in a viewer with a `resource://devtools` realm** (Browser).
- *Seen:* BiDi probe findings.
- *We:* nothing special beyond Q4's case.
- *Reconsider:* whether the viewer's realm should be hidden from callers.

**Q69. Firefox's traversal back from its JSON viewer went unreported under full load** (Browser). In one full integration run after review 16, the conformance test's `traverse(-1)` from `/json` removed the viewer's realm and fetched the page again, but no new realm and no end came within 10 s. Three runs of that test alone passed.
- *Seen:* review 16's revision, one full run of three; review 17's revision, two full runs of four.
- *We:* nothing yet; the restore inference (Q4) waits for a realm that didn't come.
- *Reconsider:* with Q4 and Q5, an end Firefox reports for every traversal.

## Browsers: dialogs, popups, focus and input

**Q16. A dialog blocks evaluation on Chromium and WebKit, not on Firefox** (Browser). Every evaluation in every world waits while a dialog is open on Chromium and WebKit; Firefox answers.
- *Seen:* review 13, P2.
- *We:* fail every operation on a page whose dialog nothing will decide at once with `PromptBlocking`, on every backend, Firefox included, for one rule.
- *Reconsider:* whether Firefox's reads should be let through after all.

**Q17. The click that opens a dialog doesn't return until it is decided** (Browser). On all three backends.
- *Seen:* review 13, P3.
- *We:* register handlers before the action; a click whose dialog nothing will decide fails with `PromptBlocking` and `dispatch: MayHaveBeenSent`.
- *Reconsider:* nothing; it shapes the API (handlers first).

**Q18. A popup's URL arrives after the popup** (Browser). Chromium reports `""` at `PageAdded`, Firefox and WebKit `about:blank`; the URL it was opened for arrives with its first navigation.
- *Seen:* review 13, P1.
- *We:* report the popup at once and match `url` filters against its first navigation, offering the entry again then.
- *Reconsider:* nothing yet.

**Q19. The opener goes to the background, and headless Chromium stops rendering it** (Browser). After `window.open`, Chromium and Firefox report the opener `hidden`; headless Chromium renders no frames for it, so actions on it time out with `NoRenderingOpportunity` until `page.activate`.
- *Seen:* review 13.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`.
- *Reconsider:* whether an explicit option to keep openers rendering is worth having.

**Q20. A paused popup blocks its opener's `window.open`** (Browser). On Chromium, `window.open` doesn't return until the paused popup resumes, and popups can be paused only browser-wide.
- *Seen:* probe 22.
- *We:* pause browser-wide only when the browser was launched.
- *Reconsider:* attached browsers' popups, when attaching is built.

**Q21. User activation from evaluation lasts differently** (Browser). Firefox's `userActivation: true` grants activation only during the call; Chromium's `userGesture` and WebKit's `emulateUserGesture` leave it active after.
- *Seen:* probe 20.
- *We:* nothing; operations that need activation request it per call.
- *Reconsider:* whether to normalize.

**Q22. WebKit aborts on two commands instead of failing** (Browser). `Playwright.navigate` with a frame id the page doesn't have (exit 134) and `Dialog.handleJavaScriptDialog` with no dialog open (exit 139).
- *Seen:* WebKit probe findings.
- *We:* never send either outside what the model has seen; a frame that goes between the check and the command is a race we can't close.
- *Reconsider:* when the build is rolled.

**Q23. A raw WebKit dialog answer left the page blocked once** (Browser). In a scratch probe, the same answer the adapter sends left the dialog open; the difference was never traced.
- *Seen:* WebKit probe findings.
- *We:* nothing; the adapter's answers work.
- *Reconsider:* trace it before relying on raw-protocol access to WebKit.

**Q24. A second client can crash a page another client created** (Browser). On Chromium, a second CDP client attached to a page the first had created and crashed it.
- *Seen:* probe 25.
- *We:* nothing yet.
- *Reconsider:* when attaching to browsers others drive is built.

**Q70. A page in the background of its context renders nothing on headless Chromium** (Browser). Not only a popup's opener (Q19): a page created after another in the same context puts the first in the background, `hidden`, with no frames, though keys and clicks still reach it. Pages in different contexts, and every WebKit page, keep rendering. The `concurrent` profile's switches don't change it.
- *Seen:* review 16, P4, P10 and P11.
- *We:* create each page the library opens as a window of its own (`Target.createTarget{newWindow}`), which keeps it visible and rendering. A popup still opens where its opener's script puts it (Q19).
- *Reconsider:* whether a window per page changes anything a page observes (its window's position and size), and whether headless Chromium will render background tabs.

**Q71. A page in the background of a Firefox context renders about once a second** (Browser). It is `hidden`, with 3 animation frames in 4 s, two seconds after the other page opened; P4 had measured one frame in 150 ms, early. Two frames never fall in one second-long round, so the stable check never passes, and an action there times out, alternating `NotStable` and `NoRenderingOpportunity`. `layout.throttled_frame_rate` in the launch prefs didn't change it, and creating Firefox pages as windows broke navigation in review 16's probe.
- *Seen:* review 16's revision.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`, after which the action works.
- *Reconsider:* Firefox pages as windows, probed again; or a stable check that spans rounds, which would make such actions slow rather than stuck.

**Q72. WebKit's mouse events ignore modifiers** (Browser). Neither the event's modifier flags nor Shift held as a key reach a click's `shiftKey`.
- *Seen:* review 16, P1.
- *We:* `input.pointerModifiers` is `unsupported` on WebKit. A pointer action or `mouse.click` with modifiers, or while one is held, fails with `Unsupported` before anything is sent.
- *Reconsider:* when the build is rolled.

**Q73. WebDriver's pointer actions carry no modifier flags** (Browser). Firefox takes modifiers only from keys held in the same actions; Shift held as a key reaches `shiftKey`.
- *Seen:* review 16, P1.
- *We:* hold modifiers as keys on every backend, pressed before the gesture and released after, and set the flags too.
- *Reconsider:* nothing.

**Q74. WebDriver's Enter is the numpad's** (Browser). `\uE007` (Enter) arrives in Firefox with `code: "NumpadEnter"`; `\uE006` (Return) is the main Enter.
- *Seen:* review 16, P2.
- *We:* the BiDi adapter sends Return for `Enter`.
- *Reconsider:* nothing.

**Q75. BiDi has no command to insert text** (Browser). Text is typed as key actions, so `insertText`, and `fill`, fire key events for each character on Firefox, and on no other backend.
- *Seen:* review 16, P3.
- *We:* `input.insertText` is `partial` on BiDi, saying so.
- *Reconsider:* if BiDi adds one.

**Q76. Only Chromium can finish an HTML drag, and only when asked to** (Browser). Chromium starts an HTML drag from input only with `Input.setInterceptDrags` on, and only when each move names the button held (`button`, not just `buttons`); it then hands the drag to the client to finish with drag events. Firefox starts one from WebDriver actions and never drops it. WebKit's protocol has no drag commands.
- *Seen:* review 16, P5 and P9; the move's button, review 16's revision.
- *We:* the CDP adapter turns interception on with the first move that holds a button, and finishes the drags it intercepts. `input.dragAndDrop` is unsupported elsewhere, so `dragTo` from a draggable element fails there with `Unsupported` before anything is sent. Drags by pointer events work everywhere.
- *Reconsider:* Firefox, if it starts dropping; and whether interception, once on, should stay on for the page's life.

**Q77. WebKit fires no `click` after a tap** (Browser). A touch start and end reach the page, with touch pointer events, on all three; Chromium and Firefox follow with compatibility mouse events and `click`, and WebKit doesn't.
- *Seen:* review 16, P6.
- *We:* nothing; `tap` sends the touch, and the page decides.
- *Reconsider:* nothing.

**Q78. Firefox on the desktop has no touch event interface, yet dispatches touch events** (Browser). `TouchEvent` is undefined and `'ontouchstart' in window` is false, so an `ontouchstart` attribute never runs, but `touchstart` and `touchend` reach `addEventListener` listeners.
- *Seen:* review 16's revision; P6 had listened with `addEventListener`.
- *We:* nothing; a page that detects touch support finds none on Firefox.
- *Reconsider:* whether `tap` should need touch emulation where a page checks for support.

**Q79. What the utility world dispatches is untrusted** (Browser, by design). `selectOption`, and `fill` on an input whose value isn't typed, set the value and dispatch `input` and `change` from the utility world, so the page sees `isTrusted: false`.
- *Seen:* review 16, P7.
- *We:* accept it: a select's popup and a date picker aren't drivable headless, and pages rarely check `isTrusted` on `change`.
- *Reconsider:* choosing an option with keys where a backend can.

## Browsers: downloads and file choosers

**Q25. Each browser does something different with a download nobody configured** (Browser). Chromium cancels it; Firefox and WebKit save it into `$HOME/Downloads` (WebKit without reporting the path).
- *Seen:* review 14, P1.
- *We:* give every context the library creates a temporary download directory, removed after it. The default context keeps the browser's behaviour.
- *Reconsider:* a `downloads: "deny"` option, and what attached browsers' contexts should do.

**Q26. Every browser writes a download into a partial file of its own naming** (Browser). `<guid>.crdownload` (Chromium), `<name>.<random>.bin.part` beside an empty `<name>` (Firefox), `<uuid>.wkdownload` beside an empty `<uuid>` (WebKit), renamed when done.
- *Seen:* review 14, P2.
- *We:* read a download's bytes only once it completes; `Download.stream` can't deliver them as they arrive.
- *Reconsider:* streaming from the partial file per backend.

**Q27. Only Chromium reports a download's progress, and only CDP and WebKit can cancel one** (Browser).
- *Seen:* review 14, P2 and P4.
- *We:* capabilities `downloads.progress` and `downloads.cancel`; `cancel` fails with `Unsupported` on BiDi.
- *Reconsider:* when BiDi adds them.

**Q28. A download in progress when its context goes is reported three ways** (Browser). Chromium: canceled. Firefox: nothing at all. WebKit: *completed*, with an empty file.
- *Seen:* review 14, P3.
- *We:* the context's end makes it `Canceled`, and the fold ignores what the backend says after.
- *Reconsider:* nothing; WebKit's report is wrong.

**Q29. Firefox leaves a canceled file chooser open** (Browser). With `unhandledPromptBehavior.file: "ignore"`, a chooser nothing decides stays open, and the page's later clicks open nothing.
- *Seen:* review 14, P5.
- *We:* set `file: "dismiss"`, so every chooser is dismissed as it opens; the input gets a `cancel` event before any decision, and files set after it still arrive with `input` and `change` (P6). `fileChooser` is `partial` on BiDi.
- *Reconsider:* whether BiDi gains a way to answer a chooser without the page seeing `cancel`.

**Q30. A file input clicked with no interception does three different things** (Browser). Headless Chromium fires `cancel` at once; WebKit does nothing; Firefox reports it anyway.
- *Seen:* review 14, P7.
- *We:* arm interception on every page of a context the library creates.
- *Reconsider:* nothing yet.

**Q31. `input.showPicker()` opens a chooser on Chromium, not on WebKit** (Browser). Firefox wasn't probed (Q29 left its picker open).
- *Seen:* review 14, P8.
- *We:* nothing.
- *Reconsider:* probe Firefox now that it dismisses.

**Q32. WebKit's `downloadCreated` names a frame id that isn't the page's** (Browser).
- *Seen:* WebKit probe 15.
- *We:* attribute the download to the page.
- *Reconsider:* nothing yet.

## Browsers: console, exceptions and workers

**Q33. Console text is formatted differently** (Browser). Firefox applies format specifiers (`%s`, `%d`), Chromium and WebKit don't; objects render as their class name (`Object`, Firefox's `Object(2)`); `console.count()` is `debug` on WebKit and `log` elsewhere; `console.timeEnd` of an unknown timer is a warning on Chromium and WebKit and a log on Firefox, each worded differently.
- *Seen:* review 14, P9.
- *We:* report the browser's text and level as they are.
- *Reconsider:* formatting from the arguments ourselves, which needs their handles.

**Q34. Console locations have different bases and columns** (Browser). Chromium's and Firefox's lines and columns are 0-based, WebKit's 1-based; the column points at the call's property on Chromium and its parenthesis on WebKit.
- *Seen:* review 14, P9.
- *We:* convert to 1-based on CDP and BiDi; columns stay where each engine puts them.
- *Reconsider:* nothing yet.

**Q35. A thrown value that isn't an Error is reported badly** (Browser). For `throw "a string"`, Chromium's exception has no description (the text is `Uncaught`), or no exception object at all when a timer an evaluation set throws (the text is `Uncaught a string`); Firefox's text is `uncaught exception: a string`.
- *Seen:* review 14, P10, and its revision's conformance test.
- *We:* report an `Error` whose message is the value, on every backend.
- *Reconsider:* keeping the value's type (string, number) somewhere.

**Q36. Firefox can't tell an unhandled rejection from a throw** (Browser). Its log entry has no `Uncaught (in promise)` marker and no stack for a rejection.
- *Seen:* review 14, P10.
- *We:* `kind: "unknown"` on Firefox; `exceptions.kind` is `partial`.
- *Reconsider:* when BiDi distinguishes them.

**Q37. Workers are reported unevenly** (Browser). Chromium reports dedicated, shared and service workers with their context, and evaluates in all. Firefox reports all three, names a dedicated worker's owner realm but not its page, has no context for shared and service workers, can't evaluate in any ("Realm with id … not found"), attributes a dedicated worker's console to its page's realm, and reports no console from shared or service workers. WebKit reports dedicated workers only.
- *Seen:* review 14, P11; BiDi probe findings.
- *We:* name a dedicated worker's page from its owner on BiDi; capabilities `workers.shared`, `workers.service`, `workers.evaluate`; `console` `partial` on BiDi.
- *Reconsider:* when Firefox can evaluate in workers or name their context.

**Q38. A worker's requests are attributed to its page on Firefox and WebKit** (Browser). Chromium names the worker as the initiator; Firefox and WebKit name the page's document. WebKit also types a worker's script load as `xhr`, and sends it on the page's target before `workerCreated`.
- *Seen:* review 14, P11; WebKit probe findings.
- *We:* report what each says.
- *Reconsider:* correlating by URL, which would be a guess.

## Browsers: network

**Q39. A redirect hop's body is asked for with an id the adapters never minted** (Ours, found in the adapters). Asking any adapter for a 302 hop's body failed as `Foreign`.
- *Seen:* review 14, P13.
- *We:* `BodyUnavailable{redirect}` without asking the browser.
- *Reconsider:* fixing the adapters' hop tables so the error, if asked, is honest.

**Q40. An event stream's body never finishes, so reading it waits forever** (Browser). On all three.
- *Seen:* review 14, P14.
- *We:* bound the wait by the deadline (`next`) or `Deadline.DefaultBudget` per body (`stream`), then `BodyUnavailable{streaming}`.
- *Reconsider:* recognizing streaming responses from their headers instead of waiting.

**Q41. EventSource and WebSocket support differ** (Browser). Only Chromium reports an EventSource as a connection with its messages (and only from its first message); WebKit and Firefox report only its request (`eventSource`, or Firefox's `other`). Firefox reports a WebSocket only as its handshake, an `http:` request answered 101, with no frames and no close.
- *Seen:* review 14, P14 and P15.
- *We:* capabilities `networkConnections` and `networkConnections.eventSource`; subscribing where they're missing fails with `Unsupported`.
- *Reconsider:* synthesizing Firefox's connections from the handshake if BiDi adds a close event.

**Q42. WebKit reports a WebSocket's close handshake as binary frames** (Browser). Two frames, opcode 8, reported as messages.
- *Seen:* review 14, P15.
- *We:* drop control frames (opcode 8 and above) on CDP and WebKit.
- *Reconsider:* nothing.

**Q43. Who served a response is reported differently** (Browser). Chromium marks a cache hit with `requestServedFromCache` and `fromDiskCache: false`; Firefox sets `fromCache` for service-worker responses too; WebKit says `source` exactly, and has an `unknown`. A script reused from the memory cache within a document makes no request on Chromium and WebKit; Firefox reports it.
- *Seen:* review 09; probes 7.
- *We:* `servedBy` with `cacheOrServiceWorker` for Firefox's case and `unknown` for WebKit's.
- *Reconsider:* nothing yet.

**Q44. WebKit's intercepts don't see a page a service worker controls** (Browser). Even the requests the worker passes to the network.
- *Seen:* review 09; probe 7.
- *We:* `interception.request` and `.response` are `partial` on WebKit.
- *Reconsider:* when routes are built.

**Q45. BiDi can't scope an intercept to a user context** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* intercept browser-wide and filter in the adapter.
- *Reconsider:* when BiDi adds the scope.

**Q46. Chromium's interception tests flake under full load** (Ours, a test flake). Occasionally a request isn't paused, or a fulfilled one reads as served by the network, when the whole integration suite runs at once; seen before and after review 14.
- *Seen:* review 14's revision runs; traced in review 17's revision (Q103).
- *We:* nothing yet; listed in PROTOCOL.md.
- *Reconsider:* find whether an intercept declaration is acknowledged before it is in force (CONCEPTS.md §7, Installation), when routes are built.
- **Resolved** in review 17's revision: the declaration was acknowledged before it was in force, apparently because `Fetch` enabled with no patterns gave up its interceptor. Q103 says what we do now.

**Q89. Only Chromium shows a route the CORS preflight** (Browser). A cross-origin `PUT` with a custom header pauses first as an `OPTIONS` request on Chromium; Firefox and WebKit pause only the `PUT`. A fulfilled cross-origin response needs CORS headers on all three.
- *Seen:* review 17, P9.
- *We:* show what Chromium shows: a route matching cross-origin requests on Chromium answers their preflights, or lets them continue to the server.
- *Reconsider:* answering a preflight for a route that fulfills its request, as Playwright does, which would hide a request the page made.

**Q90. WebKit pauses a redirect's first hop only, and won't follow a redirect a route fulfills** (Browser). A fetch fulfilled with `302` and `Location` gets the `302` itself, while Chromium and Firefox follow it and pause the target as the next hop.
- *Seen:* review 17, P2 and P7.
- *We:* `interception.redirects` is `partial` on WebKit.
- *Reconsider:* when the build is rolled.

**Q91. Only CDP fails a request with the reason asked for** (Browser). Firefox reports `NS_ERROR_ABORT` for every reason, and WebKit "Blocked by Web Inspector".
- *Seen:* review 17, P4.
- *We:* `Route.abort()` is `failed` everywhere; another reason is `interception.abortReason`, CDP's alone.
- *Reconsider:* nothing.

**Q92. Firefox aborts a request continued with a new URL, and keeps the old length with a new body** (Browser). The body arrives broken unless its `Content-Length` is sent too.
- *Seen:* review 17, P3, through the adapter and raw BiDi.
- *We:* a new URL is `Unsupported` (`interception.continueUrl`); the BiDi adapter sends a new body's length.
- *Reconsider:* when Firefox implements `url`.

**Q93. Firefox can't fulfill at the response phase, and leaves a request it refused paused** (Browser). `network.provideResponse` there answers `unsupported operation`; a continue with new headers replaces the response's.
- *Seen:* review 17, P5.
- *We:* refuse it up front (`interception.responseFulfill`), so the default continues the request.
- *Reconsider:* a response-phase decision that changes headers only, which Firefox and CDP can do.

**Q94. Only CDP can read a response paused at the response phase** (Browser). WebDriver BiDi has no body as a response starts, and Playwright's WebKit no command for it.
- *Seen:* review 17, P5.
- *We:* `interception.responseBody` is CDP's alone; patching a response's body works on Chromium only.
- *Reconsider:* when either protocol adds one.

**Q95. Firefox's default answer to a challenge waits forever, headless** (Browser). `continueWithAuth{action: "default"}` shows its prompt, which nothing answers.
- *Seen:* review 17, P6.
- *We:* the default at a challenge is the challenge's response (`CancelAuth`), never the browser's prompt.
- *Reconsider:* nothing.

**Q96. Chromium asks about a challenge only for a request intercepted as it starts, and lowercases its scheme** (Browser). With a response-stage pattern it pauses the `401` as a response and refuses credentials for it.
- *Seen:* review 17, P6, and its revision, where the registry had kept auth patterns as response-stage ones.
- *We:* auth patterns pause at the request stage, where a request nothing else wants continues at once; schemes are lowercased on every backend.
- *Reconsider:* nothing.

**Q97. Chromium refuses a `Content-Length` header in a continued request** (Browser). `Fetch.continueRequest` answers "Unsafe header: content-length", and computes the length itself.
- *Seen:* review 17's revision.
- *We:* routes never send it; the BiDi adapter sends it, since Firefox doesn't compute it (Q92).
- *Reconsider:* nothing.

**Q98. A paused request's resource type differs from its events'** (Browser). Chromium's `Fetch` calls a `fetch()` an `XHR`, where its `Network` events say `Fetch`; WebKit's pause carries no type.
- *Seen:* review 17, P11.
- *We:* a paused request takes the type its network events gave it, where they came first.
- *Reconsider:* nothing.

## Browsers: emulation, permissions and declarations

**Q47. WebKit's init scripts run in the main world only** (Browser). `Page.setBootstrapScript` has no world.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* an init script for an isolated world is `Unsupported` there.
- *Reconsider:* when init scripts are built at L2.

**Q48. WebKit's locale reaches only new web processes, and a document caches its user agent** (Browser). `Playwright.setLanguages` doesn't reach a process already running; `navigator.userAgent`, once read, keeps its value until the next navigation.
- *Seen:* WebKit probe findings.
- *We:* a locale declared for pages that exist is `Unsupported`; a user-agent override reaches a document only at its next navigation.
- *Reconsider:* when emulation is built at L2.

**Q49. WebKit's viewport is a resize with nothing to clear** (Browser). `setDeviceMetricsOverride` resizes the view (0 by 0 empties it); WPE headless starts at 1024 by 768.
- *Seen:* WebKit probe findings.
- *We:* measure the size before the first resize and restore it.
- *Reconsider:* nothing yet.

**Q50. Firefox's permissions have no reset; WebKit's are per page** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi and WebKit.
- *We:* set the ones granted back to `prompt` on Firefox; reset clears every grant in the context on WebKit.
- *Reconsider:* when grants are built at L2.

**Q51. Firefox lacks several commands** (Browser). A navigation referrer, media-feature overrides and focus emulation answer `unknown command`.
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* `Unsupported`, named by the method.
- *Reconsider:* on each roll.

**Q52. Chrome prints PDFs only headless, and WebKit not at all** (Browser).
- *Seen:* capability profiles.
- *We:* `pdf` is `unknown` for headful Chrome and `unsupported` on WebKit.
- *Reconsider:* nothing.

**Q99. Firefox 158 lacks most of `emulation`** (Browser). Media features, touch, scripting and focus emulation answer `unknown command`; a mobile viewport has no flag; an unavailable position is rejected; and every-origin grants and four of the common permission names (`clipboard-read`, `clipboard-write`, `background-sync`, `local-fonts`) aren't WebDriver BiDi's or Firefox's.
- *Seen:* review 17, P13 to P15.
- *We:* each is refused up front under the capability named for its field, and a name Firefox rejects fails with `InvalidInput`.
- *Reconsider:* when Firefox implements them.

**Q100. WebKit's emulation is uneven** (Browser). Its touch override changes nothing a page sees (no touch points, `ontouchstart` always there), it ignores an unavailable position, it sets locale and position per context, the locale only before the context's pages exist, a mobile viewport reloads at 979 CSS px and a device pixel ratio of 0.82, `navigator.userAgent` changes only at the next document, a page reports `hasFocus()` false and `prefers-reduced-motion: reduce` without emulation, and every permission name is accepted though its Permissions API can query few.
- *Seen:* review 17, P13 to P15.
- *We:* refuse touch and an unavailable position; say the rest in the capability entries' limitations.
- *Reconsider:* when the build is rolled.

**Q101. An init script runs before the document has an element, and on Firefox inside a function** (Browser). `document.documentElement` is null on every backend; WebDriver BiDi's preload scripts are functions, so a script's top-level `var` and function declarations aren't globals there, as they are on CDP and WebKit.
- *Seen:* review 17, P12, and its revision.
- *We:* document both; a BiDi preload keeps which scripts ran under a `Symbol.for` key a page could find.
- *Reconsider:* evaluating a Firefox script's source at global scope, if the page's CSP allows it.

## Browsers: protocols and transports

**Q53. Firefox deviates from the BiDi spec in two events** (Browser). `contextCreated` has no `hasPlannedNavigation`, which the spec requires, and `navigationStarted` has no `url` for the navigation that `close({ promptUnload: true })` starts.
- *Seen:* the two corrections in `packages/tools/codegen/protocols/bidi/patches/`, with their recorded evidence.
- *We:* correct the protocol model; the audit lists a correction once the spec absorbs it.
- *Reconsider:* on each roll (`pnpm codegen:audit`).

**Q54. Chromium still sends deprecated events nothing subscribes to** (Browser). `Page.frameScheduledNavigation`, `frameClearedScheduledNavigation`, `downloadWillBegin` and `downloadProgress`.
- *Seen:* the drift test's first recording.
- *We:* the coverage report excludes them by policy.
- *Reconsider:* nothing.

**Q55. Huge messages break transports in different places** (Browser and platform). Node's built-in WebSocket closes at 128 MiB, `ws` at 100 MiB; Chrome escapes non-ASCII as `\uXXXX`, so a string can exceed V8's longest string, which used to hang the reader.
- *Seen:* PROTOCOL.md, Transports.
- *We:* lose the connection with a description; launched browsers use the pipe; remote endpoints are limited to 128 MiB until Effect's constructor passes `ws` options through.
- *Reconsider:* a `ws` constructor of our own, or upstream option passthrough.

**Q56. WebKit carries a command in a wrapper that takes a negated id** (Browser and ours). Commands to a target or worker go inside `Target.sendMessageToTarget` or `Worker.sendMessageToWorker`; we give the wrapper the negated id of the command it carries.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* ignore the wrapper's success and turn its failure into the carried command's.
- *Reconsider:* nothing.

**Q57. WebKit needs `getResourceTree` before `Runtime.enable`** (Browser). Otherwise its snapshot doesn't precede the contexts `Runtime.enable` replays. Execution context ids on CDP restart after a process swap, while `uniqueId` doesn't.
- *Seen:* WebKit and CDP probe findings.
- *We:* order the gate accordingly; key CDP realms by `uniqueId`.
- *Reconsider:* nothing.

**Q102. WebKit reports a page's existing user world for a new document after it commits** (Browser). An engine request right after a second `goto` found no realm in the world and asked to create it, which WebKit refuses ("World with the given name already exists"), so every read after a second `goto` failed.
- *Seen:* review 17's revision; the suites had navigated a page twice only by clicking links before.
- *We:* when the page already has the world, the WebKit adapter waits for its report for the document, or the document's end.
- *Reconsider:* nothing.

## Ours: workarounds and odd shapes

**Q58. `PromptBlocking` carries the dialog's kind and text, not `Page.Prompt`** (Ours). `Reason` is a leaf module, and importing `Page` into it makes a load cycle.
- *Seen:* review 13's revision.
- *Reconsider:* whether `Prompt` should live somewhere `Reason` can import.

**Q59. `PageNavigation.next` reaches `goto`'s outcome mapping through `Runtime.settle`** (Ours). `PageNavigation` can't import `Page` as a value: `Page.ts` needs `PageNavigation`'s classes as it loads.
- *Seen:* review 14's revision.
- *Reconsider:* moving the navigation reasons out of `PageNavigation`, or the `PageError` constructor out of `Page`, so the import is direct.

**Q60. Unbuilt module functions are erased, so some are odd stubs** (Ours). Node erases a `declare const`, so a module that used one as it loaded failed to load. `Deferred.await` was a `NotBuilt` function until review 13 (the module is gone since review 15), and `Route.continue` is a decision nothing reads yet.
- *Seen:* review 12's slice; `test/Modules.test.ts`.
- *Reconsider:* goes away as modules are built.

**Q61. A `Watchable` is an effect value with members attached** (Ours). Effect 4 has no public way to subclass `Effect`.
- *Seen:* review 12.
- *Reconsider:* if Effect adds one.

**Q62. A wait on a final value fails at once with `Timeout`** (Ours). A download's `status` ends in a final value, not with its target; `waitFor` a value it can no longer reach fails at once with `Timeout{waitingForCondition}` and a hint, which isn't a timeout.
- *Seen:* review 14's revision.
- *Reconsider:* a reason of its own for "can never happen", or `TargetGone` with a download as a target.

**Q63. `AutoResolution.policy` names a setting that doesn't exist** (Ours). A canceled file chooser reads `policy: 'fileChoosers: "cancel"'`, though no `fileChoosers` option exists; there is one policy.
- *Seen:* review 14.
- *Reconsider:* an option, or a different way to say "the only policy".

**Q64. A body that isn't JSON is a `BackendFailure`** (Ours). `CapturedResponse.json` fails with `BackendFailure{IncompatibleResponse, method: "json"}`; no reason of `ResponseError` fits a page's malformed body.
- *Seen:* review 14's revision.
- *Reconsider:* a reason for it.

**Q65. `BodyLimit` is compared with the encoded size** (Ours). The size the browser reports when a hop ends is encoded (compressed), which is what BiDi's collector bounds, so a 10 MiB limit admits a larger decoded body.
- *Seen:* review 14's revision.
- *Reconsider:* whether callers expect a decoded size.

**Q66. A `Timeout` whose every observation was `NoMatch` has the phase `resolving`** (Ours). Not `waitingForCondition`, since nothing was ever there to wait on.
- *Seen:* review 12's revision.
- *Reconsider:* nothing; recorded because it surprises.

**Q67. `getByText` doesn't search the document's `head`** (Ours).
- *Seen:* review 12's revision.
- *Reconsider:* nothing; recorded because it surprises.

**Q68. A click that times out after dispatch says `dispatchedUnconfirmed`** (Ours). A dialog the input opened is what holds such a dispatch (Q17).
- *Seen:* review 13's revision.
- *Reconsider:* nothing.

**Q80. The fold published events after the state they change** (Ours). `goto`'s outcome was latched before the navigation's end was published, so a `PageNavigation.next` made right after `goto` received `goto`'s own navigation. Popups, workers, dialogs and document readiness had the same order.
- *Seen:* review 16's revision, through review 14's `waitUntil` test on Chromium.
- *We:* publish first, then change the state (CONCEPTS.md §9, Subscriptions).
- *Reconsider:* nothing; recorded because the order is now a rule every new fact must keep.

**Q81. The guard can't stop a page's own earlier window listeners** (Ours). The guard listens on the window in the capture phase, armed just before dispatch, so a page listener added there earlier runs first and sees an event the guard then stops. Listeners anywhere else are protected.
- *Seen:* review 16's revision.
- *We:* nothing.
- *Reconsider:* if a page relies on window capture listeners for clicks.

**Q82. Every waiting expectation evaluates at every animation frame** (Ours). Not only those that depend on layout: one evaluation per frame for each, in the page, while it waits.
- *Seen:* review 16's revision.
- *We:* accept the cost, for one rule.
- *Reconsider:* frames only for layout conditions, if pages with many waiting expectations slow down.

**Q83. A shadow root's mutations don't wake an expectation** (Ours). The `MutationObserver` watches the document, and doesn't see into shadow roots; the next frame, or in a page that renders none the next round, catches the change.
- *Seen:* review 16's revision.
- *We:* nothing more.
- *Reconsider:* observing each open shadow root.

**Q84. A failed release leaves a page unable to take input, for good** (Ours). After a held key's or button's release fails on a live page, every later gesture on it fails with `BackendFailure`, and nothing but a new page resets it.
- *Seen:* review 16's revision.
- *We:* fail loudly rather than act with a key that may still be down (CONCEPTS.md §5, Compensation).
- *Reconsider:* a reset that releases every key and button the page could hold.

**Q85. `Condition` isn't `Pipeable`, though `because` is dual** (Ours). `condition.pipe(Condition.because("…"))` doesn't compile; `Condition.because(condition, "…")` and `pipe(condition, Condition.because("…"))` do.
- *Seen:* review 16's revision.
- *We:* nothing.
- *Reconsider:* making it `Pipeable`, like the handles.

**Q86. Keys are the US layout's** (Ours). Shift turns `1` into `!` as on a US keyboard, and a character outside the table is a key with `code: ""`.
- *Seen:* review 16.
- *We:* nothing.
- *Reconsider:* other layouts, if a test needs one.

**Q87. `Expect.that` turns its subject's timeout into its own failure** (Ours). A subject still running at the expectation's deadline, or failing with `Timeout` once it has passed, ends the expectation with `ExpectationFailed`; a shorter deadline inside the subject stays the subject's failure. The two are told apart only by whether the expectation's deadline has passed.
- *Seen:* review 16's revision, under full load: a `Locator.count` timed out while resolving.
- *We:* as above.
- *Reconsider:* nothing; recorded because it surprises.

**Q88. The CDP adapter assumes Chromium reports an intercepted drag before the next move** (Ours). A drag Chromium intercepts is announced by an event, `Input.dragIntercepted`; the adapter turns the moves after it into drag events, so an announcement that arrived after the release would leave a drag the adapter thinks is in progress.
- *Seen:* review 16's revision; it held in every run.
- *We:* nothing yet.
- *Reconsider:* waiting for the page's `dragstart` after the first held move, as Playwright does, and clearing a drag the release didn't end.

**Q103. Chromium's `Fetch` stays enabled for every page, with a pattern nothing matches** (Ours). It keeps the interceptor installed, so a route declared on a live page is in force when its declaration returns (Q46).
- *Seen:* review 17's revision: one request in 40 went past a route under load before; none in 160 after.
- *We:* `Fetch.enable` from each page target's start, never disabled.
- *Reconsider:* whether an interceptor always installed costs anything measurable; and whether Chromium can say when its interceptor is in force.

**Q104. A decision a backend can't apply lets the request through** (Ours). `Route.abort("timedOut")` on Firefox, or a fulfill at the response phase there, is a handler failure, so the default, continue, applies, logged and published as an `AutoResolution`: the route fails open.
- *Seen:* review 17's revision.
- *We:* as above, for one rule with handler failures.
- *Reconsider:* failing closed for an abort, which would be a decision nobody made.

**Q105. Routes' automatic decisions name a setting that doesn't exist** (Ours). `policy: 'routes: "continue"'`, as file choosers' do (Q63).
- *Seen:* review 17's revision.
- *We:* nothing.
- *Reconsider:* with Q63.

**Q106. A route with a `URLPattern` pauses every request** (Ours). L0 can't read a `URLPattern`, so the intercept covers everything and the route matches itself; requests it doesn't match continue at once, a round trip each.
- *Seen:* review 17's revision.
- *We:* a glob or an exact URL is passed to L0 as it is.
- *Reconsider:* translating a `URLPattern`'s fixed parts into a glob.

**Q107. A removed init script's dependents stay registered** (Ours). They don't run once their dependency is gone, since L0 runs a script only after what it comes after ran, but they are still declared until their own scope closes.
- *Seen:* review 17's revision; the review said they would be removed.
- *We:* as above.
- *Reconsider:* removing them, which would need L1 to own their scopes.

**Q108. The page clock's controls are on a symbol the page can find** (Ours). `Symbol.for` with a random token keeps page script from stumbling on them, not from looking.
- *Seen:* review 17.
- *We:* as above.
- *Reconsider:* driving the clock from the isolated world through the DOM, if pages turn out to touch it.

**Q109. A page's clock and its context's can't both be installed** (Ours). One timeline covers a page, so the second `install` is a `Conflict`.
- *Seen:* review 17's revision.
- *We:* as above.
- *Reconsider:* letting a page's clock override its context's, as overrides do.
