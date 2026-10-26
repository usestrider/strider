# QUIRKS: weird behaviors to reconsider

*Started 2026-10-23, at the maintainer's request: "record all the weird behaviors we amass as we build, so we can go back and reconsider them when we're done." Back-filled from the probes (PROBES.md, Results), the reviews and PROTOCOL.md's Built sections, up to review 14's revision (`ebe4b16`).*

Two kinds of entry:

- **Browser:** something a browser or protocol does that is surprising, inconsistent with the other browsers, or at odds with its spec.
- **Ours:** a compromise in Strider itself: a workaround a browser forced, a shape the platform or Effect forced, or a choice that reads oddly out of context.

Each entry says what is weird, where it was seen (with the builds: Chromium 155.0.8059.79, Firefox 158.0, Playwright's WebKit 2359), what Strider does about it now, and what to reconsider. None is resolved by being listed here; this is the list to walk when the library is built. Entries are never removed, only marked:

- **Resolved**, with the commit that resolved it;
- **Kept**, with the review that kept it and why;
- **Reported**, with its draft in `upstream/`, and the report's link once one is sent.

An entry with no marker is open. Review 21 walked every entry and decided each.

**Adding one.** When building or probing turns up something weird, add it here in the same commit, at the end of its section, with the next number. Numbers are stable, so reviews and code comments can cite them (`QUIRKS.md, Q12`).

## Browsers: navigation, history and documents

**Q1. Chromium commits its error page under the failed navigation's loader id** (Browser). A navigation that fails is reported failed on `Network.loadingFailed`, and Chromium then commits `chrome-error://chromewebdata/` with `frameNavigated` and no `frameStartedNavigating`, under the failed navigation's own loader id.
- *Seen:* review 12's slice (PROTOCOL.md, Found by the slice), CDP probe findings.
- *We:* keep a failed navigation on its frame by loader id until the frame's next commit, and make the error page its document (`createdBy: ErrorPage`), not a navigation of its own. Before that, it superseded the next `goto`.
- *Reconsider:* whether the error document should be visible to callers at all, and whether `Failed{errorDocument}` is the right shape.
- **Kept** in review 21: the *We* line is the decision.

**Q2. Firefox reports a refused navigation as its error page's URL** (Browser). A navigation Firefox refuses at once, such as to a port browsers don't use (9), starts as `about:neterror?e=deniedPortAccess&u=…`, not the URL it was going to; an error page also commits under a navigation id `navigationStarted` never announced.
- *Seen:* review 14's revision; BiDi probe findings.
- *We:* report where it was going, from the error page's `u` parameter (`intended` in the BiDi adapter).
- *Reconsider:* whether to report the error page's URL anywhere, and whether other `about:` pages (`certerror`) carry the same parameter in every case.

**Q3. WebKit reports nothing at all for a navigation to a restricted port** (Browser). A link to port 9 produces no navigation, request or failure event on the inspector targets; only `Playwright.provisionalLoadFailed` and a `security` console message for a command's navigation.
- *Seen:* review 14's revision probe; WebKit probe 15.
- *We:* nothing: a `PageNavigation.next` waiting for it times out.
- *Reconsider:* reporting the console message's evidence as a failed navigation, or a hint on the timeout.
- **Kept** in review 21: the *We* line is the decision.

**Q4. Back/forward-cache restores look different on every backend** (Browser).
- Chromium restores under the restored document's *original* loader id (`frameNavigated{type: BackForwardCacheRestore}`), creating its context before the commit, and refuses a page's commands with "Not attached to an active page" for a moment while it swaps documents.
- Firefox restores with no `navigationCommitted`, `domContentLoaded` or `load`: the old realm goes and a new one comes, and `traverseHistory` replies after. Leaving its JSON viewer before it has loaded, it doesn't even send `navigationStarted`. A console message the restored page logged when it loaded comes again.
- WebKit keeps no back/forward cache: going back loads the page again.
- *Seen:* PROTOCOL.md, History and restores; probes 3.
- *We:* report each as `Restored` where the evidence allows, inferring Firefox's from a new main-world realm while a traversal is in flight.
- *Reconsider:* the inference on Firefox, which is timing-dependent (Q5), and the duplicate console message.
- **Reported** in review 21's fifth step: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q5. Firefox can reply to `traverseHistory` before the restored document's realm arrives** (Browser). Under load, the reply came first, and the adapter, which looked for a waiting realm only at the reply, never ended the traversal.
- *Seen:* review 14's revision, in two full integration runs of four.
- *We:* restore the traversal when the realm arrives (`restoring` on the navigable).
- *Reconsider:* whether Firefox will ever report restores with a commit, which would remove both this and Q4's inference.
- **Reported** in review 21's fifth step: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q6. Chromium retries are needed for "Not attached to an active page"** (Ours). Chromium refuses a page's commands for a moment while it swaps documents.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send a history command it refused that way again, every 50 ms for up to a second.
- *Reconsider:* this is a fixed retry cadence, which sits uneasily with "no magic delays" (README, principles). Waiting for the swap's evidence would be better if one exists.
- **Resolved** in `a7ee8dc` (review 21's first step): a command refused while Chromium swaps documents is sent again at once, at most three times, with no spacing: the refusal covers only the swap's moment (review 21, P7).
- **Revised** in `fa0a3a9` (review 21's third step): three resends weren't enough once, under a full run, for a back/forward-cache restore, which refuses longer than a commit. A refused command is now sent again each time its refusal comes back, with no delay of the library's, up to 10,000 times; under synthetic load the history test then passed 40 of 40.

**Q7. Firefox's realms come before their commit, sometimes after a transient one** (Browser). The new document's realm is created before `navigationCommitted`, sometimes after a realm with origin `null` that is destroyed at once. Chromium and WebKit create it after the commit.
- *Seen:* probe 1.
- *We:* hold a main-world realm created for a context whose document already had one until the next commit, and never report one destroyed before it.
- *Reconsider:* nothing yet; it is the spec's ordering question.
- **Kept** in review 21: the *We* line is the decision.

**Q8. Initial `about:blank` reuse differs** (Browser). Chromium and Firefox keep the initial `about:blank` realm into a same-origin first document; WebKit creates a new one.
- *Seen:* probe 2.
- *We:* model realms as siblings of documents (`RealmDocumentAdded`).
- *Reconsider:* nothing; recorded for completeness.
- **Kept** in review 21: the *We* line is the decision.

**Q9. Orphaned frames are reported differently** (Browser). Chromium sends no `frameDetached` for the children of a document a cross-document navigation replaced; Firefox and WebKit report them.
- *Seen:* probe 8.
- *We:* end a replaced document's children ourselves on Chromium.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q10. A 204 or a download reports its failure late, or as a fetch error, on Firefox** (Browser). For a 204, Firefox sends `navigationFailed` only when the next navigation starts, after an error reply to `navigate`.
- *Seen:* probe 15.
- *We:* end it as `NoContent` from the response and the reply.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q11. `document.open()` shows differently on every backend** (Browser). Chromium: `documentOpened` and lifecycle events again under the same loader. Firefox: `historyUpdated`, then `domContentLoaded` and `load` again. WebKit: only the load events again.
- *Seen:* probe 17.
- *We:* report a new generation of the same document.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q12. WebKit fires `load` before `DOMContentLoaded`** (Browser). `loadEventFired` usually comes before `domContentEventFired` for the same frame, and a parent's can come before its children's load.
- *Seen:* WebKit probe findings.
- *We:* fold readiness as each arrives; a `waitUntil: "domContentLoaded"` accepts `complete`.
- *Reconsider:* whether readiness should ever go backwards when they arrive out of order.
- **Kept** in review 21: readiness already never goes backwards: when WebKit reports `load` first, the adapter reports `interactive` and then `complete`, and ignores the `DOMContentLoaded` after.

**Q13. A cross-site navigation in WebKit swaps targets and frame ids** (Browser). It loads in a provisional target whose main frame has a new id; the old target's `didCheckNavigationPolicy` says `cancel: true` though the navigation goes on.
- *Seen:* WebKit probe findings.
- *We:* map the new frame id onto the page's main frame and follow the loader id across.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q14. Firefox's `reload` refuses `ignoreCache` whatever its value** (Browser). "Argument "ignoreCache" is not supported yet", as `unsupported operation`.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send it only to bypass the cache, which then fails as `Unsupported`.
- *Reconsider:* when Firefox supports it.

**Q15. Firefox renders JSON in a viewer with a `resource://devtools` realm** (Browser).
- *Seen:* BiDi probe findings.
- *We:* nothing special beyond Q4's case.
- *Reconsider:* whether the viewer's realm should be hidden from callers.
- **Resolved** in `a7ee8dc` (review 21's first step): `LaunchProfile.automation` turns the JSON viewer off, so a JSON response's document is the JSON as served, as in the other browsers (review 21, P3). `stock` and an attached Firefox keep it, and so does the adapter's handling of it.

**Q69. Firefox's traversal back from its JSON viewer went unreported under full load** (Browser). In one full integration run after review 16, the conformance test's `traverse(-1)` from `/json` removed the viewer's realm and fetched the page again, but no new realm and no end came within 10 s. Three runs of that test alone passed.
- *Seen:* review 16's revision, one full run of three; review 17's revision, two full runs of four; review 20's second step, one full run, which three runs of the test alone passed; review 20's third step, one of two full runs.
- *We:* nothing yet; the restore inference (Q4) waits for a realm that didn't come.
- *Reconsider:* with Q4 and Q5, an end Firefox reports for every traversal.
- **Resolved** in `a7ee8dc` (review 21's first step): traced under synthetic load, where 12 of 32 runs failed: Firefox sends no `navigationStarted` for a traversal that leaves its JSON viewer before the viewer has loaded, fetches the page again, and reports no new document. With the viewer off in `automation` (Q15), 48 of 48 passed. The viewer's own case goes into Q4's report.
- **Reported** in review 21's fifth step: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q149. A Chromium page closed under full load went unreported** (Browser). In one full integration run after review 19, the conformance test's `closePage` was answered, and no `NavigableRemoved` came within 10 s; three runs of that test alone passed.
- *Seen:* review 19's revision, once.
- *We:* nothing yet.
- *Reconsider:* whether `Target.targetDestroyed` or `detachedFromTarget` was lost, or arrived for a target the adapter no longer tracked, if it happens again.
- **Resolved** in `a7ee8dc` (review 21's first step): traced under synthetic load, where 4 of 48 runs failed: Chromium answers a `Target.closeTarget` sent as a navigation commits, and drops it; the page stays attached and alive, and a second close closes it. Raw CDP showed the same, 10 dropped closes in 120. The adapter first sends a page command, `Page.getNavigationHistory`, which Chromium refuses during the swap and accepts once it is over, and which is answered with a dialog open; with it, raw CDP dropped no close in 120, and 100 of 100 stress runs passed.
- **Reported** in review 21's fifth step: drafted in `upstream/chromium-close-dropped.md`, not sent.

## Browsers: dialogs, popups, focus and input

**Q16. A dialog blocks evaluation on Chromium and WebKit, not on Firefox** (Browser). Every evaluation in every world waits while a dialog is open on Chromium and WebKit; Firefox answers.
- *Seen:* review 13, P2.
- *We:* fail every operation on a page whose dialog nothing will decide at once with `PromptBlocking`, on every backend, Firefox included, for one rule.
- *Reconsider:* whether Firefox's reads should be let through after all.
- **Kept** in review 21: the *We* line is the decision.

**Q17. The click that opens a dialog doesn't return until it is decided** (Browser). On all three backends.
- *Seen:* review 13, P3.
- *We:* register handlers before the action; a click whose dialog nothing will decide fails with `PromptBlocking` and `dispatch: MayHaveBeenSent`.
- *Reconsider:* nothing; it shapes the API (handlers first).
- **Kept** in review 21: the *We* line is the decision.

**Q18. A popup's URL arrives after the popup** (Browser). Chromium reports `""` at `PageAdded`, Firefox and WebKit `about:blank`; the URL it was opened for arrives with its first navigation.
- *Seen:* review 13, P1.
- *We:* report the popup at once and match `url` filters against its first navigation, offering the entry again then.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q19. The opener goes to the background, and headless Chromium stops rendering it** (Browser). After `window.open`, Chromium and Firefox report the opener `hidden`; headless Chromium renders no frames for it, so actions on it time out with `NoRenderingOpportunity` until `page.activate`.
- *Seen:* review 13.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`.
- *Reconsider:* whether an explicit option to keep openers rendering is worth having.
- **Resolved** in `38ce8ff` (review 21's second step): no Chromium switch keeps an opener rendering once its popup opens as a tab over it, but focus emulation does (review 21, P1). The `NoRenderingOpportunity` hint names `newContext({ focus: "emulated" })` beside `page.activate`, and the CLI's session context emulates focus on Chromium and WebKit. The library's default stays `focus: "system"` (review 21, Considered and not adopted).

**Q20. A paused popup blocks its opener's `window.open`** (Browser). On Chromium, `window.open` doesn't return until the paused popup resumes, and popups can be paused only browser-wide.
- *Seen:* probe 22.
- *We:* pause browser-wide only when the browser was launched.
- *Reconsider:* attached browsers' popups, when attaching is built.
- **Kept** in review 21: the *We* line is the decision.

**Q21. User activation from evaluation lasts differently** (Browser). Firefox's `userActivation: true` grants activation only during the call; Chromium's `userGesture` and WebKit's `emulateUserGesture` leave it active after.
- *Seen:* probe 20.
- *We:* nothing; operations that need activation request it per call.
- *Reconsider:* whether to normalize.
- **Kept** in review 21: the *We* line is the decision.

**Q22. WebKit aborts on two commands instead of failing** (Browser). `Playwright.navigate` with a frame id the page doesn't have (exit 134) and `Dialog.handleJavaScriptDialog` with no dialog open (exit 139).
- *Seen:* WebKit probe findings.
- *We:* never send either outside what the model has seen; a frame that goes between the check and the command is a race we can't close.
- *Reconsider:* when the build is rolled.
- **Reported** in review 21's fifth step: drafted in `upstream/playwright-webkit-crashes.md`, not sent.

**Q23. A raw WebKit dialog answer left the page blocked once** (Browser). In a scratch probe, the same answer the adapter sends left the dialog open; the difference was never traced.
- *Seen:* WebKit probe findings.
- *We:* nothing; the adapter's answers work.
- *Reconsider:* trace it before relying on raw-protocol access to WebKit.
- **Kept** in review 21: the *We* line is the decision.

**Q24. A second client can crash a page another client created** (Browser). On Chromium, a second CDP client attached to a page the first had created and crashed it.
- *Seen:* probe 25.
- *We:* nothing yet.
- *Reconsider:* when attaching to browsers others drive is built.
- **Kept** in review 21: probe 25's crash was the second client's own `Page.crash`, sent to show the first client sees it: clients share pages, and nothing failed.

**Q70. A page in the background of its context renders nothing on headless Chromium** (Browser). Not only a popup's opener (Q19): a page created after another in the same context puts the first in the background, `hidden`, with no frames, though keys and clicks still reach it. Pages in different contexts, and every WebKit page, keep rendering. The `concurrent` profile's switches don't change it.
- *Seen:* review 16, P4, P10 and P11.
- *We:* create each page the library opens as a window of its own (`Target.createTarget{newWindow}`), which keeps it visible and rendering. A popup still opens where its opener's script puts it (Q19).
- *Reconsider:* whether a window per page changes anything a page observes (its window's position and size), and whether headless Chromium will render background tabs.
- **Kept** in review 21: review 21's P1 found what makes a background tab render, `focus: "emulated"`, and review 21's second step names it.

**Q71. A page in the background of a Firefox context renders about once a second** (Browser). It is `hidden`, with 3 animation frames in 4 s, two seconds after the other page opened; P4 had measured one frame in 150 ms, early. Two frames never fall in one second-long round, so the stable check never passes, and an action there times out, alternating `NotStable` and `NoRenderingOpportunity`. `layout.throttled_frame_rate` in the launch prefs didn't change it, and creating Firefox pages as windows broke navigation in review 16's probe.
- *Seen:* review 16's revision.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`, after which the action works.
- *Reconsider:* Firefox pages as windows, probed again; or a stable check that spans rounds, which would make such actions slow rather than stuck.
- **Resolved** in `38ce8ff` (review 21's second step): Firefox's pages the library creates open as windows, and `automation` adds `browser.link.open_newwindow: 2`, so a popup, or a link that opens a page, opens as a window too. Every page then keeps rendering behind another (review 21, P2), and the slice tests act on a page behind another, and on a popup's opener, without `activate`. Review 16's probe saw navigation break in windows: that was Q178.

**Q72. WebKit's mouse events ignore modifiers** (Browser). Neither the event's modifier flags nor Shift held as a key reach a click's `shiftKey`.
- *Seen:* review 16, P1.
- *We:* `input.pointerModifiers` is `unsupported` on WebKit. A pointer action or `mouse.click` with modifiers, or while one is held, fails with `Unsupported` before anything is sent.
- *Reconsider:* when the build is rolled.

**Q73. WebDriver's pointer actions carry no modifier flags** (Browser). Firefox takes modifiers only from keys held in the same actions; Shift held as a key reaches `shiftKey`.
- *Seen:* review 16, P1.
- *We:* hold modifiers as keys on every backend, pressed before the gesture and released after, and set the flags too.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q74. WebDriver's Enter is the numpad's** (Browser). `\uE007` (Enter) arrives in Firefox with `code: "NumpadEnter"`; `\uE006` (Return) is the main Enter.
- *Seen:* review 16, P2.
- *We:* the BiDi adapter sends Return for `Enter`.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q75. BiDi has no command to insert text** (Browser). Text is typed as key actions, so `insertText`, and `fill`, fire key events for each character on Firefox, and on no other backend.
- *Seen:* review 16, P3.
- *We:* `input.insertText` is `partial` on BiDi, saying so.
- *Reconsider:* if BiDi adds one.
- **Kept** in review 21: the spec has no command to insert text.

**Q76. Only Chromium can finish an HTML drag, and only when asked to** (Browser). Chromium starts an HTML drag from input only with `Input.setInterceptDrags` on, and only when each move names the button held (`button`, not just `buttons`); it then hands the drag to the client to finish with drag events. Firefox starts one from WebDriver actions and never drops it. WebKit's protocol has no drag commands.
- *Seen:* review 16, P5 and P9; the move's button, review 16's revision.
- *We:* the CDP adapter turns interception on with the first move that holds a button, and finishes the drags it intercepts. `input.dragAndDrop` is unsupported elsewhere, so `dragTo` from a draggable element fails there with `Unsupported` before anything is sent. Drags by pointer events work everywhere.
- *Reconsider:* Firefox, if it starts dropping; and whether interception, once on, should stay on for the page's life.
- **Kept** in review 21: Firefox starts drags it never drops; Strider refuses `dragTo` up front there.

**Q77. WebKit fires no `click` after a tap** (Browser). A touch start and end reach the page, with touch pointer events, on all three; Chromium and Firefox follow with compatibility mouse events and `click`, and WebKit doesn't.
- *Seen:* review 16, P6.
- *We:* nothing; `tap` sends the touch, and the page decides.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q78. Firefox on the desktop has no touch event interface, yet dispatches touch events** (Browser). `TouchEvent` is undefined and `'ontouchstart' in window` is false, so an `ontouchstart` attribute never runs, but `touchstart` and `touchend` reach `addEventListener` listeners.
- *Seen:* review 16's revision; P6 had listened with `addEventListener`.
- *We:* nothing; a page that detects touch support finds none on Firefox.
- *Reconsider:* whether `tap` should need touch emulation where a page checks for support.
- **Kept** in review 21: the *We* line is the decision.

**Q79. What the utility world dispatches is untrusted** (Browser, by design). `selectOption`, and `fill` on an input whose value isn't typed, set the value and dispatch `input` and `change` from the utility world, so the page sees `isTrusted: false`.
- *Seen:* review 16, P7.
- *We:* accept it: a select's popup and a date picker aren't drivable headless, and pages rarely check `isTrusted` on `change`.
- *Reconsider:* choosing an option with keys where a backend can.
- **Kept** in review 21: the *We* line is the decision.

**Q150. A page prompts before unloading only once the user has interacted with it** (Browser). `close({ runBeforeUnload: true })` on a page whose `beforeunload` listener asks to stay closes at once, with no prompt, unless something was clicked in it first; after a click, the prompt opens and a handler decides it. The same on all three browsers.
- *Seen:* review 20's build, a probe of an untouched and a clicked page on each backend.
- *We:* `close`'s docs say so, and the tests click before closing.
- *Reconsider:* nothing; it is the browsers' rule against abusive prompts.
- **Kept** in review 21: the *We* line is the decision.

## Browsers: downloads and file choosers

**Q25. Each browser does something different with a download nobody configured** (Browser). Chromium cancels it; Firefox and WebKit save it into `$HOME/Downloads` (WebKit without reporting the path).
- *Seen:* review 14, P1.
- *We:* give every context the library creates a temporary download directory, removed after it. The default context keeps the browser's behaviour.
- *Reconsider:* a `downloads: "deny"` option, and what attached browsers' contexts should do.
- **Kept** in review 21: the *We* line is the decision.
- **Resolved** in `6ff530c` (review 22's first step): `UserContext.Options.downloads` is `"temporary"` (as before), `"deny"`, or `{ directory }` the caller owns; the CLI's sessions download into their own `downloads/`.

**Q26. Every browser writes a download into a partial file of its own naming** (Browser). `<guid>.crdownload` (Chromium), `<name>.<random>.bin.part` beside an empty `<name>` (Firefox), `<uuid>.wkdownload` beside an empty `<uuid>` (WebKit), renamed when done.
- *Seen:* review 14, P2.
- *We:* read a download's bytes only once it completes; `Download.stream` can't deliver them as they arrive.
- *Reconsider:* streaming from the partial file per backend.
- **Kept** in review 21: the *We* line is the decision.

**Q27. Only Chromium reports a download's progress, and only CDP and WebKit can cancel one** (Browser).
- *Seen:* review 14, P2 and P4.
- *We:* capabilities `downloads.progress` and `downloads.cancel`; `cancel` fails with `Unsupported` on BiDi.
- *Reconsider:* when BiDi adds them.
- **Kept** in review 21: the *We* line is the decision.

**Q28. A download in progress when its context goes is reported three ways** (Browser). Chromium: canceled. Firefox: nothing at all. WebKit: *completed*, with an empty file.
- *Seen:* review 14, P3.
- *We:* the context's end makes it `Canceled`, and the fold ignores what the backend says after.
- *Reconsider:* nothing; WebKit's report is wrong.
- **Kept** in review 21: the *We* line is the decision.

**Q29. Firefox leaves a canceled file chooser open** (Browser). With `unhandledPromptBehavior.file: "ignore"`, a chooser nothing decides stays open, and the page's later clicks open nothing.
- *Seen:* review 14, P5.
- *We:* set `file: "dismiss"`, so every chooser is dismissed as it opens; the input gets a `cancel` event before any decision, and files set after it still arrive with `input` and `change` (P6). `fileChooser` is `partial` on BiDi.
- *Reconsider:* whether BiDi gains a way to answer a chooser without the page seeing `cancel`.
- **Kept** in review 21: the *We* line is the decision.

**Q30. A file input clicked with no interception does three different things** (Browser). Headless Chromium fires `cancel` at once; WebKit does nothing; Firefox reports it anyway.
- *Seen:* review 14, P7.
- *We:* arm interception on every page of a context the library creates.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q31. `input.showPicker()` opens a chooser on Chromium, not on WebKit** (Browser). Firefox wasn't probed (Q29 left its picker open).
- *Seen:* review 14, P8.
- *We:* nothing.
- *Reconsider:* probe Firefox now that it dismisses.
- **Kept** in review 21: Firefox opens a chooser for `showPicker()` and reports it with `input.fileDialogOpened` (review 21, P4); only WebKit doesn't.

**Q32. WebKit's `downloadCreated` names a frame id that isn't the page's** (Browser).
- *Seen:* WebKit probe 15.
- *We:* attribute the download to the page.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

## Browsers: console, exceptions and workers

**Q33. Console text is formatted differently** (Browser). Firefox applies format specifiers (`%s`, `%d`), Chromium and WebKit don't; objects render as their class name (`Object`, Firefox's `Object(2)`); `console.count()` is `debug` on WebKit and `log` elsewhere; `console.timeEnd` of an unknown timer is a warning on Chromium and WebKit and a log on Firefox, each worded differently.
- *Seen:* review 14, P9.
- *We:* report the browser's text and level as they are.
- *Reconsider:* formatting from the arguments ourselves, which needs their handles.
- **Resolved** in `c790129` (review 21's fourth step): the library applies the Console Standard's formatter (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, `%c`) to the arguments CDP and WebKit report (`internal/consoleFormat.ts`), as Firefox applies its own. Two differences stay. Firefox writes `%f` as printf does (`1.250000`, not `parseFloat`'s `1.25`) and sends its formatted text as the call's only argument, so nothing can reformat it (reported: `upstream/firefox-console-args-formatted.md`). And objects read as each browser describes them: review 21 meant to render them one way, but WebDriver BiDi serializes an `Error` without its message, so one rendering would have dropped Chromium's error messages.
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-console-args-formatted.md`, not sent.

**Q34. Console locations have different bases and columns** (Browser). Chromium's and Firefox's lines and columns are 0-based, WebKit's 1-based; the column points at the call's property on Chromium and its parenthesis on WebKit.
- *Seen:* review 14, P9.
- *We:* convert to 1-based on CDP and BiDi; columns stay where each engine puts them.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q35. A thrown value that isn't an Error is reported badly** (Browser). For `throw "a string"`, Chromium's exception has no description (the text is `Uncaught`), or no exception object at all when a timer an evaluation set throws (the text is `Uncaught a string`); Firefox's text is `uncaught exception: a string`.
- *Seen:* review 14, P10, and its revision's conformance test.
- *We:* report an `Error` whose message is the value, on every backend.
- *Reconsider:* keeping the value's type (string, number) somewhere.
- **Kept** in review 21: the *We* line is the decision.

**Q36. Firefox can't tell an unhandled rejection from a throw** (Browser). Its log entry has no `Uncaught (in promise)` marker and no stack for a rejection.
- *Seen:* review 14, P10.
- *We:* `kind: "unknown"` on Firefox; `exceptions.kind` is `partial`.
- *Reconsider:* when BiDi distinguishes them.
- **Kept** in review 21: the *We* line is the decision.

**Q37. Workers are reported unevenly** (Browser). Chromium reports dedicated, shared and service workers with their context, and evaluates in all. Firefox reports all three, names a dedicated worker's owner realm but not its page, has no context for shared and service workers, can't evaluate in any ("Realm with id … not found"), attributes a dedicated worker's console to its page's realm, and reports no console from shared or service workers. WebKit reports dedicated workers only.
- *Seen:* review 14, P11; BiDi probe findings.
- *We:* name a dedicated worker's page from its owner on BiDi; capabilities `workers.shared`, `workers.service`, `workers.evaluate`; `console` `partial` on BiDi.
- *Reconsider:* when Firefox can evaluate in workers or name their context.
- **Kept** in review 21: the *We* line is the decision.

**Q38. A worker's requests are attributed to its page on Firefox and WebKit** (Browser). Chromium names the worker as the initiator; Firefox and WebKit name the page's document. WebKit also types a worker's script load as `xhr`, and sends it on the page's target before `workerCreated`.
- *Seen:* review 14, P11; WebKit probe findings.
- *We:* report what each says.
- *Reconsider:* correlating by URL, which would be a guess.
- **Kept** in review 21: the *We* line is the decision.

**Q121. Chromium's exception text ends with the stack** (Browser). An evaluation that throws `TypeError("boom")` is described as `TypeError: boom\n    at <anonymous>:2:12`; Firefox and WebKit give the message alone.
- *Seen:* review 18's revision.
- *We:* `EvaluationThrown`'s message drops the trailing `at` lines, which `stack` has.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

## Browsers: network

**Q39. A redirect hop's body is asked for with an id the adapters never minted** (Ours, found in the adapters). Asking any adapter for a 302 hop's body failed as `Foreign`.
- *Seen:* review 14, P13.
- *We:* `BodyUnavailable{redirect}` without asking the browser.
- *Reconsider:* fixing the adapters' hop tables so the error, if asked, is honest.
- **Resolved** in `a7ee8dc` (review 21's first step): the adapters keep a redirect's earlier hop ids, so a body read for one answers `Unsupported{body.redirect}`, and the conformance suite asks.

**Q40. An event stream's body never finishes, so reading it waits forever** (Browser). On all three.
- *Seen:* review 14, P14.
- *We:* bound the wait by the deadline (`next`) or `Deadline.DefaultBudget` per body (`stream`), then `BodyUnavailable{streaming}`.
- *Reconsider:* recognizing streaming responses from their headers instead of waiting.
- **Resolved** in `a7ee8dc` (review 21's first step): a response whose content type is `text/event-stream` is `BodyUnavailable{streaming}` as soon as its body is asked for.

**Q41. EventSource and WebSocket support differ** (Browser). Only Chromium reports an EventSource as a connection with its messages (and only from its first message); WebKit and Firefox report only its request (`eventSource`, or Firefox's `other`). Firefox reports a WebSocket only as its handshake, an `http:` request answered 101, with no frames and no close.
- *Seen:* review 14, P14 and P15.
- *We:* capabilities `networkConnections` and `networkConnections.eventSource`; subscribing where they're missing fails with `Unsupported`.
- *Reconsider:* synthesizing Firefox's connections from the handshake if BiDi adds a close event.
- **Kept** in review 21: the *We* line is the decision.

**Q42. WebKit reports a WebSocket's close handshake as binary frames** (Browser). Two frames, opcode 8, reported as messages.
- *Seen:* review 14, P15.
- *We:* drop control frames (opcode 8 and above) on CDP and WebKit.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q43. Who served a response is reported differently** (Browser). Chromium marks a cache hit with `requestServedFromCache` and `fromDiskCache: false`; Firefox sets `fromCache` for service-worker responses too; WebKit says `source` exactly, and has an `unknown`. A script reused from the memory cache within a document makes no request on Chromium and WebKit; Firefox reports it.
- *Seen:* review 09; probes 7.
- *We:* `servedBy` with `cacheOrServiceWorker` for Firefox's case and `unknown` for WebKit's.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q44. WebKit's intercepts don't see a page a service worker controls** (Browser). Even the requests the worker passes to the network.
- *Seen:* review 09; probe 7.
- *We:* `interception.request` and `.response` are `partial` on WebKit.
- *Reconsider:* when routes are built.
- **Kept** in review 21: the *We* line is the decision.

**Q45. BiDi can't scope an intercept to a user context** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* intercept browser-wide and filter in the adapter.
- *Reconsider:* when BiDi adds the scope.
- **Kept** in review 21: WebDriver BiDi's `network.addIntercept` still has no user contexts to scope it to.

**Q46. Chromium's interception tests flake under full load** (Ours, a test flake). Occasionally a request isn't paused, or a fulfilled one reads as served by the network, when the whole integration suite runs at once; seen before and after review 14.
- *Seen:* review 14's revision runs; traced in review 17's revision (Q103).
- *We:* nothing yet; listed in PROTOCOL.md.
- *Reconsider:* find whether an intercept declaration is acknowledged before it is in force (CONCEPTS.md §7, Installation), when routes are built.
- **Resolved** in `e7821c1` (review 17's revision): the declaration was acknowledged before it was in force, apparently because `Fetch` enabled with no patterns gave up its interceptor. Q103 says what we do now.

**Q89. Only Chromium shows a route the CORS preflight** (Browser). A cross-origin `PUT` with a custom header pauses first as an `OPTIONS` request on Chromium; Firefox and WebKit pause only the `PUT`. A fulfilled cross-origin response needs CORS headers on all three.
- *Seen:* review 17, P9.
- *We:* show what Chromium shows: a route matching cross-origin requests on Chromium answers their preflights, or lets them continue to the server.
- *Reconsider:* answering a preflight for a route that fulfills its request, as Playwright does, which would hide a request the page made.
- **Kept** in review 21: the *We* line is the decision.

**Q90. WebKit pauses a redirect's first hop only, and won't follow a redirect a route fulfills** (Browser). A fetch fulfilled with `302` and `Location` gets the `302` itself, while Chromium and Firefox follow it and pause the target as the next hop.
- *Seen:* review 17, P2 and P7.
- *We:* `interception.redirects` is `partial` on WebKit.
- *Reconsider:* when the build is rolled.
- **Kept** in review 21: the *We* line is the decision.

**Q91. Only CDP fails a request with the reason asked for** (Browser). Firefox reports `NS_ERROR_ABORT` for every reason, and WebKit "Blocked by Web Inspector".
- *Seen:* review 17, P4.
- *We:* `Route.abort()` is `failed` everywhere; another reason is `interception.abortReason`, CDP's alone.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q92. Firefox aborts a request continued with a new URL, and keeps the old length with a new body** (Browser). The body arrives broken unless its `Content-Length` is sent too.
- *Seen:* review 17, P3, through the adapter and raw BiDi.
- *We:* a new URL is `Unsupported` (`interception.continueUrl`); the BiDi adapter sends a new body's length.
- *Reconsider:* when Firefox implements `url`.
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-continue-request.md`, not sent.

**Q93. Firefox can't fulfill at the response phase, and leaves a request it refused paused** (Browser). `network.provideResponse` there answers `unsupported operation`; a continue with new headers replaces the response's.
- *Seen:* review 17, P5.
- *We:* refuse it up front (`interception.responseFulfill`), so the default continues the request.
- *Reconsider:* a response-phase decision that changes headers only, which Firefox and CDP can do.
- **Kept** in review 21: a response-phase decision that changes headers only is among the declared pieces still unbuilt.
- **Resolved** in `f223b83` (review 22's second step): `Route.continueWith({ status, headers })` at the response phase sends the response on with its status or headers replaced, on CDP and BiDi (`interception.responseHeaders`); WebKit can't, since it can't read the paused response. Fulfilling there stays CDP's and WebKit's.

**Q94. Only CDP can read a response paused at the response phase** (Browser). WebDriver BiDi has no body as a response starts, and Playwright's WebKit no command for it.
- *Seen:* review 17, P5.
- *We:* `interception.responseBody` is CDP's alone; patching a response's body works on Chromium only.
- *Reconsider:* when either protocol adds one.
- **Kept** in review 21: the *We* line is the decision.

**Q95. Firefox's default answer to a challenge waits forever, headless** (Browser). `continueWithAuth{action: "default"}` shows its prompt, which nothing answers.
- *Seen:* review 17, P6.
- *We:* the default at a challenge is the challenge's response (`CancelAuth`), never the browser's prompt.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q96. Chromium asks about a challenge only for a request intercepted as it starts, and lowercases its scheme** (Browser). With a response-stage pattern it pauses the `401` as a response and refuses credentials for it.
- *Seen:* review 17, P6, and its revision, where the registry had kept auth patterns as response-stage ones.
- *We:* auth patterns pause at the request stage, where a request nothing else wants continues at once; schemes are lowercased on every backend.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q97. Chromium refuses a `Content-Length` header in a continued request** (Browser). `Fetch.continueRequest` answers "Unsafe header: content-length", and computes the length itself.
- *Seen:* review 17's revision.
- *We:* routes never send it; the BiDi adapter sends it, since Firefox doesn't compute it (Q92).
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q98. A paused request's resource type differs from its events'** (Browser). Chromium's `Fetch` calls a `fetch()` an `XHR`, where its `Network` events say `Fetch`; WebKit's pause carries no type.
- *Seen:* review 17, P11.
- *We:* a paused request takes the type its network events gave it, where they came first.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q158. Chromium leaves `Cookie` and `Set-Cookie` out of its network events** (Browser). `requestWillBeSent` and `responseReceived` carry the headers a page may see; the ones the network sent and received, cookies included, come in `requestWillBeSentExtraInfo` and `responseReceivedExtraInfo`, before or after them, by request id.
- *Seen:* review 20's build: a HAR of a page that set a cookie had none on Chromium.
- *We:* the CDP adapter reports them as a hop's own headers (`HopHeaders`), which recordings prefer; `NetworkRequest` and `NetworkResponse` keep the headers the main events give. An `ExtraInfo` that comes before its request waits for it; one for a redirect's next hop that comes before that hop starts is given to the hop before.
- *Reconsider:* holding a response until its `ExtraInfo` arrives, as Playwright does, so every event has the headers sent.
- **Resolved** in `fa0a3a9` (review 21's third step): the CDP adapter holds a response whose `responseReceived` says `hasExtraInfo` until its `ExtraInfo` arrives, with the hop's end if it comes first, and reports it with the headers received, so `NetworkResponse.headers` has `Set-Cookie` on every backend (review 21, P6). Only a response from the network waits: one from a cache announced by `requestServedFromCache` said `hasExtraInfo` and got none. A request that fails, a navigation that ends or commits, and a request retired from the table (Q177) release what was held. Requests keep the headers their main event gives: nothing says an `ExtraInfo` will follow one.
- **Resolved** in `f223b83` (review 22's second step): `NetworkRequest.headersSent(target, request)` waits for a request's headers as sent, cookies included, which on Chromium come in the `ExtraInfo` a response's `hasExtraInfo` promises, or are the request event's when it promises none; elsewhere they are known with the response (Q181) or at once. A request event's `headers` stay what it gave.

**Q159. Chromium never ends a favicon request cut off by the next navigation** (Browser). The page's favicon request, started as one document loaded and cut off by a `goto`, gets no response, no `loadingFinished` and no `loadingFailed`.
- *Seen:* review 20's build, in a HAR on Chromium.
- *We:* a HAR marks it `_incomplete`; `inFlightAtStop: "wait"` waits for it until the deadline.
- *Reconsider:* ending a request with its document, if a protocol event allows it.
- **Reported** in review 21's fifth step: drafted in `upstream/chromium-favicon-never-ends.md`, not sent.

**Q160. Chromium forgets a document's bodies once the page navigates on** (Browser). `Network.getResponseBody` for the document a page just left fails "No resource with given identifier found", or "Missing resource for given requestId".
- *Seen:* review 20's build, a HAR recording two navigations in a row.
- *We:* a HAR records that entry without its body.
- *Reconsider:* reading a document's body as its response finishes, before the next commit, if recordings need them.
- **Resolved** in `fa0a3a9` (review 21's third step): where a body collection is declared, as a recording or a body read declares one, the CDP adapter configures durable messages for the page (`Network.configureDurableMessages`, ten bodies' worth at the collection's limit each), which keep a document's body past the next navigation (review 21, P5). WebKit forgets it too, with nothing to keep it by (Q179).

**Q161. A page can read a response before the browser reports its hop finished** (Browser). A `fetch` resolved and its text shown in the page, and Chromium's `loadingFinished` for it hadn't arrived yet.
- *Seen:* review 20's build, a HAR exported right after the page showed what it fetched.
- *We:* an export waits for the bodies of the hops that ended, never for one in flight: that entry is `_incomplete`. A program that needs it waits with `NetworkResponse.next` and a body, which waits for the hop's end.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q166. WebKit says a response's protocol only as it ends** (Browser). `responseReceived` has the status text but no protocol; `loadingFinished.metrics.protocol` has it. CDP and Firefox say it with the response.
- *Seen:* review 20, P2.
- *We:* `NetworkResponse.httpVersion` is `None` on WebKit, and a HAR takes the protocol from the hop's end.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q179. WebKit forgets a document's body once the page navigates on** (Browser). As Chromium did (Q160): a HAR recording two `goto`s in a row has no body for the first document on WebKit, whose protocol has nothing like Chromium's durable messages.
- *Seen:* review 21's build, when the HAR test began asking for that body on every backend.
- *We:* the entry has no body.
- *Reconsider:* reading a document's body in the adapter as its load finishes, where a body collection is declared, before the next commit can clear it.
- **Resolved** in `f223b83` (review 22's second step): where a body collection covers the page, the WebKit adapter reads a document's body as its load finishes, and a recording's read gets that.

**Q181. WebKit leaves `Cookie` out of its request events, and a redirect's response has no request headers** (Browser). As Chromium does (Q158), `Network.requestWillBeSent` carries the headers the page set; the ones sent, cookies included, come as the response's `requestHeaders`, which a redirect's response has empty.
- *Seen:* review 22's build, when `NetworkRequest.headersSent` was asked for a cookie on every backend.
- *We:* the WebKit adapter reports a hop's headers sent with its response, from `requestHeaders`, or the request event's where those are empty; so a redirect's hop has no `Cookie` there.
- *Reconsider:* nothing on our side: the protocol reports them nowhere else.

**Q182. Chromium's request event leaves a file's bytes out, and keeps only a request's last body** (Browser). `requestWillBeSent` says `hasPostData` for a multipart body holding a `Blob` but carries no `postDataEntries`; `Network.getRequestPostData` reads it, but only for the request's latest hop: after a `302` turned a `POST` into a `GET`, it answers `No post data available` for the request.
- *Seen:* review 22's probe of request bodies (a form, 200 KB, a `307`, a `302` and a file).
- *We:* the CDP adapter keeps each hop's body as its event carried it, where a body collection covers the page and it fits the limit, and reads one the event didn't carry by the request's id, for the last hop only; an earlier hop's is `Unsupported` (`body.redirect`), and a recording leaves it out.
- *Reconsider:* nothing: the event carried every body the probe sent but the file's.

**Q183. Firefox's request data is a request's first body, even for a hop that sent none** (Browser). `network.getData({ dataType: "request" })` for a request whose `302` turned it into a `GET` gives the `POST`'s body.
- *Seen:* review 22's probe of request bodies.
- *We:* the BiDi adapter keeps each hop's `bodySize` from `beforeRequestSent`, and a hop that sent none has no body without asking.
- *Reconsider:* reporting it upstream, if the spec means a hop's data; it says a request's.

**Q184. WebKit leaves a file's bytes out of a request's body** (Browser). `Network.requestWillBeSent`'s `postData` for a multipart body holding a `Blob` has the part's headers and an empty body.
- *Seen:* review 22's build, when the HAR test sent a file on every backend.
- *We:* a recording keeps the body as WebKit gave it.
- *Reconsider:* nothing on our side: the protocol has no other report of a request's body.

## Browsers: emulation, permissions and declarations

**Q47. WebKit's init scripts run in the main world only** (Browser). `Page.setBootstrapScript` has no world.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* an init script for an isolated world is `Unsupported` there.
- *Reconsider:* when init scripts are built at L2.
- **Kept** in review 21: the *We* line is the decision.

**Q48. WebKit's locale reaches only new web processes, and a document caches its user agent** (Browser). `Playwright.setLanguages` doesn't reach a process already running; `navigator.userAgent`, once read, keeps its value until the next navigation.
- *Seen:* WebKit probe findings.
- *We:* a locale declared for pages that exist is `Unsupported`; a user-agent override reaches a document only at its next navigation.
- *Reconsider:* when emulation is built at L2.
- **Kept** in review 21: the *We* line is the decision.

**Q49. WebKit's viewport is a resize with nothing to clear** (Browser). `setDeviceMetricsOverride` resizes the view (0 by 0 empties it); WPE headless starts at 1024 by 768.
- *Seen:* WebKit probe findings.
- *We:* measure the size before the first resize and restore it.
- *Reconsider:* nothing yet.
- **Kept** in review 21: the *We* line is the decision.

**Q50. Firefox's permissions have no reset; WebKit's are per page** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi and WebKit.
- *We:* set the ones granted back to `prompt` on Firefox; reset clears every grant in the context on WebKit.
- *Reconsider:* when grants are built at L2.
- **Kept** in review 21: the *We* line is the decision.

**Q51. Firefox lacks several commands** (Browser). A navigation referrer, media-feature overrides and focus emulation answer `unknown command`.
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* `Unsupported`, named by the method.
- *Reconsider:* on each roll.
- **Kept** in review 21: the *We* line is the decision.

**Q52. Chrome prints PDFs only headless, and WebKit not at all** (Browser).
- *Seen:* capability profiles.
- *We:* `pdf` is `unknown` for headful Chrome and `unsupported` on WebKit.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q99. Firefox 158 lacks most of `emulation`** (Browser). Media features, touch, scripting and focus emulation answer `unknown command`; a mobile viewport has no flag; an unavailable position is rejected; and every-origin grants and four of the common permission names (`clipboard-read`, `clipboard-write`, `background-sync`, `local-fonts`) aren't WebDriver BiDi's or Firefox's.
- *Seen:* review 17, P13 to P15.
- *We:* each is refused up front under the capability named for its field, and a name Firefox rejects fails with `InvalidInput`.
- *Reconsider:* when Firefox implements them.
- **Kept** in review 21: the *We* line is the decision.

**Q100. WebKit's emulation is uneven** (Browser). Its touch override changes nothing a page sees (no touch points, `ontouchstart` always there), it ignores an unavailable position, it sets locale and position per context, the locale only before the context's pages exist, a mobile viewport reloads at 979 CSS px and a device pixel ratio of 0.82, `navigator.userAgent` changes only at the next document, a page reports `hasFocus()` false and `prefers-reduced-motion: reduce` without emulation, and every permission name is accepted though its Permissions API can query few.
- *Seen:* review 17, P13 to P15.
- *We:* refuse touch and an unavailable position; say the rest in the capability entries' limitations.
- *Reconsider:* when the build is rolled.
- **Kept** in review 21: the *We* line is the decision.

**Q101. An init script runs before the document has an element, and on Firefox inside a function** (Browser). `document.documentElement` is null on every backend; WebDriver BiDi's preload scripts are functions, so a script's top-level `var` and function declarations aren't globals there, as they are on CDP and WebKit.
- *Seen:* review 17, P12, and its revision.
- *We:* document both; a BiDi preload keeps which scripts ran under a `Symbol.for` key a page could find.
- *Reconsider:* evaluating a Firefox script's source at global scope, if the page's CSP allows it.
- **Kept** in review 21: the *We* line is the decision.

## Browsers: frames, captures and storage

**Q110. Chromium renders nothing in a cross-site frame outside the viewport** (Browser). No animation frame runs in an out-of-process iframe that is scrolled out of view, so an action in it saw no rendering opportunity and timed out with `NoRenderingOpportunity`.
- *Seen:* review 18's revision: an iframe 2000 px down a page.
- *We:* an action scrolls each iframe on its way into view in its parent before its checks run (the engine's `element` with `scroll`), as the review planned for coordinates.
- *Reconsider:* whether Firefox and WebKit throttle the same way under other conditions, and whether an expectation in such a frame needs the scroll too (it waits on mutations, so it hasn't).
- **Kept** in review 21: the *We* line is the decision.

**Q111. Firefox doesn't deliver page coordinates into a cross-site frame** (Browser). A click at page coordinates over a cross-site iframe reaches nothing in it, not even `pointerdown`, though the page's hit test at the point is the iframe; the same click sent to the frame's own browsing context, in the frame's coordinates, lands. Chromium and WebKit deliver page coordinates into every frame.
- *Seen:* review 18, P1 and P2.
- *We:* input names the frame and its origin; the BiDi adapter subtracts the origin and sends to the frame's context, and keyboard input goes there too.
- *Reconsider:* a drag between documents on Firefox, which is sent to the source's frame.
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-cross-site-frame-input.md`, not sent.

**Q112. No backend reports a frame's name** (Browser). The frame tree each protocol gives has ids and URLs; a frame's `name` is its document's `window.name`, which only its document can read.
- *Seen:* review 18.
- *We:* `FrameTree.name` is `None`.
- *Reconsider:* reading `window.name` in each frame's document when `page.frames` is read, if anyone needs it.
- **Kept** in review 21: the *We* line is the decision.

**Q113. Firefox's full-page screenshot is narrower by the scrollbar** (Browser). A 400 px viewport captures 776 px wide at 2×, where Chromium and WebKit capture 800.
- *Seen:* review 18, P4.
- *We:* nothing; the test checks the height only.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q114. Firefox refuses a clip beyond the root element's box** (Browser). BiDi's `document` origin is the root element's box, which on a short page in quirks mode is its content's height, so a clip in the viewport's empty part fails ("The dimensions of requested screenshot are incorrect, got … height: 0"). Chromium and WebKit capture it.
- *Seen:* review 18's revision, a page without a doctype.
- *We:* nothing; the browser's error is the capture's `BackendFailure`.
- *Reconsider:* capturing with BiDi's `viewport` origin, translated by the scroll offset, when the clip is inside the viewport.
- **Resolved** in `a7ee8dc` (review 21's first step): a clip inside the viewport is captured with BiDi's `viewport` origin, offset by the scroll position; a slice test captures one below a short page in quirks mode.

**Q115. WebDriver BiDi captures device pixels only, with no background override, and prints no header or footer** (Browser). Nor a page's CSS size; Chromium's and WebKit's protocols have all of it (WebKit no PDF at all, Q52).
- *Seen:* review 18.
- *We:* `screenshot.cssScale`, `screenshot.omitBackground`, `pdf.headerFooter` and `pdf.preferCssPageSize` are `Unsupported` on Firefox.
- *Reconsider:* scaling a device-pixel capture down ourselves, which would need an image codec.
- **Kept** in review 21: the *We* line is the decision.

**Q116. WebKit reports an unspecified `SameSite` as `Lax`, and drops `Secure` cookies an `http://127.0.0.1` page set** (Browser). Chromium and Firefox leave an unspecified `SameSite` absent, and keep a `Secure` cookie a local page set.
- *Seen:* review 18, P5.
- *We:* `Cookie.sameSite` is an `Option`, `None` where the backend didn't say; WebKit's `Lax` comes through as said.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q117. Only Chromium reports a cookie's partition and priority** (Browser). CDP gives a partitioned (CHIPS) cookie's top-level site and whether a cross-site ancestor set it, and every cookie's priority; Firefox and WebKit report neither, and can't set a partitioned cookie through their protocols.
- *Seen:* review 18, P5.
- *We:* `priority` is an `Option`; a partitioned cookie is `Unsupported` there (`cookies.partitioned`), and a storage state with one fails a new context with `Incompatible`.
- *Reconsider:* when the protocols gain partitions.
- **Kept** in review 21: the *We* line is the decision.

**Q118. Firefox gives the isolated world the page's objects, behind Xrays** (Browser). IndexedDB records read in the isolated world aren't `instanceof` the sandbox's classes, a `Map` or `Set` can't be iterated through its Xray ("usingIterator().next is not a function"), and a typed array's data can't be read over one ("Accessing TypedArray data over Xrays is slow, and forbidden").
- *Seen:* review 18, P7, and its revision.
- *We:* `readOrigin` tells types by their tag, waives the Xrays of each record (`wrappedJSObject`), and copies bytes through the page's own `Uint8Array` (Q129).
- *Reconsider:* `Cu.cloneInto`, if the sandbox ever exposes it.
- **Kept** in review 21: the *We* line is the decision.

**Q119. Firefox fails a tab created in a user context while its only tab closes** (Browser). `browsingContext.create` right after `browsingContext.close` of the context's last tab failed with `NoSuchFrame` ("DiscardedBrowsingContextError: BrowsingContext does no longer exist").
- *Seen:* review 18's revision: the page that writes a storage state was released by its scope, whose close isn't awaited, and the caller's first page followed at once.
- *We:* the storage state's page is closed with `page.close()`, which waits for the close, before the context is returned.
- *Reconsider:* waiting for the close in a page's scope finalizer too (Q135).
- **Resolved** in `a7ee8dc` (review 21's first step): every page a scope releases is waited for (Q135), so a page created right after can't meet one still closing.

## Browsers: attaching

**Q136. Headless Chromium takes one URL on its command line** (Browser). A second fails the launch: "Multiple targets are not supported in headless mode". Firefox opens each as a tab.
- *Seen:* review 19, P3.
- *We:* nothing; the attach tests open Chromium's second tab through its HTTP endpoint (`PUT /json/new`).
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q137. Firefox allows one WebDriver BiDi session, and keeps it after its connection closes** (Browser). A second `session.new` fails "Maximum number of active sessions"; a session started over a socket outlives the socket, 13 s and counting, so every later client is refused until the browser restarts; `session.end` frees it at once; and a second socket to the session's own URL is refused.
- *Seen:* review 19, P5 and P6.
- *We:* the BiDi adapter ends a session it started when its scope closes, bounded by a second, and a connect refused for it says why (`ConnectionFailed{handshake}`).
- *Reconsider:* a program that dies without ending its session still locks Firefox (Q146).
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-session-outlives-socket.md`, not sent.

**Q138. Firefox reports the contexts that exist as `session.subscribe` is answered** (Browser). The BiDi adapter mapped Firefox's `"default"` user context after subscribing, so the tabs those events reported landed in a context of their own, never the default: a launched Firefox's first tab, and an attached Firefox's first tab.
- *Seen:* review 19, P8, through the facts; nothing at L1 read the default context's pages before.
- *We:* the default context is mapped, and reported, before the adapter subscribes; the conformance suite checks the first tab is in it.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q139. Chromium leaves a dialog open when its client disconnects, and tells the next client nothing about it** (Browser). A client attaching later gets the tab, but no `javascriptDialogOpening`, and no document for the tab while the dialog is open.
- *Seen:* review 19, P7.
- *We:* such a page is observed but stays opening: an operation on it times out, and the hint says a dialog may be open; `inspect` fails with `InitializationFailed`, saying the same.
- *Reconsider:* `Page.handleJavaScriptDialog` blindly on attach, which would decide the user's dialog.
- **Kept** in review 21: the *We* line is the decision.

**Q140. A WebDriver BiDi session's prompt settings are the whole browser's** (Browser). `unhandledPromptBehavior` can't be set per user context, so the `file: "dismiss"` a launched Firefox gets (Q29) would cancel the user's own file choosers on an attached one.
- *Seen:* review 19.
- *We:* an attached session leaves file choosers to the browser, and its `fileChooser` capability says so.
- *Reconsider:* when BiDi scopes prompt handling to contexts.
- **Kept** in review 21: the *We* line is the decision.

## Browsers: protocols and transports

**Q53. Firefox deviates from the BiDi spec in two events** (Browser). `contextCreated` has no `hasPlannedNavigation`, which the spec requires, and `navigationStarted` has no `url` for the navigation that `close({ promptUnload: true })` starts.
- *Seen:* the two corrections in `packages/tools/codegen/protocols/bidi/patches/`, with their recorded evidence.
- *We:* correct the protocol model; the audit lists a correction once the spec absorbs it.
- *Reconsider:* on each roll (`pnpm codegen:audit`).
- **Kept** in review 21: the *We* line is the decision.

**Q54. Chromium still sends deprecated events nothing subscribes to** (Browser). `Page.frameScheduledNavigation`, `frameClearedScheduledNavigation`, `downloadWillBegin` and `downloadProgress`.
- *Seen:* the drift test's first recording.
- *We:* the coverage report excludes them by policy.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q55. Huge messages break transports in different places** (Browser and platform). Node's built-in WebSocket closes at 128 MiB, `ws` at 100 MiB; Chrome escapes non-ASCII as `\uXXXX`, so a string can exceed V8's longest string, which used to hang the reader.
- *Seen:* PROTOCOL.md, Transports.
- *We:* lose the connection with a description; launched browsers use the pipe; remote endpoints are limited to 128 MiB until Effect's constructor passes `ws` options through.
- *Reconsider:* a `ws` constructor of our own, or upstream option passthrough.
- **Reported** in review 21's fifth step: drafted in `upstream/effect-websocket-max-payload.md`, not sent.

**Q56. WebKit carries a command in a wrapper that takes a negated id** (Browser and ours). Commands to a target or worker go inside `Target.sendMessageToTarget` or `Worker.sendMessageToWorker`; we give the wrapper the negated id of the command it carries.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* ignore the wrapper's success and turn its failure into the carried command's.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q57. WebKit needs `getResourceTree` before `Runtime.enable`** (Browser). Otherwise its snapshot doesn't precede the contexts `Runtime.enable` replays. Execution context ids on CDP restart after a process swap, while `uniqueId` doesn't.
- *Seen:* WebKit and CDP probe findings.
- *We:* order the gate accordingly; key CDP realms by `uniqueId`.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q102. WebKit reports a page's existing user world for a new document after it commits** (Browser). An engine request right after a second `goto` found no realm in the world and asked to create it, which WebKit refuses ("World with the given name already exists"), so every read after a second `goto` failed.
- *Seen:* review 17's revision; the suites had navigated a page twice only by clicking links before.
- *We:* when the page already has the world, the WebKit adapter waits for its report for the document, or the document's end.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q120. CDP and WebKit report a document's main-world realm a moment after it commits** (Browser). Asking for it right after `goto` returned found none, and the adapters answered `Unsupported{mainWorld}`, so `evaluateInMainWorld` failed on a page just loaded.
- *Seen:* review 18's revision, on Chromium.
- *We:* `realm` waits for the main world's report, or the document's end, as it does for an existing user world on WebKit (Q102).
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q151. Firefox implements `browsingContext.startScreencast`, which records a file** (Browser). Review 20's P4 found no screencast in WebDriver BiDi; Firefox 158 answers the command with a WebM path in the browser's downloads folder, and sends no frames.
- *Seen:* review 20's build, a raw BiDi probe.
- *We:* `Capability.Screencast`, whose handle is a stream of frames, stays `Unsupported` on BiDi, and the limitation says why.
- *Reconsider:* recording a video through it for `Trace`, or a capability of its own for a file screencast.
- **Kept** in review 21: the *We* line is the decision.

**Q178. Firefox names no user context in three events about windows** (Browser). `browsingContext.create({ type: "window" })` in a user context also opens a tab in the default user context, in a window of its own, and closes it at once; its `navigationStarted` and `navigationCommitted` come before its `contextCreated`, with `userContext: null`. `contextDestroyed` for a window whose user context `browser.removeUserContext` removed has `userContext: null` too. The spec has `browser.UserContext` in both places.
- *Seen:* review 21's build, when Firefox's pages became windows (Q71): the events failed to decode, so the adapter rebuilt its model from `browsingContext.getTree` in the middle of a navigation, and its documents went unreported. A raw BiDi client, which decodes nothing, didn't see a problem. It is what broke navigation in review 16's probe of windows.
- *We:* a correction in `packages/tools/codegen/protocols/bidi/patches/navigationInfo-userContext.json` makes the member nullable, as Q53's two are; the adapter places no context it can't attribute.
- *Reconsider:* on each roll (`pnpm codegen:audit`), and whether to report the transient tab with the deviation.
- **Resolved** in `38ce8ff` (review 21's second step): as above.
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-window-user-context-null.md`, not sent.

**Q180. A page another client crashed went unreported under load** (Browser, or ours: not traced). The CDP-only test where a second client attaches to a page and sends `Page.crash` waits for the page's end, `PageCrashed`; under synthetic load (eight processes at once beside a dozen busy loops), none came within 10 s in 24 runs of 40, with and without review 21's third step. It passed alone, and failed once in a normal full run.
- *Seen:* review 21's third step.
- *We:* nothing yet.
- *Reconsider:* whether `Page.crash` was refused or ignored (the test ignores its failure), or whether `Inspector.targetCrashed` or `Target.targetCrashed` came and the adapter missed it; trace it as Q149 was.

## Ours: workarounds and odd shapes

**Q58. `PromptBlocking` carries the dialog's kind and text, not `Page.Prompt`** (Ours). `Reason` is a leaf module, and importing `Page` into it makes a load cycle.
- *Seen:* review 13's revision.
- *Reconsider:* whether `Prompt` should live somewhere `Reason` can import.
- **Kept** in review 21: the *We* line is the decision.

**Q59. `PageNavigation.next` reaches `goto`'s outcome mapping through `Runtime.settle`** (Ours). `PageNavigation` can't import `Page` as a value: `Page.ts` needs `PageNavigation`'s classes as it loads.
- *Seen:* review 14's revision.
- *Reconsider:* moving the navigation reasons out of `PageNavigation`, or the `PageError` constructor out of `Page`, so the import is direct.
- **Kept** in review 21: the *We* line is the decision.

**Q60. Unbuilt module functions are erased, so some are odd stubs** (Ours). Node erases a `declare const`, so a module that used one as it loaded failed to load. `Deferred.await` was a `NotBuilt` function until review 13 (the module is gone since review 15), and `Route.continue` is a decision nothing reads yet.
- *Seen:* review 12's slice; `test/Modules.test.ts`.
- *Reconsider:* goes away as modules are built.
- **Resolved** in `a7ee8dc` (review 21's first step): the builds removed the stubs: the one `NotBuilt` left is `Trace.record`'s `domSnapshots`, which is declared and documented.

**Q61. A `Watchable` is an effect value with members attached** (Ours). Effect 4 has no public way to subclass `Effect`.
- *Seen:* review 12.
- *Reconsider:* if Effect adds one.
- **Kept** in review 21: the *We* line is the decision.

**Q62. A wait on a final value fails at once with `Timeout`** (Ours). A download's `status` ends in a final value, not with its target; `waitFor` a value it can no longer reach fails at once with `Timeout{waitingForCondition}` and a hint, which isn't a timeout.
- *Seen:* review 14's revision.
- *Reconsider:* a reason of its own for "can never happen", or `TargetGone` with a download as a target.
- **Resolved** in `c790129` (review 21's fourth step): `Watchable.waitFor` fails with `Watchable.Ended`, carrying the final value, when the value settled on one that can't satisfy it; a watchable whose entity ended keeps `TargetGone`. A canceled download's `status.waitFor(Completed)` checks it.

**Q63. `AutoResolution.policy` names a setting that doesn't exist** (Ours). A canceled file chooser reads `policy: 'fileChoosers: "cancel"'`, though no `fileChoosers` option exists; there is one policy.
- *Seen:* review 14.
- *Reconsider:* an option, or a different way to say "the only policy".
- **Resolved** in `c790129` (review 21's fourth step): `AutoResolution.policy` is a union: `ContextOption{ name: "dialogs", value }` for a context option, `Default` for the library's one rule, which a canceled file chooser gets.

**Q64. A body that isn't JSON is a `BackendFailure`** (Ours). `CapturedResponse.json` fails with `BackendFailure{IncompatibleResponse, method: "json"}`; no reason of `ResponseError` fits a page's malformed body.
- *Seen:* review 14's revision.
- *Reconsider:* a reason for it.
- **Resolved** in `c790129` (review 21's fourth step): `ResponseError` gains `MalformedBody{ expected: "json" }`, which `json` of a body that isn't JSON fails with.

**Q65. `BodyLimit` is compared with the encoded size** (Ours). The size the browser reports when a hop ends is encoded (compressed), which is what BiDi's collector bounds, so a 10 MiB limit admits a larger decoded body.
- *Seen:* review 14's revision.
- *Reconsider:* whether callers expect a decoded size.
- **Kept** in review 21: the *We* line is the decision.

**Q66. A `Timeout` whose every observation was `NoMatch` has the phase `resolving`** (Ours). Not `waitingForCondition`, since nothing was ever there to wait on.
- *Seen:* review 12's revision.
- *Reconsider:* nothing; recorded because it surprises.
- **Kept** in review 21: the *We* line is the decision.

**Q67. `getByText` doesn't search the document's `head`** (Ours).
- *Seen:* review 12's revision.
- *Reconsider:* nothing; recorded because it surprises.
- **Kept** in review 21: the *We* line is the decision.

**Q68. A click that times out after dispatch says `dispatchedUnconfirmed`** (Ours). A dialog the input opened is what holds such a dispatch (Q17).
- *Seen:* review 13's revision.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q80. The fold published events after the state they change** (Ours). `goto`'s outcome was latched before the navigation's end was published, so a `PageNavigation.next` made right after `goto` received `goto`'s own navigation. Popups, workers, dialogs and document readiness had the same order.
- *Seen:* review 16's revision, through review 14's `waitUntil` test on Chromium.
- *We:* publish first, then change the state (CONCEPTS.md §9, Subscriptions).
- *Reconsider:* nothing; recorded because the order is now a rule every new fact must keep.
- **Kept** in review 21: the *We* line is the decision.

**Q81. The guard can't stop a page's own earlier window listeners** (Ours). The guard listens on the window in the capture phase, armed just before dispatch, so a page listener added there earlier runs first and sees an event the guard then stops. Listeners anywhere else are protected.
- *Seen:* review 16's revision.
- *We:* nothing.
- *Reconsider:* if a page relies on window capture listeners for clicks.
- **Kept** in review 21: the *We* line is the decision.

**Q82. Every waiting expectation evaluates at every animation frame** (Ours). Not only those that depend on layout: one evaluation per frame for each, in the page, while it waits.
- *Seen:* review 16's revision.
- *We:* accept the cost, for one rule.
- *Reconsider:* frames only for layout conditions, if pages with many waiting expectations slow down.

**Q83. A shadow root's mutations don't wake an expectation** (Ours). The `MutationObserver` watches the document, and doesn't see into shadow roots; the next frame, or in a page that renders none the next round, catches the change.
- *Seen:* review 16's revision.
- *We:* nothing more.
- *Reconsider:* observing each open shadow root.
- **Kept** in review 21: the *We* line is the decision.

**Q84. A failed release leaves a page unable to take input, for good** (Ours). After a held key's or button's release fails on a live page, every later gesture on it fails with `BackendFailure`, and nothing but a new page resets it.
- *Seen:* review 16's revision.
- *We:* fail loudly rather than act with a key that may still be down (CONCEPTS.md §5, Compensation).
- *Reconsider:* a reset that releases every key and button the page could hold.
- **Resolved** in `a7ee8dc` (review 21's first step): the next gesture sends the release that failed again first. If it gets through, the page's input is known again and the gesture runs; the gesture fails only if it fails again.

**Q85. `Condition` isn't `Pipeable`, though `because` is dual** (Ours). `condition.pipe(Condition.because("…"))` doesn't compile; `Condition.because(condition, "…")` and `pipe(condition, Condition.because("…"))` do.
- *Seen:* review 16's revision.
- *We:* nothing.
- *Reconsider:* making it `Pipeable`, like the handles.
- **Resolved** in `c790129` (review 21's fourth step): `Condition` extends `Pipeable`; conditions are made with `pipe` on their prototype.

**Q86. Keys are the US layout's** (Ours). Shift turns `1` into `!` as on a US keyboard, and a character outside the table is a key with `code: ""`.
- *Seen:* review 16.
- *We:* nothing.
- *Reconsider:* other layouts, if a test needs one.
- **Kept** in review 21: a declared piece still unbuilt, built when a use needs it.

**Q87. `Expect.that` turns its subject's timeout into its own failure** (Ours). A subject still running at the expectation's deadline, or failing with `Timeout` once it has passed, ends the expectation with `ExpectationFailed`; a shorter deadline inside the subject stays the subject's failure. The two are told apart only by whether the expectation's deadline has passed.
- *Seen:* review 16's revision, under full load: a `Locator.count` timed out while resolving.
- *We:* as above.
- *Reconsider:* nothing; recorded because it surprises.
- **Kept** in review 21: the *We* line is the decision.

**Q88. The CDP adapter assumes Chromium reports an intercepted drag before the next move** (Ours). A drag Chromium intercepts is announced by an event, `Input.dragIntercepted`; the adapter turns the moves after it into drag events, so an announcement that arrived after the release would leave a drag the adapter thinks is in progress.
- *Seen:* review 16's revision; it held in every run.
- *We:* nothing yet.
- *Reconsider:* waiting for the page's `dragstart` after the first held move, as Playwright does, and clearing a drag the release didn't end.
- **Resolved** in `a7ee8dc` (review 21's first step): a drag Chromium announces after its gesture's release is canceled (`dragCancel`) before the next gesture, which would otherwise continue it.

**Q103. Chromium's `Fetch` stays enabled for every page, with a pattern nothing matches** (Ours). It keeps the interceptor installed, so a route declared on a live page is in force when its declaration returns (Q46).
- *Seen:* review 17's revision: one request in 40 went past a route under load before; none in 160 after.
- *We:* `Fetch.enable` from each page target's start, never disabled.
- *Reconsider:* whether an interceptor always installed costs anything measurable; and whether Chromium can say when its interceptor is in force.

**Q104. A decision a backend can't apply lets the request through** (Ours). `Route.abort("timedOut")` on Firefox, or a fulfill at the response phase there, is a handler failure, so the default, continue, applies, logged and published as an `AutoResolution`: the route fails open.
- *Seen:* review 17's revision.
- *We:* as above, for one rule with handler failures.
- *Reconsider:* failing closed for an abort, which would be a decision nobody made.
- **Kept** in review 21: the *We* line is the decision.

**Q105. Routes' automatic decisions name a setting that doesn't exist** (Ours). `policy: 'routes: "continue"'`, as file choosers' do (Q63).
- *Seen:* review 17's revision.
- *We:* nothing.
- *Reconsider:* with Q63.
- **Resolved** in `c790129` (review 21's fourth step): a request no route decides is `policy: Default`, as Q63.

**Q106. A route with a `URLPattern` pauses every request** (Ours). L0 can't read a `URLPattern`, so the intercept covers everything and the route matches itself; requests it doesn't match continue at once, a round trip each.
- *Seen:* review 17's revision.
- *We:* a glob or an exact URL is passed to L0 as it is.
- *Reconsider:* translating a `URLPattern`'s fixed parts into a glob.
- **Resolved** in `f223b83` (review 22's second step): the intercept is the pattern's fixed prefix, from the scheme through the path up to its first variable part, with the origin as a URL writes it, and `*`; a prefix that ends inside the origin keeps the scheme only.

**Q107. A removed init script's dependents stay registered** (Ours). They don't run once their dependency is gone, since L0 runs a script only after what it comes after ran, but they are still declared until their own scope closes.
- *Seen:* review 17's revision; the review said they would be removed.
- *We:* as above.
- *Reconsider:* removing them, which would need L1 to own their scopes.
- **Kept** in review 21: the *We* line is the decision.

**Q108. The page clock's controls are on a symbol the page can find** (Ours). `Symbol.for` with a random token keeps page script from stumbling on them, not from looking.
- *Seen:* review 17.
- *We:* as above.
- *Reconsider:* driving the clock from the isolated world through the DOM, if pages turn out to touch it.
- **Kept** in review 21: the *We* line is the decision.

**Q109. A page's clock and its context's can't both be installed** (Ours). One timeline covers a page, so the second `install` is a `Conflict`.
- *Seen:* review 17's revision.
- *We:* as above.
- *Reconsider:* letting a page's clock override its context's, as overrides do.
- **Kept** in review 21: the *We* line is the decision.

**Q122. A frame that isn't there yet is a request that matches nothing** (Ours). Its steps become `:not(*)`, so every operation handles it as it handles no match, in a round of at most 100 ms, so the next round looks for the frame again.
- *Seen:* review 18's revision.
- *We:* as above; a read in a missing frame is `NoMatch` at once.
- *Reconsider:* waiting in the parent document for the iframe, which would save the short rounds.
- **Kept** in review 21: the *We* line is the decision.

**Q123. A round the deadline cut short reported what it never saw** (Ours). A round cut before its first frame noted `NoRenderingOpportunity`, or answered its default `NoMatch`, and one cut while a rect was still settling answered `NotStable`; under a short deadline that buried the real reason, a covered iframe.
- *Seen:* review 18's revision, `Deadline.within("1 second")` on a covered frame.
- *We:* `NotReady` says whether the round noted anything (`checked`), and L1 adds the reason only then; a round under 100 ms doesn't note `NoRenderingOpportunity`.
- *Reconsider:* rounds that keep a stable check's frames across rounds.
- **Kept** in review 21: the *We* line is the decision.

**Q124. A snapshot's text and iframe nodes have roles that aren't ARIA's** (Ours). Text is `{ _tag: "Aria", role: "text" }`, its text the name, and an iframe is `iframe`; `Snapshot.Node` has no other kind.
- *Seen:* review 18's revision.
- *We:* as above, as Playwright's aria snapshots write them.
- *Reconsider:* a node kind for text in the schema.
- **Kept** in review 21: the *We* line is the decision.

**Q125. A snapshot's generation names a table, and `Suspended` never happens** (Ours). The review's generation was to advance when refs went stale; refs live as long as their document, so the generation is a random number the engine picks when installed, and a ref from another table is `BindingLost`. Nothing tells a document in the back/forward cache from one replaced, so `StaleRef{Suspended}` is never given.
- *Seen:* review 18's revision.
- *We:* as above.
- *Reconsider:* `Suspended` from the document's lifecycle, when the model folds it.
- **Kept** in review 21: the *We* line is the decision.

**Q126. An element screenshot of no element is `InvalidInput`** (Ours). `PageError` has no `NoMatch` or `StrictViolation`, so a capture's locator that doesn't match one element is `InvalidInput{input: "area"}`, the locator and what it matched in the hint.
- *Seen:* review 18's revision.
- *We:* as above; a capture never waits.
- *Reconsider:* the locator reasons in `PageError`.
- **Resolved** in `c790129` (review 21's fourth step): `PageError` gains Locator's `NoMatch` and `StrictViolation`, which an element capture of none, or of several, fails with; `InvalidInput{area}` stays for a frame on its way that went.

**Q127. Sites are approximated without the public suffix list** (Ours). A storage partition's top-level site is the URL's scheme and its host's last two labels, or the host itself for an IP address or a one-label name; `example.co.uk`'s is `co.uk`.
- *Seen:* review 18's revision.
- *We:* as above, for storage state's partitions.
- *Reconsider:* the public suffix list, if a partitioned origin is ever mislabelled.
- **Kept** in review 21: the *We* line is the decision.

**Q128. The CDP adapter reads the device pixel ratio from the page** (Ours). `scale: "css"` clips at a scale of one over the ratio; `Page.getLayoutMetrics` as the protocol types it has no scale for the visual viewport, so the ratio is `devicePixelRatio`, evaluated.
- *Seen:* review 18's L0 build.
- *We:* as above.
- *Reconsider:* `Emulation`'s device metrics, when an override is in force.
- **Kept** in review 21: the *We* line is the decision.

**Q129. Firefox's Xrays are waived to read IndexedDB records** (Ours). Q118 leaves no other way to iterate a page's `Map` or `Set`, so a page that patched `Map.prototype` or `Set.prototype` could change what an export reads.
- *Seen:* review 18's revision.
- *We:* waive each record's Xray; the records are the page's own structured clones.
- *Reconsider:* with Q118.
- **Kept** in review 21: the *We* line is the decision.

**Q130. The page that writes a storage state is in the new context's history** (Ours). Its navigations and requests are the context's events, which `history` keeps, though the caller never had the page.
- *Seen:* review 18's revision.
- *We:* nothing.
- *Reconsider:* writing from a page the model doesn't publish, or clearing the history it left.
- **Kept** in review 21: the *We* line is the decision.

**Q131. Some storage errors have no `Timeout` or `TargetGone`** (Ours). `CookieJarError` operations declare neither, and origin storage declares no `Timeout`, so a context that ended is a cookie jar's `BackendFailure`, and origin storage's deadline is one too; an origin with no storage (an opaque one) is `BackendFailure`, and a value over the quota `InvalidInput`.
- *Seen:* review 18's revision.
- *We:* as above.
- *Reconsider:* the error channels, with the next API revision.
- **Resolved** in `c790129` (review 21's fourth step): cookie jar operations declare `TargetGone`, and a context that ended is one; origin storage declares `Timeout`, which its deadline is (`dispatchedUnconfirmed`: a write may have happened).

**Q132. Handles are released one at a time** (Ours). The review's batches aren't built: each handle's scope finalizer releases it alone.
- *Seen:* review 18's revision.
- *We:* as above.
- *Reconsider:* releasing a scope's handles in one command per realm.

**Q133. `page.readHtml` reads from the engine's world** (Ours). The review said the isolated world; the document's HTML is the same from either, and the engine is already there.
- *Seen:* review 18's revision.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q134. A storage state's records are in the library's encoding in memory too** (Ours). A record's key and value in a `StorageState` are the JSON-safe encoding (`$date`, `$map`, `$bytes` and the rest), not the values themselves, so the same state round-trips through `StorageState.Json` unchanged.
- *Seen:* review 18's revision.
- *We:* as above; the schema's `Unknown` says so.
- *Reconsider:* a schema for the encoding, if anyone reads records.
- **Kept** in review 21: the *We* line is the decision.

**Q135. A page released by its scope isn't closed by the time the scope is** (Ours). The finalizer asks the adapter to close it, and the BiDi adapter doesn't wait for the browser, so a new page right after can meet Q119.
- *Seen:* review 18's revision.
- *We:* nothing yet, beyond the storage state's page (Q119).
- *Reconsider:* waiting for the close in the finalizer, under a short deadline.
- **Resolved** in `a7ee8dc` (review 21's first step): a page released by its scope, or a popup by its opener's, is waited for after the close is asked for, under the default budget.

**Q141. A launched browser's own first tab is observed** (Ours). Every backend opens one tab in the default context before any page is created (review 19, P1); no scope created it, so it is an observed page, open as long as the browser, which `inspect` and `control` gain access to.
- *Seen:* review 19, P1.
- *We:* as above; `browser.pages` and the default context's `pages` list it.
- *Reconsider:* closing it at launch, which would make the browser exit on some platforms when the last tab goes.
- **Kept** in review 21: the *We* line is the decision.

**Q142. Access is a contract at the handle, not at the protocol** (Ours). A handle made under a grant has every member, its type narrowing what a caller sees: a `ReadonlyPage` from `inspect` still has `goto` at run time. A released grant is enforced at run time, by wrapping each member and through each locator's owner.
- *Seen:* review 19's revision.
- *We:* as above (CONCEPTS.md §3: access is a library contract).
- *Reconsider:* refusing control members at run time on an `inspect` handle, if a cast ever reaches one.
- **Kept** in review 21: the *We* line is the decision.

**Q143. A released grant refuses some members with `NotPermitted`, or a clock with `NotInstalled`** (Ours). `route`, `addInitScript`, `emulate`, a context's cookies, `newPage` and storage state declare no `TargetGone`, so they fail with their module's `NotPermitted`; the clock's `adjust`, `setTime` and `resume`, whose errors have no `NotPermitted`, fail with `NotInstalled`, which is true, since the clock went with the grant.
- *Seen:* review 19's revision.
- *We:* as above; every other member fails with `TargetGone{AccessReleased}`.
- *Reconsider:* `TargetGone` in those signatures, with the next API revision.
- **Resolved** in `c790129` (review 21's fourth step): `route`, `addInitScript`, `emulate`, `grant`, `newPage`, `exportStorageState`, the cookie jar, the page clock, `Dialog.handle`, `FileChooser.handle`, `Har.record`, `Trace.record` and `Browser.newPage` declare `TargetGone`, and a released grant fails every guarded member with `TargetGone{AccessReleased}`. The refusal table went with it (`internal/refusals.ts` is `guarded.ts`, which lists only the members observing gives and the declarations a grant removes). A clock never installed is still `NotInstalled`.

**Q144. A page's `context`, when its context isn't controlled, refuses** (Ours). `Page.context` is a `UserContext`, but controlling a page doesn't control its context, so it is a handle whose members needing control fail with `NotPermitted`, and whose `control` gains it.
- *Seen:* review 19's revision.
- *We:* as above.
- *Reconsider:* an `ObservedUserContext` there, with the next API revision.
- **Kept** in review 21: the refusing context's message names `page.context.control`.

**Q145. Controlling a context controls its pages** (Ours). A context granted for a scope hands out its pages as `Page`s under the same grant, as `UserContext.pages` is typed.
- *Seen:* review 19's revision.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q146. A program that dies without ending its session locks Firefox** (Ours). The session is ended in the connection's finalizer; a killed process never runs it (Q137).
- *Seen:* review 19.
- *We:* nothing more.
- *Reconsider:* a CLI command that ends a stuck session, if one turns up.
- **Kept** in review 21: the *We* line is the decision.
- **Reported** in review 21's fifth step: drafted in `upstream/firefox-session-outlives-socket.md`, not sent.
- **Resolved** in `6ff530c` (review 22's first step): the CLI's daemons keep a ledger record of the browser they launched, so `strider prune --yes` kills a Firefox a dead program left running, which frees its session.

**Q147. An attached Chromium's every page gets the library's interceptor** (Ours). The CDP adapter enables `Fetch` for every page from its start, with a pattern nothing matches (Q103), observed pages included: nothing changes for the page, but the interceptor is installed while the client is attached.
- *Seen:* review 19.
- *We:* as above.
- *Reconsider:* enabling it only when a page is controlled, which brings back Q46's race for the first route.
- **Kept** in review 21: the *We* line is the decision.

**Q148. Chromium's HTTP endpoint is read with Effect's `HttpClient` over `fetch`** (Ours). `Chromium.layerConnect` provides `FetchHttpClient` inside the layer to read `/json/version`, so its requirements stay `WebSocketConstructor`.
- *Seen:* review 19's revision.
- *We:* as above.
- *Reconsider:* taking `HttpClient` from the caller, if a runtime has no `fetch`.
- **Kept** in review 21: the *We* line is the decision.

**Q152. A file chooser answered with made files is let go before its handler counts** (Ours). `FileInput.bytes` files are set by the page on the chooser's input, and the chooser is then resolved as canceled, which no backend acts on; the page's `change` can arrive before the handler's `handled` goes up.
- *Seen:* review 20's build, on WebKit.
- *We:* the tests wait on `handled`.
- *Reconsider:* counting the handler before its files are set.
- **Resolved** in `a7ee8dc` (review 21's first step): the handler is counted when it decides, as a dialog's is, and the page sets the files after; the slice test reads the count without waiting.

**Q153. One call can't mix made files with paths** (Ours). The browser sets files from paths and the page makes files from bytes, each replacing the other's, so `setInputFiles` and `FileChooser.choose` with both fail with `InvalidInput`.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* reading local files into made ones, which loses nothing but the browser's own MIME guess.
- **Kept** in review 21: the *We* line is the decision.

**Q154. `Browser.layerTest`'s browser is a protocol of its own** (Ours). `Info.protocol` gained `"fake"`, the fake has its own support table, its timeline's URLs are `https://example.test/…`, and its `goto` commits at once, with no response.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* whether a timeline should name its URLs.
- **Kept** in review 21: the *We* line is the decision.

**Q155. An operation's span no longer captures its call site** (Ours). `Effect.fn` adds the caller's stack frame to a span; the span helper opens spans with `Effect.withSpan` around `Effect.fnUntraced`, so `SpanNameGenerator` and `TracerDisabledWhen` apply to every operation alike.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* capturing the call site in the helper when Effect exposes it.
- **Kept** in review 21: the *We* line is the decision.

**Q156. The model's own log uses the layer's diagnostics preset** (Ours). A route decision the backend refused is logged by the model's fiber, which runs with the layer's context, so `Diagnostics.withPreset` around an operation doesn't reach it.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* carrying the preset with the route's declaration.
- **Kept** in review 21: the *We* line is the decision.

**Q157. Vitest copies each attached file into `.vitest/attachments`** (Ours, from Vitest). `recordArtifact` with a path copies the file under the project root, named by its hash.
- *Seen:* review 20's build, the `TestRun.attach` test.
- *We:* the repository ignores `.vitest/`.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q162. Ids are unique within the process, not the connection** (Ours). A trace recording learns of operations from their spans' attributes, which carry ids; two connections minting `N1` would have made one's operations look like the other's.
- *Seen:* review 20's build.
- *We:* every connection's ids come from the process's counters, so no two connections mint the same one.
- *Reconsider:* nothing; it makes ids stronger evidence everywhere.
- **Kept** in review 21: the *We* line is the decision.

**Q163. A recording's timings are the library's, not the browser's** (Ours). A HAR's `wait` runs from the request event to the response event, and `receive` from there to the end, on the library's monotonic clock; `blocked`, `dns`, `connect` and `ssl` are -1, since no backend reports them alike (P2). `startedDateTime` is the wall time read as the recording started, plus the monotonic time since. A minimal HAR's timings, and a response that never came, are -1, as Playwright writes them.
- *Seen:* review 20, P2.
- *We:* as above.
- *Reconsider:* each backend's own phases as `_` extensions.
- **Kept** in review 21: the *We* line is the decision.

**Q164. A HAR has no request bodies** (Ours). The event model keeps a request's body only while a route holds it.
- *Seen:* review 20's build.
- *We:* entries have no `postData`.
- *Reconsider:* keeping bodies for recordings, through `requestBody` where the backend has it.
- **Kept** in review 21: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `f223b83` (review 22's second step): a recording reads each hop's request body as the hop ends, kept where its body collection, which now names the bodies it keeps, covers the page: from the event on Chromium, or `Network.getRequestPostData` for the last hop's (Q182), a request data collector on Firefox (Q183), the event on WebKit (Q184). An export writes them as `postData` only when `include` names `"requestBodies"`.

**Q165. A caller's span in a trace spans the operations inside it** (Ours). Its own start and end are on Effect's clock, which `TestClock` freezes, so its step runs from its first recorded operation's start to its last one's end.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q167. The toolkit brings a page to the front before acting on it** (Ours). Its tools name pages and have no `activate`; a Firefox page behind another renders about once a second (Q71), so a click there timed out once a popup opened. `screenshot`, `click`, `fill`, `press`, `select`, `scroll` and `expect` activate their page first, and their descriptions say so.
- *Seen:* review 20's build, the toolkit's popup test on Firefox.
- *We:* as above.
- *Reconsider:* with Q71: whether every page could render in the background.
- **Kept** in review 21: the toolkit is given its context, so it keeps activating; after review 21's second step, it matters only on a Chromium context without focus emulation.

**Q168. `--attach` reads its backend from the endpoint** (Ours). An HTTP endpoint, or a WebSocket to `/devtools/`, is Chromium's; any other WebSocket WebDriver BiDi's. CLI.md names one `--attach` flag.
- *Seen:* review 20's build.
- *We:* the rule is in the session's start, and the spec it prints names the backend.
- *Reconsider:* a flag per protocol, if an endpoint is ever ambiguous.
- **Kept** in review 21: the *We* line is the decision.

**Q169. A session's context is its own, also when it attaches** (Ours). The daemon creates the session's one context, so its pages are controlled from the start; the attached browser's own tabs aren't in it, and `strider control`, which would take one, isn't built.
- *Seen:* review 20's build.
- *We:* `control` fails, saying so.
- *Reconsider:* the default context as an attached session's, observed, with `control` acquiring for the session's scope.
- **Kept** in review 21: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `6ff530c` (review 22's first step): `strider tabs` lists the browser's own tabs, `strider control` takes one into the session for its scope, named, and `strider release` gives it back; the toolkit has the same tools when made with the browser.

**Q170. The client learns a session started from one line** (Ours). `strider start` runs the daemon detached, with its standard output piped; the daemon writes one JSON line, ready or why not, and from then on writes its own output to `daemon.log` in the session's directory, since nothing reads the pipe.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q171. The CLI's socket carries JSON lines, not `effect/rpc`** (Ours). CLI.md had the daemon serve the tools as an `effect/rpc` group; the client must forward a command without loading Effect, so it sends the command's arguments as one line, the daemon parses them with `effect/cli`, and the answer is lines of output and an exit code. An `Interrupt` line interrupts the command.
- *Seen:* review 20's build.
- *We:* as above; `--json` prints a command's result as one JSON line.
- *Reconsider:* an `effect/rpc` surface beside it, for programs that drive a session.
- **Kept** in review 21: the *We* line is the decision.

**Q172. The package compiles without Node's types** (Ours). The CLI is Node's alone, and uses its built-ins through a small interface of its own (`cli/node.ts`) over dynamic imports, so nothing else in the package can come to rely on Node.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q173. A page a segment opens with `newPage` ends with the segment** (Ours). A segment runs in a scope of its own, which a page it opens belongs to; a page it returns is named into the session, but only one that outlives the segment, such as a popup of a session's page, stays open.
- *Seen:* review 20's build.
- *We:* as above; `strider page new` opens a page for the session.
- *Reconsider:* transferring a returned page's ownership to the session, which CONCEPTS.md §3 allows.
- **Kept** in review 21: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `6ff530c` (review 22's first step): `CurrentSession.keep(page, name)` transfers a page the segment opened to the session's scope; returning a page still only names it.

**Q174. A popup collected by `await` is usually still blank** (Browser). The popup event comes before its first navigation, so the URL `await` can report is `about:blank`; the toolkit says "so far".
- *Seen:* review 20's build, on every backend.
- *We:* as above.
- *Reconsider:* waiting for the popup's first commit, which would be a wait the tool adds.
- **Kept** in review 21: the *We* line is the decision.

**Q175. A segment is imported afresh on every run** (Ours). Its URL gets a query of its own, so an edited file runs as edited; module state doesn't carry from one run to the next.
- *Seen:* review 20's build.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q176. The digest has what arrived before the call returned** (Ours). An event that arrives just after a tool's result, such as a 404 a click's page fetches, is in the next call's `sinceLast`.
- *Seen:* review 20's build, the toolkit's tests.
- *We:* as above; no tool waits after it acts.
- *Reconsider:* nothing.
- **Kept** in review 21: the *We* line is the decision.

**Q177. The adapters kept every request for the connection's life** (Ours). Each adapter's request and hop tables dropped an entry only when a redirect replaced its hop, so a long-lived connection, such as the CLI's daemon or an agent's session, kept every request it had seen.
- *Seen:* review 21's build, fixing Q39.
- *We:* keep a finished request answerable while there is room for 1000, as the model keeps hops (`maxHops`), and forget the oldest after (`internal/retired.ts`). A request still in flight stays until it ends.
- *Reconsider:* ending a target's requests with it, which Q159's favicon, never ended, would need.
- **Resolved** in `a7ee8dc` (review 21's first step): as above.
