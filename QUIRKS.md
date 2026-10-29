# QUIRKS: weird behaviors to reconsider

*Started 2026-10-23, at the maintainer's request: "record all the weird behaviors we amass as we build, so we can go back and reconsider them when we're done." Back-filled from the probes (PROBES.md, Results) and PROTOCOL.md's Built sections, up to `ebe4b16`.*

Two kinds of entry:

- **Browser:** something a browser or protocol does that is surprising, inconsistent with the other browsers, or at odds with its spec.
- **Ours:** a compromise in Strider itself: a workaround a browser forced, a shape the platform or Effect forced, or a choice that reads oddly out of context.

Each entry says what is weird, where it was seen (with the builds: Chromium 155.0.8059.79, Firefox 158.0, Playwright's WebKit 2359, and for stock WebKit WebKitGTK 2.54.1's MiniBrowser), what Strider does about it now, and what to reconsider. None is resolved by being listed here; this is the list to walk when the library is built. Entries are never removed, only marked:

- **Resolved**, with the commit that resolved it;
- **Kept**, with the reason it was kept;
- **Reported**, with its draft in `upstream/`, and the report's link once one is sent.

An entry with no marker is open.

**Adding one.** When building or probing turns up something weird, add it here in the same commit, at the end of its section, with the next number. Numbers are stable, so documents and code comments can cite them (`QUIRKS.md, Q12`).

## Browsers: navigation, history and documents

**Q1. Chromium commits its error page under the failed navigation's loader id** (Browser). A navigation that fails is reported failed on `Network.loadingFailed`, and Chromium then commits `chrome-error://chromewebdata/` with `frameNavigated` and no `frameStartedNavigating`, under the failed navigation's own loader id.
- *Seen:* PROTOCOL.md, Found by the slice; CDP probe findings.
- *We:* keep a failed navigation on its frame by loader id until the frame's next commit, and make the error page its document (`createdBy: ErrorPage`), not a navigation of its own. Before that, it superseded the next `goto`.
- *Reconsider:* whether the error document should be visible to callers at all, and whether `Failed{errorDocument}` is the right shape.
- **Kept**: the *We* line is the decision.

**Q2. Firefox reports a refused navigation as its error page's URL** (Browser). A navigation Firefox refuses at once, such as to a port browsers don't use (9), starts as `about:neterror?e=deniedPortAccess&u=…`, not the URL it was going to; an error page also commits under a navigation id `navigationStarted` never announced.
- *Seen:* BiDi probe findings.
- *We:* report where it was going, from the error page's `u` parameter (`intended` in the BiDi adapter).
- *Reconsider:* whether to report the error page's URL anywhere, and whether other `about:` pages (`certerror`) carry the same parameter in every case.
- **Resolved** in `97a4ee2`: the conformance suite's TLS fixture checks a certificate's error page too, on every backend: Firefox's navigation to a site whose certificate nothing trusts is reported started at, and failed for, the URL it was going to. The error page's URL stays unreported.

**Q3. WebKit reports nothing at all for a navigation to a restricted port** (Browser). A link to port 9 produces no navigation, request or failure event on the inspector targets; only `Playwright.provisionalLoadFailed` and a `security` console message for a command's navigation.
- *Seen:* WebKit probe 15.
- *We:* nothing: a `PageNavigation.next` waiting for it times out.
- *Reconsider:* reporting the console message's evidence as a failed navigation, or a hint on the timeout.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: Playwright's build is no longer driven. On stock WebKit, a load refused before any request shows only its error page, and the `goto` waiting in the frame fails with it (Q199).

**Q4. Back/forward-cache restores look different on every backend** (Browser).
- Chromium restores under the restored document's *original* loader id (`frameNavigated{type: BackForwardCacheRestore}`), creating its context before the commit, and refuses a page's commands with "Not attached to an active page" for a moment while it swaps documents.
- Firefox restores with no `navigationCommitted`, `domContentLoaded` or `load`: the old realm goes and a new one comes, and `traverseHistory` replies after. Leaving its JSON viewer before it has loaded, it doesn't even send `navigationStarted`. A console message the restored page logged when it loaded comes again.
- WebKit keeps no back/forward cache: going back loads the page again.
- *Seen:* PROTOCOL.md, History and restores; probes 3.
- *We:* report each as `Restored` where the evidence allows, inferring Firefox's from a new main-world realm while a traversal is in flight.
- *Reconsider:* the inference on Firefox, which is timing-dependent (Q5), and the duplicate console message.
- **Reported**: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q5. Firefox can reply to `traverseHistory` before the restored document's realm arrives** (Browser). Under load, the reply came first, and the adapter, which looked for a waiting realm only at the reply, never ended the traversal.
- *Seen:* in two full integration runs of four.
- *We:* restore the traversal when the realm arrives (`restoring` on the navigable).
- *Reconsider:* whether Firefox will ever report restores with a commit, which would remove both this and Q4's inference.
- **Reported**: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q6. Chromium retries are needed for "Not attached to an active page"** (Ours). Chromium refuses a page's commands for a moment while it swaps documents.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send a history command it refused that way again, every 50 ms for up to a second.
- *Reconsider:* this is a fixed retry cadence, which sits uneasily with "no magic delays" (README, principles). Waiting for the swap's evidence would be better if one exists.
- **Resolved** in `a7ee8dc`: a command refused while Chromium swaps documents is sent again at once, at most three times, with no spacing: the refusal covers only the swap's moment.
- **Revised** in `fa0a3a9`: three resends weren't enough once, under a full run, for a back/forward-cache restore, which refuses longer than a commit. A refused command is now sent again each time its refusal comes back, with no delay of the library's, up to 10,000 times; under synthetic load the history test then passed 40 of 40.

**Q7. Firefox's realms come before their commit, sometimes after a transient one** (Browser). The new document's realm is created before `navigationCommitted`, sometimes after a realm with origin `null` that is destroyed at once. Chromium and WebKit create it after the commit.
- *Seen:* probe 1.
- *We:* hold a main-world realm created for a context whose document already had one until the next commit, and never report one destroyed before it.
- *Reconsider:* nothing yet; it is the spec's ordering question.
- **Kept**: the *We* line is the decision.

**Q8. Initial `about:blank` reuse differs** (Browser). Chromium and Firefox keep the initial `about:blank` realm into a same-origin first document; WebKit creates a new one.
- *Seen:* probe 2.
- *We:* model realms as siblings of documents (`RealmDocumentAdded`).
- *Reconsider:* nothing; recorded for completeness.
- **Kept**: the *We* line is the decision.

**Q9. Orphaned frames are reported differently** (Browser). Chromium sends no `frameDetached` for the children of a document a cross-document navigation replaced; Firefox and WebKit report them.
- *Seen:* probe 8.
- *We:* end a replaced document's children ourselves on Chromium.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q10. A 204 or a download reports its failure late, or as a fetch error, on Firefox** (Browser). For a 204, Firefox sends `navigationFailed` only when the next navigation starts, after an error reply to `navigate`.
- *Seen:* probe 15.
- *We:* end it as `NoContent` from the response and the reply.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q11. `document.open()` shows differently on every backend** (Browser). Chromium: `documentOpened` and lifecycle events again under the same loader. Firefox: `historyUpdated`, then `domContentLoaded` and `load` again. WebKit: only the load events again.
- *Seen:* probe 17.
- *We:* report a new generation of the same document.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q12. WebKit fires `load` before `DOMContentLoaded`** (Browser). `loadEventFired` usually comes before `domContentEventFired` for the same frame, and a parent's can come before its children's load.
- *Seen:* WebKit probe findings.
- *We:* fold readiness as each arrives; a `waitUntil: "domContentLoaded"` accepts `complete`.
- *Reconsider:* whether readiness should ever go backwards when they arrive out of order.
- **Kept**: readiness already never goes backwards: when WebKit reports `load` first, the adapter reports `interactive` and then `complete`, and ignores the `DOMContentLoaded` after.

**Q13. A cross-site navigation in WebKit swaps targets and frame ids** (Browser). It loads in a provisional target whose main frame has a new id; the old target's `didCheckNavigationPolicy` says `cancel: true` though the navigation goes on.
- *Seen:* WebKit probe findings.
- *We:* map the new frame id onto the page's main frame and follow the loader id across.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q14. Firefox's `reload` refuses `ignoreCache` whatever its value** (Browser). "Argument "ignoreCache" is not supported yet", as `unsupported operation`.
- *Seen:* PROTOCOL.md, History and restores.
- *We:* send it only to bypass the cache, which then fails as `Unsupported`.
- *Reconsider:* when Firefox supports it.

**Q15. Firefox renders JSON in a viewer with a `resource://devtools` realm** (Browser).
- *Seen:* BiDi probe findings.
- *We:* nothing special beyond Q4's case.
- *Reconsider:* whether the viewer's realm should be hidden from callers.
- **Resolved** in `a7ee8dc`: `LaunchProfile.automation` turns the JSON viewer off, so a JSON response's document is the JSON as served, as in the other browsers. `stock` and an attached Firefox keep it, and so does the adapter's handling of it.

**Q69. Firefox's traversal back from its JSON viewer went unreported under full load** (Browser). In one full integration run, the conformance test's `traverse(-1)` from `/json` removed the viewer's realm and fetched the page again, but no new realm and no end came within 10 s. Three runs of that test alone passed.
- *Seen:* in one full run of three; in two full runs of four; in one full run, which three runs of the test alone passed; in one of two full runs.
- *We:* nothing yet; the restore inference (Q4) waits for a realm that didn't come.
- *Reconsider:* with Q4 and Q5, an end Firefox reports for every traversal.
- **Resolved** in `a7ee8dc`: traced under synthetic load, where 12 of 32 runs failed: Firefox sends no `navigationStarted` for a traversal that leaves its JSON viewer before the viewer has loaded, fetches the page again, and reports no new document. With the viewer off in `automation` (Q15), 48 of 48 passed. The viewer's own case goes into Q4's report.
- **Reported**: drafted in `upstream/webdriver-bidi-restores.md`, not sent.

**Q149. A Chromium page closed under full load went unreported** (Browser). In one full integration run, the conformance test's `closePage` was answered, and no `NavigableRemoved` came within 10 s; three runs of that test alone passed.
- *Seen:* once.
- *We:* nothing yet.
- *Reconsider:* whether `Target.targetDestroyed` or `detachedFromTarget` was lost, or arrived for a target the adapter no longer tracked, if it happens again.
- **Resolved** in `a7ee8dc`: traced under synthetic load, where 4 of 48 runs failed: Chromium answers a `Target.closeTarget` sent as a navigation commits, and drops it; the page stays attached and alive, and a second close closes it. Raw CDP showed the same, 10 dropped closes in 120. The adapter first sends a page command, `Page.getNavigationHistory`, which Chromium refuses during the swap and accepts once it is over, and which is answered with a dialog open; with it, raw CDP dropped no close in 120, and 100 of 100 stress runs passed.
- **Reported**: drafted in `upstream/chromium-close-dropped.md`, not sent.

**Q198. Stock WebKit reports a failed load and a download only through the document's request** (Browser). It has no `Playwright.provisionalLoadFailed` or `downloadCreated`: a refused connection is `Network.loadingFailed` with the error, and a download's response is followed by `loadingFailed` "Frame load interrupted", canceled, as a 204's is.
- *Seen:* WebKitGTK 2.54.1's MiniBrowser.
- *We:* on stock WebKit, the document request's failure ends its navigation: `BecameDownload` when the response said `Content-Disposition: attachment`, `NoContent` after a 204 or 205, and otherwise `Failed` with the error; the download itself isn't reported (`downloads`, `unsupported`).
- *Reconsider:* a response that downloads without saying `attachment`, such as a type WebKit can't show, fails with "Frame load interrupted".

**Q199. After a failed load, WebKitGTK shows an error page as a navigation to `about:blank`** (Browser). It follows the failure as a navigation of its own, which can interrupt one started right after. A load refused before any request, such as to port 1, which WebKit blocks, shows only the error page: no request, no failure, where Playwright's build reports `provisionalLoadFailed` (Q3).
- *Seen:* a `goto` right after a refused one was credited with the error page's commit, and one to port 1 committed `about:blank`.
- *We:* on stock WebKit, an `about:blank` navigation claims no `goto` to another URL; one that starts while a `goto` waits in the frame fails that `goto`, saying WebKit showed its error page instead. The tests wait for the error page before going on.
- *Reconsider:* a `goto` started just before an earlier failure's error page commits fails with it.
- **Revised** in `508e013`: after a load that failed, the `about:blank` that follows is the failed navigation's document (`ErrorPage`), as Chromium's error page is (Q1), never a navigation of its own; after a load refused before any request, it fails the `goto` waiting in the frame and is that navigation's document.

**Q200. Stock WebKit reports no same-document navigation** (Browser). Its `Page` domain has no `navigatedWithinDocument`: a fragment or `history.pushState` changes the page's URL unseen.
- *Seen:* a `goto` to a fragment of the document shown waited until its deadline, and `page.url` kept the URL before `pushState`.
- *We:* `navigation.sameDocument` is `unsupported`, and the stock profile's `goto` refuses a URL that differs from the document's only in its fragment.
- *Reconsider:* reading `location.href` where the URL matters, if a use needs it.

**Q201. Stock WebKit's frames arrive by navigating, and its load events name no frame** (Browser). It has no `frameAttached`, so a frame is known from its first `frameNavigated`; `domContentEventFired` and `loadEventFired` have no `frameId`; and `DOM.describeNode`, which says which frame an iframe holds, isn't there. A page attached after it loaded gets no load event at all.
- *Seen:* in the vendored protocol and the MiniBrowser.
- *We:* load events are the main frame's (`frames.readiness`, `partial`); `contentFrame` is `Unsupported`; an adopted page's `document.readyState` is asked as its target is set up, so a page attached after its load is `complete`.
- *Reconsider:* asking a child frame's readiness in its realm, if a use waits on one.
- **Revised** in `508e013`: launched, `contentFrame` is found through Automation and matched by the frame's document (Q228), so frame locators work; attached, it stays `Unsupported`.

**Q211. A page stock WebKit's Automation just opened is still loading, and a navigation sent then returns when that load ends** (Browser). `createBrowsingContext` answers while the new page loads its first `about:blank`; a `navigateBrowsingContext` sent at once, with the `Normal` load strategy, is answered when that load completes, and the navigation it asked for commits after, unloading the document the next command runs in ("Callback was not called before the unload event").
- *Seen:* the integration test failed every time once the machine was quiet, and passed in the probes, which did more before navigating.
- *We:* the test waits for the new page's first load (`waitForNavigationToComplete`) before navigating; the adapter will.
- *Reconsider:* nothing.

**Q215. Stock WebKit's inspector reports a history traversal under the old document's URL, with no realm** (Browser). Going back, through Automation's `goBackInBrowsingContext` or the page's `history.back()`, the new load's `Page.frameNavigated` names the URL of the document left, and no `Runtime.executionContextCreated` or load event follows, though the page shows the entry gone back to.
- *Seen:* `page.back()` was reported committed to the page it left, and the next read waited for a realm that never came.
- *We:* `navigation.traverse` is `unsupported` on stock WebKit, attached or launched, and `back` and `forward` refuse; a traversal the page makes is still misreported.
- *Reconsider:* taking the URL from the document's request, and asking for its realm, if a use needs a page's own traversals.

## Browsers: dialogs, popups, focus and input

**Q16. A dialog blocks evaluation on Chromium and WebKit, not on Firefox** (Browser). Every evaluation in every world waits while a dialog is open on Chromium and WebKit; Firefox answers.
- *We:* fail every operation on a page whose dialog nothing will decide at once with `PromptBlocking`, on every backend, Firefox included, for one rule.
- *Reconsider:* whether Firefox's reads should be let through after all.
- **Kept**: the *We* line is the decision.

**Q17. The click that opens a dialog doesn't return until it is decided** (Browser). On all three backends.
- *We:* register handlers before the action; a click whose dialog nothing will decide fails with `PromptBlocking` and `dispatch: MayHaveBeenSent`.
- *Reconsider:* nothing; it shapes the API (handlers first).
- **Kept**: the *We* line is the decision.

**Q18. A popup's URL arrives after the popup** (Browser). Chromium reports `""` at `PageAdded`, Firefox and WebKit `about:blank`; the URL it was opened for arrives with its first navigation.
- *We:* report the popup at once and match `url` filters against its first navigation, offering the entry again then.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q19. The opener goes to the background, and headless Chromium stops rendering it** (Browser). After `window.open`, Chromium and Firefox report the opener `hidden`; headless Chromium renders no frames for it, so actions on it time out with `NoRenderingOpportunity` until `page.activate`.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`.
- *Reconsider:* whether an explicit option to keep openers rendering is worth having.
- **Resolved** in `38ce8ff`: no Chromium switch keeps an opener rendering once its popup opens as a tab over it, but focus emulation does. The `NoRenderingOpportunity` hint names `newContext({ focus: "emulated" })` beside `page.activate`, and the CLI's session context emulates focus on Chromium and WebKit. The library's default stays `focus: "system"`.

**Q20. A paused popup blocks its opener's `window.open`** (Browser). On Chromium, `window.open` doesn't return until the paused popup resumes, and popups can be paused only browser-wide.
- *Seen:* probe 22.
- *We:* pause browser-wide only when the browser was launched.
- *Reconsider:* attached browsers' popups, when attaching is built.
- **Kept**: the *We* line is the decision.

**Q21. User activation from evaluation lasts differently** (Browser). Firefox's `userActivation: true` grants activation only during the call; Chromium's `userGesture` and WebKit's `emulateUserGesture` leave it active after.
- *Seen:* probe 20.
- *We:* nothing; operations that need activation request it per call.
- *Reconsider:* whether to normalize.
- **Kept**: the *We* line is the decision.

**Q22. WebKit aborts on two commands instead of failing** (Browser). `Playwright.navigate` with a frame id the page doesn't have (exit 134) and `Dialog.handleJavaScriptDialog` with no dialog open (exit 139).
- *Seen:* WebKit probe findings.
- *We:* never send either outside what the model has seen; a frame that goes between the check and the command is a race we can't close.
- *Reconsider:* when the build is rolled.
- **Reported**: drafted in `upstream/playwright-webkit-crashes.md`, not sent.
- **Resolved** in `9c8280c`: neither command is in stock WebKit, which the adapter now drives alone.

**Q23. A raw WebKit dialog answer left the page blocked once** (Browser). In a scratch probe, the same answer the adapter sends left the dialog open; the difference was never traced.
- *Seen:* WebKit probe findings.
- *We:* nothing; the adapter's answers work.
- *Reconsider:* trace it before relying on raw-protocol access to WebKit.
- **Kept**: the *We* line is the decision.
- **Resolved** in `9c8280c`: the `Dialog` domain was Playwright's build's; stock WebKit's dialogs are answered through Automation (Q206).

**Q24. A second client can crash a page another client created** (Browser). On Chromium, a second CDP client attached to a page the first had created and crashed it.
- *Seen:* probe 25.
- *We:* nothing yet.
- *Reconsider:* when attaching to browsers others drive is built.
- **Kept**: probe 25's crash was the second client's own `Page.crash`, sent to show the first client sees it: clients share pages, and nothing failed.

**Q70. A page in the background of its context renders nothing on headless Chromium** (Browser). Not only a popup's opener (Q19): a page created after another in the same context puts the first in the background, `hidden`, with no frames, though keys and clicks still reach it. Pages in different contexts, and every WebKit page, keep rendering. The `concurrent` profile's switches don't change it.
- *We:* create each page the library opens as a window of its own (`Target.createTarget{newWindow}`), which keeps it visible and rendering. A popup still opens where its opener's script puts it (Q19).
- *Reconsider:* whether a window per page changes anything a page observes (its window's position and size), and whether headless Chromium will render background tabs.
- **Kept**: `focus: "emulated"` makes a background tab render, and the `NoRenderingOpportunity` hint names it.

**Q71. A page in the background of a Firefox context renders about once a second** (Browser). It is `hidden`, with 3 animation frames in 4 s, two seconds after the other page opened; measured early, one frame came in 150 ms. Two frames never fall in one second-long round, so the stable check never passes, and an action there times out, alternating `NotStable` and `NoRenderingOpportunity`. `layout.throttled_frame_rate` in the launch prefs didn't change it, and creating Firefox pages as windows broke navigation in a probe.
- *We:* don't activate behind the caller's back; the timeout's hint names `page.activate`, after which the action works.
- *Reconsider:* Firefox pages as windows, probed again; or a stable check that spans rounds, which would make such actions slow rather than stuck.
- **Resolved** in `38ce8ff`: Firefox's pages the library creates open as windows, and `automation` adds `browser.link.open_newwindow: 2`, so a popup, or a link that opens a page, opens as a window too. Every page then keeps rendering behind another, and the slice tests act on a page behind another, and on a popup's opener, without `activate`. The navigation that broke in windows was Q178.

**Q72. WebKit's mouse events ignore modifiers** (Browser). Neither the event's modifier flags nor Shift held as a key reach a click's `shiftKey`.
- *We:* `input.pointerModifiers` is `unsupported` on WebKit. A pointer action or `mouse.click` with modifiers, or while one is held, fails with `Unsupported` before anything is sent.
- *Reconsider:* when the build is rolled.
- **Resolved** in `9c8280c`: Playwright's build is no longer driven. Launched stock WebKit's Automation holds a modifier as a key through the click, and a Shift-click reaches the page with `shiftKey` true (`input.pointerModifiers`, `supported`; the slices' interaction case).

**Q73. WebDriver's pointer actions carry no modifier flags** (Browser). Firefox takes modifiers only from keys held in the same actions; Shift held as a key reaches `shiftKey`.
- *We:* hold modifiers as keys on every backend, pressed before the gesture and released after, and set the flags too.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q74. WebDriver's Enter is the numpad's** (Browser). `\uE007` (Enter) arrives in Firefox with `code: "NumpadEnter"`; `\uE006` (Return) is the main Enter.
- *We:* the BiDi adapter sends Return for `Enter`.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q75. BiDi has no command to insert text** (Browser). Text is typed as key actions, so `insertText`, and `fill`, fire key events for each character on Firefox, and on no other backend.
- *We:* `input.insertText` is `partial` on BiDi, saying so.
- *Reconsider:* if BiDi adds one.
- **Kept**: the spec has no command to insert text.

**Q76. Only Chromium can finish an HTML drag, and only when asked to** (Browser). Chromium starts an HTML drag from input only with `Input.setInterceptDrags` on, and only when each move names the button held (`button`, not just `buttons`); it then hands the drag to the client to finish with drag events. Firefox starts one from WebDriver actions and never drops it. WebKit's protocol has no drag commands.
- *We:* the CDP adapter turns interception on with the first move that holds a button, and finishes the drags it intercepts. `input.dragAndDrop` is unsupported elsewhere, so `dragTo` from a draggable element fails there with `Unsupported` before anything is sent. Drags by pointer events work everywhere.
- *Reconsider:* Firefox, if it starts dropping; and whether interception, once on, should stay on for the page's life.
- **Kept**: Firefox starts drags it never drops; Strider refuses `dragTo` up front there.
- **Resolved** in `64f94a7`: `dragTo(target, { html: "synthetic" })` has the page dispatch an HTML drag's events, untrusted, on every backend; the refusal of a native one names it.

**Q77. WebKit fires no `click` after a tap** (Browser). A touch start and end reach the page, with touch pointer events, on all three; Chromium and Firefox follow with compatibility mouse events and `click`, and WebKit doesn't.
- *We:* nothing; `tap` sends the touch, and the page decides.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.
- **Resolved** in `9c8280c`: stock WebKit's Automation has no touch (Q214), so `tap` is refused (`input.touch`).

**Q78. Firefox on the desktop has no touch event interface, yet dispatches touch events** (Browser). `TouchEvent` is undefined and `'ontouchstart' in window` is false, so an `ontouchstart` attribute never runs, but `touchstart` and `touchend` reach `addEventListener` listeners.
- *We:* nothing; a page that detects touch support finds none on Firefox.
- *Reconsider:* whether `tap` should need touch emulation where a page checks for support.
- **Kept**: the *We* line is the decision.

**Q79. What the utility world dispatches is untrusted** (Browser, by design). `selectOption`, and `fill` on an input whose value isn't typed, set the value and dispatch `input` and `change` from the utility world, so the page sees `isTrusted: false`.
- *We:* accept it: a select's popup and a date picker aren't drivable headless, and pages rarely check `isTrusted` on `change`.
- *Reconsider:* choosing an option with keys where a backend can.
- **Kept**: the *We* line is the decision.

**Q150. A page prompts before unloading only once the user has interacted with it** (Browser). `close({ runBeforeUnload: true })` on a page whose `beforeunload` listener asks to stay closes at once, with no prompt, unless something was clicked in it first; after a click, the prompt opens and a handler decides it. The same on all three browsers.
- *Seen:* a probe of an untouched and a clicked page on each backend.
- *We:* `close`'s docs say so, and the tests click before closing.
- *Reconsider:* nothing; it is the browsers' rule against abusive prompts.
- **Kept**: the *We* line is the decision.

**Q186. Chromium and WebKit ignore a `dropEffect` set on a `DataTransfer` a script made** (Browser). In a drag the page dispatches, the `dropEffect` a `dragover` handler sets reaches `dragend` on Firefox; Chromium and WebKit keep `"none"`.
- *Seen:* building `dragTo({ html: "synthetic" })`.
- *We:* `dragend` sees what the browser keeps, which `dragTo`'s Gotchas say.
- *Reconsider:* nothing on our side: the browser owns a `DataTransfer`'s drop effect.

**Q188. WebKit's key events ignore the modifiers held** (Browser). As its mouse events do (Q72): a key typed with Shift held, as a layout's capital is, reaches the page with `shiftKey` false, and the Shift key's own `keydown` too; the character typed is the right one.
- *Seen:* when a German layout's `Y` was typed on every backend.
- *We:* nothing: the text is right, and the flags are WebKit's.
- *Reconsider:* whether WebKit's `Input.dispatchKeyEvent` takes its modifiers another way.
- **Revised** in `9c8280c`: Playwright's build is no longer driven. Launched stock WebKit holds Shift as a key in Automation's sequences; whether its key events then say `shiftKey` wasn't checked. A layout's keys are refused (`input.keyboardLayout`).

**Q189. A WebDriver key action names a key value, never a key's place** (Browser). Firefox picks the `code` for the value as a US keyboard would, and WebDriver has no AltGr and no dead key, so a layout's `z` on `KeyY` arrives as `z` on `KeyZ`.
- *Seen:* when a German layout was typed on every backend.
- *We:* `input.keyboardLayout` is `partial` on Firefox: the BiDi adapter sends each character as its value, leaving out the `AltGraph` and `Dead` strokes, so the page gets the layout's characters with US codes.
- *Reconsider:* reporting it upstream, if WebDriver BiDi grows a key's code or location in its actions.

**Q197. A dialog stops a stock WebKit page's scripts, and nothing reports it** (Browser). Stock WebKit's inspector has no `Dialog` domain: while an `alert` is open, `Runtime.evaluate` waits, and the page's status shows no prompt.
- *Seen:* in the first probe of the protocol and again through the library.
- *We:* `prompts` is `unsupported`; an operation on the page waits until its deadline, and `WebKit.layerAttach`'s documentation says a person must dismiss the dialog.
- *Reconsider:* nothing on stock WebKit.
- **Revised** in `1548837`: launched in automation mode, Automation says a dialog is open, and the adapter asks every 100 ms, so it is reported, as `Dialog.Unknown` (Q206), and answered; attached, it still stops the page unreported.

**Q206. Stock WebKit's Automation says a dialog is open, and its message, but not its kind** (Browser). `isShowingJavaScriptDialog` and `messageOfCurrentJavaScriptDialog` answer; nothing announces a dialog, and nothing says whether it is an alert, a confirm, a prompt or a `beforeunload`, or a prompt's default value. The browser knows both, and reports them only to its WebDriver BiDi, which is compiled out (Q204).
- *Seen:* Q207's measurement.
- *We:* symbolic breakpoints would name the kind, but their cost is Q207's, so the adapter asks every 100 ms whether a dialog is open and reports it as `Dialog.Unknown`, with its message.
- *Reconsider:* when WebKitGTK ships its WebDriver BiDi, whose `userPromptOpened` has both.
- **Revised** in `508e013`: `prompts.kind`, new on every backend, is `unsupported` here, and input that opens a dialog returns once it's decided, as on every backend (Q224).

**Q207. A debugger slows a stock WebKit page's JavaScript by about 80%, and a symbolic breakpoint can't see a native call's arguments** (Browser). With `Debugger.enable`, a benchmark of loops, sorting, strings, DOM and recursion ran in 38 ms instead of 21 (median of seven); symbolic breakpoints on `alert`, `confirm` and `prompt` added nothing more. A breakpoint's probe names the dialog's kind, but it fires for any function of that name, the page's own included, and evaluates in the caller's frame, where `arguments` doesn't exist, so a prompt's default value can't be read.
- *Seen:* against WebKitGTK 2.54.1's MiniBrowser.
- *We:* the adapter attaches no debugger to learn dialogs' kinds (Q206).
- *Reconsider:* nothing.

**Q212. Stock WebKit names no opener for a page a page opens** (Browser). Neither its target list, its `Target` domain nor Automation's browsing contexts say which page opened another.
- *We:* launched, a page the connection didn't ask for is reported opened, with no opener: `Popup` events of a context see it, a page's own don't.
- *Reconsider:* reading `window.opener` where the popup is same-origin.
- **Revised** in `508e013`: `Popup.next`, `stream` and `history` fail at once with `SubscriptionError{Unsupported}`, naming `popups.opener`, new on every backend, rather than waiting out their deadline.

**Q214. WebKitGTK's Automation builds no touch, and a mouse state makes an event only when it names its interaction** (Browser). `ENABLE_WEBDRIVER_TOUCH_INTERACTIONS` is off for WebKitGTK, and the dispatcher's touch path is a release assertion; a mouse source's state with a button and a location but no `mouseInteraction` moves nothing.
- *Seen:* the first clicks didn't reach the page; WebKitGTK 2.54.1's `OptionsGTK.cmake` and `SimulatedInputDispatcher.cpp`.
- *We:* each event is a step naming its interaction (`Move`, `Down`, `Up`), each step declares only the sources it uses, never a touch one, and touch input is refused.
- *Reconsider:* nothing.
- **Revised** in `508e013`: an input call is one sequence, a step per event, declaring the keyboard, the mouse and the wheel, so a double click is one (Q223); touch is refused under `input.touch`, new on every backend.

**Q223. WebKitGTK's Automation forgets a click at each sequence's end, keeps each input source's state across sequences, and types no newline** (Browser). `performInteractionSequence` clears the click count as it finishes (`SimulatedInputDispatcher::finishDispatching`, citing w3c/webdriver#1772), so a second click sent in a sequence of its own is never a double click; a wheel scrolls by the difference between its state and the one before, which outlives the sequence, so a second scroll by the same amount scrolls nothing; and `InsertByKey` with a newline inserts nothing.
- *Seen:* the slices' `dblclick`, `mouse.click` with `clickCount: 2`, a second `mouse.wheel`, and `fill("one\ntwo")` into a `textarea`.
- *We:* one `dispatchInput` is one sequence, a step per event; each browser process's wheel state is kept, and each scroll adds to it; a newline in inserted text is pressed as Enter, which in a form's `input` submits it, where the other backends insert nothing.
- *Reconsider:* the newline in an `input`, if a use fills one with text that has one.

**Q224. Stock WebKit's Automation finishes input that opens a dialog at once** (Browser). When a dialog opens, Automation answers the input pending on the page (`WebAutomationSession::willShowJavaScriptDialog`), so a click whose handler calls `confirm` returns before the dialog is decided, where every other backend's returns after, and the dialog is reported only when asked (Q206).
- *Seen:* on a page with `dialogs: "leaveOpen"`, a click that opened a `confirm` succeeded, rather than failing with `PromptBlocking`.
- *We:* after each input, the adapter asks whether a dialog is open; if one is, it reports it and waits until it's decided, so input returns once its dialog is decided, as on every backend.
- *Reconsider:* nothing.

## Browsers: downloads and file choosers

**Q25. Each browser does something different with a download nobody configured** (Browser). Chromium cancels it; Firefox and WebKit save it into `$HOME/Downloads` (WebKit without reporting the path).
- *We:* give every context the library creates a temporary download directory, removed after it. The default context keeps the browser's behaviour.
- *Reconsider:* a `downloads: "deny"` option, and what attached browsers' contexts should do.
- **Kept**: the *We* line is the decision.
- **Resolved** in `6ff530c`: `UserContext.Options.downloads` is `"temporary"` (as before), `"deny"`, or `{ directory }` the caller owns; the CLI's sessions download into their own `downloads/`.
- **Revised** in `9c8280c`: WebKit's part was Playwright's build's. Stock WebKit reports no downloads, and its contexts get no download directory (`downloads`, `unsupported`; Q220).

**Q26. Every browser writes a download into a partial file of its own naming** (Browser). `<guid>.crdownload` (Chromium), `<name>.<random>.bin.part` beside an empty `<name>` (Firefox), `<uuid>.wkdownload` beside an empty `<uuid>` (WebKit), renamed when done.
- *We:* read a download's bytes only once it completes; `Download.stream` can't deliver them as they arrive.
- *Reconsider:* streaming from the partial file per backend.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: WebKit's part was Playwright's build's; stock WebKit reports no downloads.

**Q27. Only Chromium reports a download's progress, and only CDP and WebKit can cancel one** (Browser).
- *We:* capabilities `downloads.progress` and `downloads.cancel`; `cancel` fails with `Unsupported` on BiDi.
- *Reconsider:* when BiDi adds them.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: stock WebKit reports no downloads, so only CDP cancels one (`downloads.cancel`, `unsupported` on WebKit).

**Q28. A download in progress when its context goes is reported three ways** (Browser). Chromium: canceled. Firefox: nothing at all. WebKit: *completed*, with an empty file.
- *We:* the context's end makes it `Canceled`, and the fold ignores what the backend says after.
- *Reconsider:* nothing; WebKit's report is wrong.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: WebKit's part was Playwright's build's; stock WebKit reports no downloads.

**Q29. Firefox leaves a canceled file chooser open** (Browser). With `unhandledPromptBehavior.file: "ignore"`, a chooser nothing decides stays open, and the page's later clicks open nothing.
- *We:* set `file: "dismiss"`, so every chooser is dismissed as it opens; the input gets a `cancel` event before any decision, and files set after it still arrive with `input` and `change`. `fileChooser` is `partial` on BiDi.
- *Reconsider:* whether BiDi gains a way to answer a chooser without the page seeing `cancel`.
- **Kept**: the *We* line is the decision.

**Q30. A file input clicked with no interception does three different things** (Browser). Headless Chromium fires `cancel` at once; WebKit does nothing; Firefox reports it anyway.
- *We:* arm interception on every page of a context the library creates.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q31. `input.showPicker()` opens a chooser on Chromium, not on WebKit** (Browser). Firefox wasn't probed (Q29 left its picker open).
- *We:* nothing.
- *Reconsider:* probe Firefox now that it dismisses.
- **Kept**: Firefox opens a chooser for `showPicker()` and reports it with `input.fileDialogOpened`; only WebKit doesn't.

**Q32. WebKit's `downloadCreated` names a frame id that isn't the page's** (Browser).
- *Seen:* WebKit probe 15.
- *We:* attribute the download to the page.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.
- **Resolved** in `9c8280c`: `downloadCreated` was Playwright's build's; stock WebKit reports no downloads.

## Browsers: console, exceptions and workers

**Q33. Console text is formatted differently** (Browser). Firefox applies format specifiers (`%s`, `%d`), Chromium and WebKit don't; objects render as their class name (`Object`, Firefox's `Object(2)`); `console.count()` is `debug` on WebKit and `log` elsewhere; `console.timeEnd` of an unknown timer is a warning on Chromium and WebKit and a log on Firefox, each worded differently.
- *We:* report the browser's text and level as they are.
- *Reconsider:* formatting from the arguments ourselves, which needs their handles.
- **Resolved** in `c790129`: the library applies the Console Standard's formatter (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, `%c`) to the arguments CDP and WebKit report (`internal/consoleFormat.ts`), as Firefox applies its own. Two differences stay. Firefox writes `%f` as printf does (`1.250000`, not `parseFloat`'s `1.25`) and sends its formatted text as the call's only argument, so nothing can reformat it (reported: `upstream/firefox-console-args-formatted.md`). And objects read as each browser describes them: WebDriver BiDi serializes an `Error` without its message, so rendering them one way would drop Chromium's error messages.
- **Reported**: drafted in `upstream/firefox-console-args-formatted.md`, not sent.

**Q34. Console locations have different bases and columns** (Browser). Chromium's and Firefox's lines and columns are 0-based, WebKit's 1-based; the column points at the call's property on Chromium and its parenthesis on WebKit.
- *We:* convert to 1-based on CDP and BiDi; columns stay where each engine puts them.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q35. A thrown value that isn't an Error is reported badly** (Browser). For `throw "a string"`, Chromium's exception has no description (the text is `Uncaught`), or no exception object at all when a timer an evaluation set throws (the text is `Uncaught a string`); Firefox's text is `uncaught exception: a string`.
- *Seen:* a conformance test.
- *We:* report an `Error` whose message is the value, on every backend.
- *Reconsider:* keeping the value's type (string, number) somewhere.
- **Kept**: the *We* line is the decision.

**Q36. Firefox can't tell an unhandled rejection from a throw** (Browser). Its log entry has no `Uncaught (in promise)` marker and no stack for a rejection.
- *We:* `kind: "unknown"` on Firefox; `exceptions.kind` is `partial`.
- *Reconsider:* when BiDi distinguishes them.
- **Kept**: the *We* line is the decision.

**Q37. Workers are reported unevenly** (Browser). Chromium reports dedicated, shared and service workers with their context, and evaluates in all. Firefox reports all three, names a dedicated worker's owner realm but not its page, has no context for shared and service workers, can't evaluate in any ("Realm with id … not found"), attributes a dedicated worker's console to its page's realm, and reports no console from shared or service workers. WebKit reports dedicated workers only.
- *Seen:* BiDi probe findings.
- *We:* name a dedicated worker's page from its owner on BiDi; capabilities `workers.shared`, `workers.service`, `workers.evaluate`; `console` `partial` on BiDi.
- *Reconsider:* when Firefox can evaluate in workers or name their context.
- **Kept**: the *We* line is the decision.

**Q38. A worker's requests are attributed to its page on Firefox and WebKit** (Browser). Chromium names the worker as the initiator; Firefox and WebKit name the page's document. WebKit also types a worker's script load as `xhr`, and sends it on the page's target before `workerCreated`.
- *Seen:* WebKit probe findings.
- *We:* report what each says.
- *Reconsider:* correlating by URL, which would be a guess.
- **Kept**: the *We* line is the decision.

**Q121. Chromium's exception text ends with the stack** (Browser). An evaluation that throws `TypeError("boom")` is described as `TypeError: boom\n    at <anonymous>:2:12`; Firefox and WebKit give the message alone.
- *We:* `EvaluationThrown`'s message drops the trailing `at` lines, which `stack` has.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q187. A Chromium dedicated worker paused at start has no timers yet** (Browser). Attached waiting for the debugger, its global has `Date` and `performance` but no `setTimeout`, `setInterval`, their clears or `reportError`, which appear once it starts; a script run there can't wrap them.
- *Seen:* when the page clock in workers ran there and found no `setTimeout` to replace.
- *We:* a dedicated worker that gets init scripts is resumed with a `beforeScriptExecution` instrumentation breakpoint set, and the scripts run where it pauses, before the worker's first script, with its global whole; then the debugger is disabled.
- *Reconsider:* nothing, unless Chromium installs the timers earlier.

## Browsers: network

**Q39. A redirect hop's body is asked for with an id the adapters never minted** (Ours, found in the adapters). Asking any adapter for a 302 hop's body failed as `Foreign`.
- *We:* `BodyUnavailable{redirect}` without asking the browser.
- *Reconsider:* fixing the adapters' hop tables so the error, if asked, is honest.
- **Resolved** in `a7ee8dc`: the adapters keep a redirect's earlier hop ids, so a body read for one answers `Unsupported{body.redirect}`, and the conformance suite asks.

**Q40. An event stream's body never finishes, so reading it waits forever** (Browser). On all three.
- *We:* bound the wait by the deadline (`next`) or `Deadline.DefaultBudget` per body (`stream`), then `BodyUnavailable{streaming}`.
- *Reconsider:* recognizing streaming responses from their headers instead of waiting.
- **Resolved** in `a7ee8dc`: a response whose content type is `text/event-stream` is `BodyUnavailable{streaming}` as soon as its body is asked for.

**Q41. EventSource and WebSocket support differ** (Browser). Only Chromium reports an EventSource as a connection with its messages (and only from its first message); WebKit and Firefox report only its request (`eventSource`, or Firefox's `other`). Firefox reports a WebSocket only as its handshake, an `http:` request answered 101, with no frames and no close.
- *We:* capabilities `networkConnections` and `networkConnections.eventSource`; subscribing where they're missing fails with `Unsupported`.
- *Reconsider:* synthesizing Firefox's connections from the handshake if BiDi adds a close event.
- **Kept**: the *We* line is the decision.

**Q42. WebKit reports a WebSocket's close handshake as binary frames** (Browser). Two frames, opcode 8, reported as messages.
- *We:* drop control frames (opcode 8 and above) on CDP and WebKit.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q43. Who served a response is reported differently** (Browser). Chromium marks a cache hit with `requestServedFromCache` and `fromDiskCache: false`; Firefox sets `fromCache` for service-worker responses too; WebKit says `source` exactly, and has an `unknown`. A script reused from the memory cache within a document makes no request on Chromium and WebKit; Firefox reports it.
- *Seen:* probes 7.
- *We:* `servedBy` with `cacheOrServiceWorker` for Firefox's case and `unknown` for WebKit's.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.

**Q44. WebKit's intercepts don't see a page a service worker controls** (Browser). Even the requests the worker passes to the network.
- *Seen:* probe 7.
- *We:* `interception.request` and `.response` are `partial` on WebKit.
- *Reconsider:* when routes are built.
- **Kept**: the *We* line is the decision.

**Q45. BiDi can't scope an intercept to a user context** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* intercept browser-wide and filter in the adapter.
- *Reconsider:* when BiDi adds the scope.
- **Kept**: WebDriver BiDi's `network.addIntercept` still has no user contexts to scope it to.

**Q46. Chromium's interception tests flake under full load** (Ours, a test flake). Occasionally a request isn't paused, or a fulfilled one reads as served by the network, when the whole integration suite runs at once.
- *Seen:* integration runs; traced in Q103.
- *We:* nothing yet; listed in PROTOCOL.md.
- *Reconsider:* find whether an intercept declaration is acknowledged before it is in force (CONCEPTS.md §7, Installation), when routes are built.
- **Resolved** in `e7821c1`: the declaration was acknowledged before it was in force, apparently because `Fetch` enabled with no patterns gave up its interceptor. Q103 says what we do now.

**Q89. Only Chromium shows a route the CORS preflight** (Browser). A cross-origin `PUT` with a custom header pauses first as an `OPTIONS` request on Chromium; Firefox and WebKit pause only the `PUT`. A fulfilled cross-origin response needs CORS headers on all three.
- *We:* show what Chromium shows: a route matching cross-origin requests on Chromium answers their preflights, or lets them continue to the server.
- *Reconsider:* answering a preflight for a route that fulfills its request, as Playwright does, which would hide a request the page made.
- **Kept**: the *We* line is the decision.

**Q90. WebKit pauses a redirect's first hop only, and won't follow a redirect a route fulfills** (Browser). A fetch fulfilled with `302` and `Location` gets the `302` itself, while Chromium and Firefox follow it and pause the target as the next hop.
- *We:* `interception.redirects` is `partial` on WebKit.
- *Reconsider:* when the build is rolled.
- **Kept**: the *We* line is the decision.

**Q91. Only CDP fails a request with the reason asked for** (Browser). Firefox reports `NS_ERROR_ABORT` for every reason, and WebKit "Blocked by Web Inspector".
- *We:* `Route.abort()` is `failed` everywhere; another reason is `interception.abortReason`, CDP's alone.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q92. Firefox aborts a request continued with a new URL, and keeps the old length with a new body** (Browser). The body arrives broken unless its `Content-Length` is sent too.
- *Seen:* through the adapter and raw BiDi.
- *We:* a new URL is `Unsupported` (`interception.continueUrl`); the BiDi adapter sends a new body's length.
- *Reconsider:* when Firefox implements `url`.
- **Reported**: drafted in `upstream/firefox-continue-request.md`, not sent.

**Q93. Firefox can't fulfill at the response phase, and leaves a request it refused paused** (Browser). `network.provideResponse` there answers `unsupported operation`; a continue with new headers replaces the response's.
- *We:* refuse it up front (`interception.responseFulfill`), so the default continues the request.
- *Reconsider:* a response-phase decision that changes headers only, which Firefox and CDP can do.
- **Kept**: a response-phase decision that changes headers only is among the declared pieces still unbuilt.
- **Resolved** in `f223b83`: `Route.continueWith({ status, headers })` at the response phase sends the response on with its status or headers replaced, on CDP and BiDi (`interception.responseHeaders`); WebKit can't, since it can't read the paused response. Fulfilling there stays CDP's and WebKit's.

**Q94. Only CDP can read a response paused at the response phase** (Browser). WebDriver BiDi has no body as a response starts, and Playwright's WebKit no command for it.
- *We:* `interception.responseBody` is CDP's alone; patching a response's body works on Chromium only.
- *Reconsider:* when either protocol adds one.
- **Kept**: the *We* line is the decision.

**Q95. Firefox's default answer to a challenge waits forever, headless** (Browser). `continueWithAuth{action: "default"}` shows its prompt, which nothing answers.
- *We:* the default at a challenge is the challenge's response (`CancelAuth`), never the browser's prompt.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q96. Chromium asks about a challenge only for a request intercepted as it starts, and lowercases its scheme** (Browser). With a response-stage pattern it pauses the `401` as a response and refuses credentials for it.
- *We:* auth patterns pause at the request stage, where a request nothing else wants continues at once; schemes are lowercased on every backend.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q97. Chromium refuses a `Content-Length` header in a continued request** (Browser). `Fetch.continueRequest` answers "Unsafe header: content-length", and computes the length itself.
- *We:* routes never send it; the BiDi adapter sends it, since Firefox doesn't compute it (Q92).
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q98. A paused request's resource type differs from its events'** (Browser). Chromium's `Fetch` calls a `fetch()` an `XHR`, where its `Network` events say `Fetch`; WebKit's pause carries no type.
- *We:* a paused request takes the type its network events gave it, where they came first.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q158. Chromium leaves `Cookie` and `Set-Cookie` out of its network events** (Browser). `requestWillBeSent` and `responseReceived` carry the headers a page may see; the ones the network sent and received, cookies included, come in `requestWillBeSentExtraInfo` and `responseReceivedExtraInfo`, before or after them, by request id.
- *Seen:* a HAR of a page that set a cookie had none on Chromium.
- *We:* the CDP adapter reports them as a hop's own headers (`HopHeaders`), which recordings prefer; `NetworkRequest` and `NetworkResponse` keep the headers the main events give. An `ExtraInfo` that comes before its request waits for it; one for a redirect's next hop that comes before that hop starts is given to the hop before.
- *Reconsider:* holding a response until its `ExtraInfo` arrives, as Playwright does, so every event has the headers sent.
- **Resolved** in `fa0a3a9`: the CDP adapter holds a response whose `responseReceived` says `hasExtraInfo` until its `ExtraInfo` arrives, with the hop's end if it comes first, and reports it with the headers received, so `NetworkResponse.headers` has `Set-Cookie` on every backend. Only a response from the network waits: one from a cache announced by `requestServedFromCache` said `hasExtraInfo` and got none. A request that fails, a navigation that ends or commits, and a request retired from the table (Q177) release what was held. Requests keep the headers their main event gives: nothing says an `ExtraInfo` will follow one.
- **Resolved** in `f223b83`: `NetworkRequest.headersSent(target, request)` waits for a request's headers as sent, cookies included, which on Chromium come in the `ExtraInfo` a response's `hasExtraInfo` promises, or are the request event's when it promises none; elsewhere they are known with the response (Q181) or at once. A request event's `headers` stay what it gave.

**Q159. Chromium never ends a favicon request cut off by the next navigation** (Browser). The page's favicon request, started as one document loaded and cut off by a `goto`, gets no response, no `loadingFinished` and no `loadingFailed`.
- *Seen:* in a HAR on Chromium.
- *We:* a HAR marks it `_incomplete`; `inFlightAtStop: "wait"` waits for it until the deadline.
- *Reconsider:* ending a request with its document, if a protocol event allows it.
- **Reported**: drafted in `upstream/chromium-favicon-never-ends.md`, not sent.

**Q160. Chromium forgets a document's bodies once the page navigates on** (Browser). `Network.getResponseBody` for the document a page just left fails "No resource with given identifier found", or "Missing resource for given requestId".
- *Seen:* a HAR recording two navigations in a row.
- *We:* a HAR records that entry without its body.
- *Reconsider:* reading a document's body as its response finishes, before the next commit, if recordings need them.
- **Resolved** in `fa0a3a9`: where a body collection is declared, as a recording or a body read declares one, the CDP adapter configures durable messages for the page (`Network.configureDurableMessages`, ten bodies' worth at the collection's limit each), which keep a document's body past the next navigation. WebKit forgets it too, with nothing to keep it by (Q179).

**Q161. A page can read a response before the browser reports its hop finished** (Browser). A `fetch` resolved and its text shown in the page, and Chromium's `loadingFinished` for it hadn't arrived yet.
- *Seen:* a HAR exported right after the page showed what it fetched.
- *We:* an export waits for the bodies of the hops that ended, never for one in flight: that entry is `_incomplete`. A program that needs it waits with `NetworkResponse.next` and a body, which waits for the hop's end.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q166. WebKit says a response's protocol only as it ends** (Browser). `responseReceived` has the status text but no protocol; `loadingFinished.metrics.protocol` has it. CDP and Firefox say it with the response.
- *We:* `NetworkResponse.httpVersion` is `None` on WebKit, and a HAR takes the protocol from the hop's end.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q179. WebKit forgets a document's body once the page navigates on** (Browser). As Chromium did (Q160): a HAR recording two `goto`s in a row has no body for the first document on WebKit, whose protocol has nothing like Chromium's durable messages.
- *Seen:* when the HAR test began asking for that body on every backend.
- *We:* the entry has no body.
- *Reconsider:* reading a document's body in the adapter as its load finishes, where a body collection is declared, before the next commit can clear it.
- **Resolved** in `f223b83`: where a body collection covers the page, the WebKit adapter reads a document's body as its load finishes, and a recording's read gets that.

**Q181. WebKit leaves `Cookie` out of its request events, and a redirect's response has no request headers** (Browser). As Chromium does (Q158), `Network.requestWillBeSent` carries the headers the page set; the ones sent, cookies included, come as the response's `requestHeaders`, which a redirect's response has empty.
- *Seen:* when `NetworkRequest.headersSent` was asked for a cookie on every backend.
- *We:* the WebKit adapter reports a hop's headers sent with its response, from `requestHeaders`, or the request event's where those are empty; so a redirect's hop has no `Cookie` there.
- *Reconsider:* nothing on our side: the protocol reports them nowhere else.

**Q182. Chromium's request event leaves a file's bytes out, and keeps only a request's last body** (Browser). `requestWillBeSent` says `hasPostData` for a multipart body holding a `Blob` but carries no `postDataEntries`; `Network.getRequestPostData` reads it, but only for the request's latest hop: after a `302` turned a `POST` into a `GET`, it answers `No post data available` for the request.
- *Seen:* a probe of request bodies (a form, 200 KB, a `307`, a `302` and a file).
- *We:* the CDP adapter keeps each hop's body as its event carried it, where a body collection covers the page and it fits the limit, and reads one the event didn't carry by the request's id, for the last hop only; an earlier hop's is `Unsupported` (`body.redirect`), and a recording leaves it out.
- *Reconsider:* nothing: the event carried every body the probe sent but the file's.

**Q183. Firefox's request data is a request's first body, even for a hop that sent none** (Browser). `network.getData({ dataType: "request" })` for a request whose `302` turned it into a `GET` gives the `POST`'s body.
- *Seen:* a probe of request bodies.
- *We:* the BiDi adapter keeps each hop's `bodySize` from `beforeRequestSent`, and a hop that sent none has no body without asking.
- *Reconsider:* reporting it upstream, if the spec means a hop's data; it says a request's.

**Q184. WebKit leaves a file's bytes out of a request's body** (Browser). `Network.requestWillBeSent`'s `postData` for a multipart body holding a `Blob` has the part's headers and an empty body.
- *Seen:* when the HAR test sent a file on every backend.
- *We:* a recording keeps the body as WebKit gave it.
- *Reconsider:* nothing on our side: the protocol has no other report of a request's body.

**Q221. Stock WebKit gives a request's body as text, where Playwright's build gives base64** (Browser). The protocol says the same of both, "HTTP POST request data", but Playwright's build encodes the bytes in base64, and stock WebKit decodes them as UTF-8, or as Latin-1 where they aren't UTF-8 (`String::fromUTF8WithLatin1Fallback`). Bytes that aren't UTF-8 can't be told from text that was.
- *Seen:* the conformance suite's paused `POST` of `hello` had an empty body on stock WebKit, read as base64.
- *We:* on stock WebKit, a request's body is the text encoded as UTF-8, so a text body is exact and a binary one may not be.
- *Reconsider:* nothing on our side: the protocol has no other report of a request's body.

**Q226. WebKitGTK reports no `Cookie` among the headers a request was sent with** (Browser). The request event leaves it out, as Playwright's build's does (Q181), and the response's `requestHeaders`, where Playwright's build has the headers as sent, has none either.
- *Seen:* the recordings slice's `NetworkRequest.headersSent` had no `cookie` on stock WebKit.
- *We:* `network.headersSent` is `partial` on stock WebKit, saying so.
- *Reconsider:* nothing on our side: the protocol has no other report of the headers sent.

**Q252. A challenge no route answers ends differently on each browser** (Browser). Strider intercepts a challenge only for an `auth` route, so with none the browser answers it. Headless Chromium fails the navigation with `net::ERR_INVALID_AUTH_CREDENTIALS`, without the server's `401` page; Firefox opens its own prompt, which nothing answers (Q95); and stock WebKit's MiniBrowser never commits the navigation, with no dialog reported.
- *Seen:* a `goto` of the harness's `/auth` with no route, on each backend: Chromium's failed at once, Firefox's timed out `dispatchedUnconfirmed` and WebKit's `postcondition`. A request-phase route on another URL changed nothing on Chromium or Firefox.
- *We:* nothing: Routes, "HTTP authentication", says what each browser does, and an `auth` route that continues gives Chromium and Firefox the server's `401` page.
- *Reconsider:* intercepting every challenge on Chromium and Firefox and canceling those no route answers, so the page gets the server's response, and a timeout never stands for a prompt.
- **Resolved** in `ed32f3d`: every context the library creates declares `Challenges` where the backend can pause a challenge (`network.challenges`), so one no route answers is canceled, and the page gets the server's response, its `401` page included, with `goto` committed at that status. Chromium pauses every document for it, so a navigation's or a frame's challenge is answered and a `fetch`'s or a subresource's still waits (Q254); Firefox pauses every challenge, which pauses nothing else; stock WebKit can pause none (Q255). A context the library didn't create, such as an attached browser's own, keeps the browser's answer.

**Q254. Chromium asks about a subresource's challenge only when every request is paused** (Browser). Chromium raises `Fetch.authRequired` only for a request intercepted as it starts (Q96), so a `fetch`, an image or a script that gets a challenge nothing intercepted waits on Chromium's prompt, which headless never shows: the `fetch` never settles. A navigation's fails `net::ERR_INVALID_AUTH_CREDENTIALS` instead (Q252).
- *Seen:* a `fetch` of the harness's `/auth`, with no route, still pending at its 6-second abort. With an `auth` route on `**`, which pauses every request at the request stage, 200 `fetch`es one after another took about 200 ms in the page rather than 165, a round trip of about 0.17 ms each over the local pipe; 300 images loaded at once took the same time either way.
- *We:* `Challenges` pauses every document at the request stage (`resourceType: "Document"`), which costs a navigation one round trip, and leaves other requests alone, so a subresource's challenge waits as before; `network.challenges` is `partial` on Chromium, saying so. An `auth` route on the subresource's URL answers it.
- *Reconsider:* pausing every request in a context the library creates, if a round trip per request proves negligible where it matters; over a remote endpoint each would cost a network round trip.

**Q255. Stock WebKit's MiniBrowser waits on a challenge that nothing it speaks can answer** (Browser). WebKitGTK asks its view to authenticate; under automation the MiniBrowser opens no dialog it reports and answers nothing, and neither the inspector protocol nor Automation has a command that answers or cancels a challenge, so the navigation never commits.
- *Seen:* a `goto` of the harness's `/auth` timed out `postcondition`, and a `fetch` of it was still pending at its 6-second abort.
- *We:* `network.challenges` is `unsupported` there, so a context declares nothing, and an `auth` route fails with `Unsupported` (`interception.auth`); a page behind HTTP authentication times out.
- *Reconsider:* credentials given in advance, the one way WebKit's API answers a challenge, if the MiniBrowser's automation comes to expose it.

## Browsers: emulation, permissions and declarations

**Q47. WebKit's init scripts run in the main world only** (Browser). `Page.setBootstrapScript` has no world.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* an init script for an isolated world is `Unsupported` there.
- *Reconsider:* when init scripts are built at L2.
- **Kept**: the *We* line is the decision.

**Q48. WebKit's locale reaches only new web processes, and a document caches its user agent** (Browser). `Playwright.setLanguages` doesn't reach a process already running; `navigator.userAgent`, once read, keeps its value until the next navigation.
- *Seen:* WebKit probe findings.
- *We:* a locale declared for pages that exist is `Unsupported`; a user-agent override reaches a document only at its next navigation.
- *Reconsider:* when emulation is built at L2.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: Playwright's build is no longer driven. Stock WebKit refuses a locale (`emulation.locale`, Q218) and a user agent (`emulation.userAgent`, Q209) as they're declared.

**Q49. WebKit's viewport is a resize with nothing to clear** (Browser). `setDeviceMetricsOverride` resizes the view (0 by 0 empties it); WPE headless starts at 1024 by 768.
- *Seen:* WebKit probe findings.
- *We:* measure the size before the first resize and restore it.
- *Reconsider:* nothing yet.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: launched stock WebKit's viewport is its window's size (Automation's `setWindowFrameOfBrowsingContext`): the window's size before the first resize is kept, and restored when the viewport is released; attached, a viewport is refused.

**Q50. Firefox's permissions have no reset; WebKit's are per page** (Browser).
- *Seen:* PROTOCOL.md, Built for BiDi and WebKit.
- *We:* set the ones granted back to `prompt` on Firefox; reset clears every grant in the context on WebKit.
- *Reconsider:* when grants are built at L2.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: WebKit's part was Playwright's build's; stock WebKit grants no permissions (`permissions`, `unsupported`).

**Q51. Firefox lacks several commands** (Browser). A navigation referrer, media-feature overrides and focus emulation answer `unknown command`.
- *Seen:* PROTOCOL.md, Built for BiDi.
- *We:* `Unsupported`, named by the method.
- *Reconsider:* on each roll.
- **Kept**: the *We* line is the decision.

**Q52. Chrome prints PDFs only headless, and WebKit not at all** (Browser).
- *Seen:* capability profiles.
- *We:* `pdf` is `unknown` for headful Chrome and `unsupported` on WebKit.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q99. Firefox 158 lacks most of `emulation`** (Browser). Media features, touch, scripting and focus emulation answer `unknown command`; a mobile viewport has no flag; an unavailable position is rejected; and every-origin grants and four of the common permission names (`clipboard-read`, `clipboard-write`, `background-sync`, `local-fonts`) aren't WebDriver BiDi's or Firefox's.
- *We:* each is refused up front under the capability named for its field, and a name Firefox rejects fails with `InvalidInput`.
- *Reconsider:* when Firefox implements them.
- **Kept**: the *We* line is the decision.

**Q100. WebKit's emulation is uneven** (Browser). Its touch override changes nothing a page sees (no touch points, `ontouchstart` always there), it ignores an unavailable position, it sets locale and position per context, the locale only before the context's pages exist, a mobile viewport reloads at 979 CSS px and a device pixel ratio of 0.82, `navigator.userAgent` changes only at the next document, a page reports `hasFocus()` false and `prefers-reduced-motion: reduce` without emulation, and every permission name is accepted though its Permissions API can query few.
- *We:* refuse touch and an unavailable position; say the rest in the capability entries' limitations.
- *Reconsider:* when the build is rolled.
- **Kept**: the *We* line is the decision.
- **Revised** in `9c8280c`: Playwright's build is no longer driven. Stock WebKit applies media and JavaScript emulation, and launched a viewport as its window, and refuses every other override under its capability as it's declared.

**Q101. An init script runs before the document has an element, and on Firefox inside a function** (Browser). `document.documentElement` is null on every backend; WebDriver BiDi's preload scripts are functions, so a script's top-level `var` and function declarations aren't globals there, as they are on CDP and WebKit.
- *We:* document both; a BiDi preload keeps which scripts ran under a `Symbol.for` key a page could find.
- *Reconsider:* evaluating a Firefox script's source at global scope, if the page's CSP allows it.
- **Kept**: the *We* line is the decision.

**Q209. On stock WebKit, `Page.overrideUserAgent` answers, but the document keeps its user agent, and there is no network throttling** (Browser). After the override, `navigator.userAgent` in the loaded document is unchanged; `Network.setEmulatedConditions` is "not found" in WebKitGTK 2.54.1.
- *We:* the capabilities list a user agent for the document already loaded, and throttling, as unsupported.
- *Reconsider:* whether requests carry the override.
- **Revised** in `508e013`: launched, an override stock WebKit can't apply is refused under its capability, the user agent's (`emulation.userAgent`) and throttling's among them, where before some were ignored.

**Q218. A launched MiniBrowser takes its time zone at launch and its language from neither the environment nor the protocol** (Browser). `--time-zone` sets the page's time zone, and nothing changes it after; `LANG`, `LANGUAGE` and `LC_ALL` leave `navigator.language` `en-US`.
- *We:* `emulation.locale` and `emulation.timezone` are `unsupported` on stock WebKit: a context's options reach the adapter after its process starts.
- *Reconsider:* passing a new context's time zone to its process at launch.

## Browsers: frames, captures and storage

**Q110. Chromium renders nothing in a cross-site frame outside the viewport** (Browser). No animation frame runs in an out-of-process iframe that is scrolled out of view, so an action in it saw no rendering opportunity and timed out with `NoRenderingOpportunity`.
- *Seen:* an iframe 2000 px down a page.
- *We:* an action scrolls each iframe on its way into view in its parent before its checks run (the engine's `element` with `scroll`).
- *Reconsider:* whether Firefox and WebKit throttle the same way under other conditions, and whether an expectation in such a frame needs the scroll too (it waits on mutations, so it hasn't).
- **Kept**: the *We* line is the decision.

**Q111. Firefox doesn't deliver page coordinates into a cross-site frame** (Browser). A click at page coordinates over a cross-site iframe reaches nothing in it, not even `pointerdown`, though the page's hit test at the point is the iframe; the same click sent to the frame's own browsing context, in the frame's coordinates, lands. Chromium and WebKit deliver page coordinates into every frame.
- *We:* input names the frame and its origin; the BiDi adapter subtracts the origin and sends to the frame's context, and keyboard input goes there too.
- *Reconsider:* a drag between documents on Firefox, which is sent to the source's frame.
- **Reported**: drafted in `upstream/firefox-cross-site-frame-input.md`, not sent.

**Q112. No backend reports a frame's name** (Browser). The frame tree each protocol gives has ids and URLs; a frame's `name` is its document's `window.name`, which only its document can read.
- *We:* `FrameTree.name` is `None`.
- *Reconsider:* reading `window.name` in each frame's document when `page.frames` is read, if anyone needs it.
- **Kept**: the *We* line is the decision.

**Q113. Firefox's full-page screenshot is narrower by the scrollbar** (Browser). A 400 px viewport captures 776 px wide at 2×, where Chromium and WebKit capture 800.
- *We:* nothing; the test checks the height only.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q114. Firefox refuses a clip beyond the root element's box** (Browser). BiDi's `document` origin is the root element's box, which on a short page in quirks mode is its content's height, so a clip in the viewport's empty part fails ("The dimensions of requested screenshot are incorrect, got … height: 0"). Chromium and WebKit capture it.
- *Seen:* a page without a doctype.
- *We:* nothing; the browser's error is the capture's `BackendFailure`.
- *Reconsider:* capturing with BiDi's `viewport` origin, translated by the scroll offset, when the clip is inside the viewport.
- **Resolved** in `a7ee8dc`: a clip inside the viewport is captured with BiDi's `viewport` origin, offset by the scroll position; a slice test captures one below a short page in quirks mode.

**Q115. WebDriver BiDi captures device pixels only, with no background override, and prints no header or footer** (Browser). Nor a page's CSS size; Chromium's and WebKit's protocols have all of it (WebKit no PDF at all, Q52).
- *We:* `screenshot.cssScale`, `screenshot.omitBackground`, `pdf.headerFooter` and `pdf.preferCssPageSize` are `Unsupported` on Firefox.
- *Reconsider:* scaling a device-pixel capture down ourselves, which would need an image codec.
- **Kept**: the *We* line is the decision.

**Q116. WebKit reports an unspecified `SameSite` as `Lax`, and drops `Secure` cookies an `http://127.0.0.1` page set** (Browser). Chromium and Firefox leave an unspecified `SameSite` absent, and keep a `Secure` cookie a local page set.
- *We:* `Cookie.sameSite` is an `Option`, `None` where the backend didn't say; WebKit's `Lax` comes through as said.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q117. Only Chromium reports a cookie's partition and priority** (Browser). CDP gives a partitioned (CHIPS) cookie's top-level site and whether a cross-site ancestor set it, and every cookie's priority; Firefox and WebKit report neither, and can't set a partitioned cookie through their protocols.
- *We:* `priority` is an `Option`; a partitioned cookie is `Unsupported` there (`cookies.partitioned`), and a storage state with one fails a new context with `Incompatible`.
- *Reconsider:* when the protocols gain partitions.
- **Kept**: the *We* line is the decision.

**Q118. Firefox gives the isolated world the page's objects, behind Xrays** (Browser). IndexedDB records read in the isolated world aren't `instanceof` the sandbox's classes, a `Map` or `Set` can't be iterated through its Xray ("usingIterator().next is not a function"), and a typed array's data can't be read over one ("Accessing TypedArray data over Xrays is slow, and forbidden").
- *We:* `readOrigin` tells types by their tag, waives the Xrays of each record (`wrappedJSObject`), and copies bytes through the page's own `Uint8Array` (Q129).
- *Reconsider:* `Cu.cloneInto`, if the sandbox ever exposes it.
- **Kept**: the *We* line is the decision.

**Q119. Firefox fails a tab created in a user context while its only tab closes** (Browser). `browsingContext.create` right after `browsingContext.close` of the context's last tab failed with `NoSuchFrame` ("DiscardedBrowsingContextError: BrowsingContext does no longer exist").
- *Seen:* the page that writes a storage state was released by its scope, whose close isn't awaited, and the caller's first page followed at once.
- *We:* the storage state's page is closed with `page.close()`, which waits for the close, before the context is returned.
- *Reconsider:* waiting for the close in a page's scope finalizer too (Q135).
- **Resolved** in `a7ee8dc`: every page a scope releases is waited for (Q135), so a page created right after can't meet one still closing.

**Q191. Chromium's isolated worlds have no `customElements`** (Browser). In Strider's isolated world, `customElements` is `null` on Chromium; Firefox and WebKit give the page's registry. A capture can't ask which custom elements are defined.
- *We:* a DOM snapshot takes an element as a defined custom element when its name has a hyphen and it matches `:defined`, which every world can ask.
- *Reconsider:* nothing.

**Q225. Stock WebKit lists only the cookies a page's documents and resources are sent** (Browser). `Page.getCookies` collects the cookies of each URL its page's frames loaded, and Automation's `getAllCookies` those of its document, so a cookie for a path or a domain no page loaded isn't listed.
- *Seen:* the contents slice's cookie for `/app` was missing from its context's list, and listed once a page had loaded `/app/page`.
- *We:* `cookies` is `partial` on stock WebKit, saying so; a context's list and `listFor` are what its open pages are sent, and `remove` and `clear` remove what the list shows.
- *Reconsider:* nothing on our side: neither protocol lists a cookie store.

**Q230. In automation mode, stock WebKit's `Page.setCookie` ends the Automation session** (Browser). The inspector answers, and the Automation target leaves the server's list, so every later Automation command goes unanswered, whatever the cookie and whether or not the page has loaded anything; `Page.getCookies` and `Page.deleteCookie` leave it be. Automation's own `addSingleCookie` sets a cookie for any domain from any page, an `about:blank` one too, and stores a name's domain with a leading dot, so a host's cookie becomes its domain's; an IP address's stays as it is.
- *Seen:* a new context with a storage state's cookies and an origin's storage lost its page as the storage was written; a probe of the raw protocol found the session gone after each `setCookie`.
- *We:* launched, cookies are set through `addSingleCookie`, on the process's anchor window, so a context with no page open has them set at once; they are listed and removed through the inspector (Q225).
- *Reconsider:* a host-only cookie, which Automation widens to its domain.

**Q232. Stock WebKit partitions a frame's storage by its top-level origin, port included** (Browser). A cross-site frame's `localStorage` under a page at `http://127.0.0.1:39051` isn't the one it has under `http://127.0.0.1`; Chromium and Firefox key it by the top-level site, which has no port. A storage state records a partition by its site, so restoring it on stock WebKit writes it under the site's default port, where a page at another port doesn't find it.
- *Seen:* the slices' call site 1 restored a cross-site frame's storage, which its page at the test server's port didn't see; under a page at port 80 it did.
- *We:* `storageState.partitioned` is `partial` on stock WebKit, saying so; a partition at a site's default port, as a deployed site's is, round-trips.
- *Reconsider:* recording a partition's top-level origin beside its site, so a backend that keys by origin can restore it at its port.
- **Resolved** in `8431901`: a storage state records a partitioned origin's top-level origin, and a restore writes it from a page there, so stock WebKit's partition is the one its pages find; a state saved without one is restored at the site's default port.

**Q247. Headless Chromium's product name doesn't say it's headless** (Browser). `Browser.getVersion` reports `product: "Chrome/155.0.8059.79"` headless or headed; only the user agent still says `HeadlessChrome`. The CDP adapter looked for `Headless` in the product to decide whether `pdf` is supported, so every Chromium read `unknown`, though a headless one prints.
- *Seen:* the documentation site's capability tables, which showed PDF as unknown on Chromium.
- *We:* read `HeadlessChrome` from the user agent `getVersion` gives: `pdf` is `supported` headless, and `unknown` headed, as Q52 decided.
- *Reconsider:* whether headed Chrome 155 prints too, which would make `pdf` supported everywhere.

## Browsers: attaching

**Q136. Headless Chromium takes one URL on its command line** (Browser). A second fails the launch: "Multiple targets are not supported in headless mode". Firefox opens each as a tab.
- *We:* nothing; the attach tests open Chromium's second tab through its HTTP endpoint (`PUT /json/new`).
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q137. Firefox allows one WebDriver BiDi session, and keeps it after its connection closes** (Browser). A second `session.new` fails "Maximum number of active sessions"; a session started over a socket outlives the socket, 13 s and counting, so every later client is refused until the browser restarts; `session.end` frees it at once; and a second socket to the session's own URL is refused.
- *We:* the BiDi adapter ends a session it started when its scope closes, bounded by a second, and a connect refused for it says why (`ConnectionFailed{handshake}`).
- *Reconsider:* a program that dies without ending its session still locks Firefox (Q146).
- **Reported**: drafted in `upstream/firefox-session-outlives-socket.md`, not sent.

**Q138. Firefox reports the contexts that exist as `session.subscribe` is answered** (Browser). The BiDi adapter mapped Firefox's `"default"` user context after subscribing, so the tabs those events reported landed in a context of their own, never the default: a launched Firefox's first tab, and an attached Firefox's first tab.
- *Seen:* through the facts.
- *We:* the default context is mapped, and reported, before the adapter subscribes; the conformance suite checks the first tab is in it.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q139. Chromium leaves a dialog open when its client disconnects, and tells the next client nothing about it** (Browser). A client attaching later gets the tab, but no `javascriptDialogOpening`, and no document for the tab while the dialog is open.
- *We:* such a page is observed but stays opening: an operation on it times out, and the hint says a dialog may be open; `inspect` fails with `InitializationFailed`, saying the same.
- *Reconsider:* `Page.handleJavaScriptDialog` blindly on attach, which would decide the user's dialog.
- **Kept**: the *We* line is the decision.

**Q140. A WebDriver BiDi session's prompt settings are the whole browser's** (Browser). `unhandledPromptBehavior` can't be set per user context, so the `file: "dismiss"` a launched Firefox gets (Q29) would cancel the user's own file choosers on an attached one.
- *We:* an attached session leaves file choosers to the browser, and its `fileChooser` capability says so.
- *Reconsider:* when BiDi scopes prompt handling to contexts.
- **Kept**: the *We* line is the decision.

**Q196. WebKitGTK's inspector server lists its pages as HTML, with their titles and URLs unescaped** (Browser). `/` is a page for people: each page's title and URL are written into it as they are, beside its Inspect button, whose script names the page's WebSocket. A page titled with a socket's path would read as another page. It doesn't say when pages come or go either.
- *We:* the transport reads a page's path only from its button's script, and reads the list every 250 ms for pages that arrive; a page's end is its WebSocket's close, while the list still answers.
- *Reconsider:* nothing.

**Q202. WebKitGTK's MiniBrowser has no headless mode** (Browser). It draws through GTK and has no `--headless`, so it needs a display; WPE, which can run without one, isn't in the pinned nixpkgs.
- *We:* the integration tests run it under Xvfb, on a display Xvfb picks (`-displayfd`), from the Nix environment (`STRIDER_WEBKITGTK`, `STRIDER_XVFB`).
- *Reconsider:* WPE's headless platform, once nixpkgs has it.

**Q203. Stock WebKit's inspector says nothing of the browser** (Browser). There is no browser session to ask: the server's list and each page's `Target` domain name no product or version.
- *We:* `Browser.info` is `WebKit (stock)`, its version and revision `unknown`.
- *Reconsider:* reading the version from the user agent, if one carries it.

## Browsers: protocols and transports

**Q53. Firefox deviates from the BiDi spec in two events** (Browser). `contextCreated` has no `hasPlannedNavigation`, which the spec requires, and `navigationStarted` has no `url` for the navigation that `close({ promptUnload: true })` starts.
- *Seen:* the two corrections in `packages/tools/codegen/protocols/bidi/patches/`, with their recorded evidence.
- *We:* correct the protocol model; the audit lists a correction once the spec absorbs it.
- *Reconsider:* on each roll (`pnpm codegen:audit`).
- **Kept**: the *We* line is the decision.

**Q54. Chromium still sends deprecated events nothing subscribes to** (Browser). `Page.frameScheduledNavigation`, `frameClearedScheduledNavigation`, `downloadWillBegin` and `downloadProgress`.
- *Seen:* the drift test's first recording.
- *We:* the coverage report excludes them by policy.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q55. Huge messages break transports in different places** (Browser and platform). Node's built-in WebSocket closes at 128 MiB, `ws` at 100 MiB; Chrome escapes non-ASCII as `\uXXXX`, so a string can exceed V8's longest string, which used to hang the reader.
- *Seen:* PROTOCOL.md, Transports.
- *We:* lose the connection with a description; launched browsers use the pipe; remote endpoints are limited to 128 MiB until Effect's constructor passes `ws` options through.
- *Reconsider:* a `ws` constructor of our own, or upstream option passthrough.
- **Reported**: drafted in `upstream/effect-websocket-max-payload.md`, not sent.

**Q56. WebKit carries a command in a wrapper that takes a negated id** (Browser and ours). Commands to a target or worker go inside `Target.sendMessageToTarget` or `Worker.sendMessageToWorker`; we give the wrapper the negated id of the command it carries.
- *Seen:* PROTOCOL.md, Built for WebKit.
- *We:* ignore the wrapper's success and turn its failure into the carried command's.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q57. WebKit needs `getResourceTree` before `Runtime.enable`** (Browser). Otherwise its snapshot doesn't precede the contexts `Runtime.enable` replays. Execution context ids on CDP restart after a process swap, while `uniqueId` doesn't.
- *Seen:* WebKit and CDP probe findings.
- *We:* order the gate accordingly; key CDP realms by `uniqueId`.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q102. WebKit reports a page's existing user world for a new document after it commits** (Browser). An engine request right after a second `goto` found no realm in the world and asked to create it, which WebKit refuses ("World with the given name already exists"), so every read after a second `goto` failed.
- *We:* when the page already has the world, the WebKit adapter waits for its report for the document, or the document's end.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.
- **Resolved** in `9c8280c`: stock WebKit makes no worlds (Q194), and the adapter asks for none.

**Q120. CDP and WebKit report a document's main-world realm a moment after it commits** (Browser). Asking for it right after `goto` returned found none, and the adapters answered `Unsupported{mainWorld}`, so `evaluateInMainWorld` failed on a page just loaded.
- *Seen:* on Chromium.
- *We:* `realm` waits for the main world's report, or the document's end, as it does for an existing user world on WebKit (Q102).
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q151. Firefox implements `browsingContext.startScreencast`, which records a file** (Browser). WebDriver BiDi has no screencast; Firefox 158 answers the command with a WebM path in the browser's downloads folder, and sends no frames.
- *Seen:* a raw BiDi probe.
- *We:* `Capability.Screencast`, whose handle is a stream of frames, stays `Unsupported` on BiDi, and the limitation says why.
- *Reconsider:* recording a video through it for `Trace`, or a capability of its own for a file screencast.
- **Kept**: the *We* line is the decision.
- **Resolved** in `d8ee372`: `Capability.Video` records the file, into the directory the page's context downloads to (`destinationFolder`), and a trace's native screencast uses it on Firefox.

**Q178. Firefox names no user context in three events about windows** (Browser). `browsingContext.create({ type: "window" })` in a user context also opens a tab in the default user context, in a window of its own, and closes it at once; its `navigationStarted` and `navigationCommitted` come before its `contextCreated`, with `userContext: null`. `contextDestroyed` for a window whose user context `browser.removeUserContext` removed has `userContext: null` too. The spec has `browser.UserContext` in both places.
- *Seen:* when Firefox's pages became windows (Q71): the events failed to decode, so the adapter rebuilt its model from `browsingContext.getTree` in the middle of a navigation, and its documents went unreported. A raw BiDi client, which decodes nothing, didn't see a problem. It is what broke navigation in Q71's probe of windows.
- *We:* a correction in `packages/tools/codegen/protocols/bidi/patches/navigationInfo-userContext.json` makes the member nullable, as Q53's two are; the adapter places no context it can't attribute.
- *Reconsider:* on each roll (`pnpm codegen:audit`), and whether to report the transient tab with the deviation.
- **Resolved** in `38ce8ff`: as above.
- **Reported**: drafted in `upstream/firefox-window-user-context-null.md`, not sent.

**Q180. A page another client crashed went unreported under load** (Browser, or ours: not traced). The CDP-only test where a second client attaches to a page and sends `Page.crash` waits for the page's end, `PageCrashed`; under synthetic load (eight processes at once beside a dozen busy loops), none came within 10 s in 24 runs of 40, with and without `fa0a3a9`. It passed alone, and failed once in a normal full run.
- *We:* nothing yet.
- *Reconsider:* whether `Page.crash` was refused or ignored (the test ignores its failure), or whether `Inspector.targetCrashed` or `Target.targetCrashed` came and the adapter missed it; trace it as Q149 was.

**Q185. WebKit's `callFunctionOn` names no object group** (Browser). What a call returns joins the group of the object it was called on, and the WebKit adapter calls everything on its helper, which is in none.
- *Seen:* building grouped handles; a probe read a handle back after its group's release, and failed, as it should.
- *We:* a group's handles come from calls on an object made in the group (`Runtime.evaluate` with `objectGroup`), with the helper passed as an argument.
- *Reconsider:* nothing: CDP's `callFunctionOn` takes `objectGroup`, WebKit's doesn't.

**Q195. Stock WebKit numbers frames, loaders and requests in each web process from `0.1`** (Browser). Two pages, or one page's targets before and after a cross-site navigation, which are different processes, have the same ids; Playwright's build gives each a unique one.
- *Seen:* with two tabs, both main frames were `0.1`, and a navigation ran in the other page's context.
- *We:* the transport qualifies each target's ids with its page proxy's and its own (`webkitStockTransport.ts`), on the paths the adapter reads, never by walking a message, and takes the qualification off a command's.
- *Reconsider:* nothing.

**Q204. WebKitGTK's WebDriver server has no WebDriver BiDi in release builds** (Browser). `ENABLE_WEBDRIVER_BIDI` follows `ENABLE_EXPERIMENTAL_FEATURES`, which releases turn off: `WebKitWebDriver` has no `--bidi-port`, and a session asking for `webSocketUrl` fails "Failed to match capabilities". The browser's Automation domain keeps the BiDi commands under their condition.
- *We:* Strider speaks the Automation protocol itself, over the inspector server's socket.
- *Reconsider:* when a WebKitGTK release builds it in.

**Q205. With `WEBKIT_INSPECTOR_HTTP_SERVER` set, WebKitGTK ignores `WEBKIT_INSPECTOR_SERVER`** (Browser). The socket server then takes a random port, behind the HTTP server (`WebKitInitialize.cpp`), so a client of the socket can't find it.
- *Seen:* a probe that set both found nothing listening on the socket's port.
- *We:* a browser launched for automation gets only `WEBKIT_INSPECTOR_SERVER`; attaching uses the HTTP server.
- *Reconsider:* nothing.

**Q208. Stock WebKit's Automation evaluates in the page's world, and its inspector tunnel is off** (Browser). `evaluateJavaScriptFunction` sees the page's globals and expandos, and no other execution context appears; `sendInspectorMessage`, which would carry the inspector protocol through the session, answers only a client that allows inspector testing, which WebKitGTK's API doesn't.
- *We:* the inspector reaches a page as its own target on the same socket; the engine runs in the page's world, as when attached (Q194).
- *Reconsider:* nothing.

**Q213. MiniBrowser's first window is taken by the first page asked for, and its last window's close ends it** (Browser). In automation mode the first window has loaded nothing, and the first `createBrowsingContext` returns it rather than open one (`browser_window_get_or_create_web_view_for_automation`); closing the last window quits the browser before the command is answered.
- *Seen:* an anchor opened that way never appeared, and closing every page ended the browser.
- *We:* each process claims its first window first. A context's process keeps it as its anchor, minimized and never reported; the default context's reports it as the browser's first tab (Q141) and opens a window more as its anchor. A context lives as long as its process, whatever its pages.
- *Reconsider:* nothing.

**Q216. A WebKitGTK browser told an inspector port that's taken keeps running without its server** (Browser). It says so only on stderr ("Failed to start remote inspector server on …: Address already in use").
- *Seen:* a probe, with a port another program held.
- *We:* the launch picks a port at random, watches stderr for that line, and tries another, five times.
- *Reconsider:* nothing.

**Q217. GNOME Web's automation mode needs a session bus, opens no second page, and aborts as a page closes** (Browser). Without a D-Bus session, libportal aborts it at start; with one, its first `createBrowsingContext` takes its first window, a second is never answered, and closing a page ends it (status 134).
- *Seen:* GNOME Web 50.4 from the pinned nixpkgs under `dbus-run-session`.
- *We:* `WebKit.layer` launches only the MiniBrowser; another executable fails with `InvalidInput`, saying so.
- *Reconsider:* when GNOME Web's automation mode opens windows as asked.

**Q227. Stock WebKit's Automation answers some mistakes as if they weren't** (Browser). `resolveChildFrameHandle` for a frame that doesn't exist answers with the main frame's handle, `""`; `evaluateJavaScriptFunction` of a function that throws answers `""`, which isn't JSON; `setFilesForInputFileUpload` with a node handle it doesn't have succeeds and sets nothing; and a frame handle it doesn't have is `WindowNotFound`, as an unknown browsing context's is.
- *Seen:* probing its error replies for the drift test's fixture.
- *We:* `""` from `resolveChildFrameHandle` is no frame; a result that isn't JSON is none; the node handles the adapter sends are only ever ones Automation gave it; `WindowNotFound` is `NoSuchTarget` in the error table.
- *Reconsider:* nothing.

**Q229. Stock WebKit's `DOM.resolveNode` takes a node id only** (Browser). Playwright's build added an `objectId` and an `executionContextId`, which the adapter used to move a node into another world; stock WebKit refuses them as arguments it can't process.
- *Seen:* `dragTo`, files made in the page, and a trace's snapshot after an action, each passing a node to a function of the library's, failed with `InvalidArgument`.
- *We:* on stock WebKit, which has one world, a node's binding, already an object there, is passed as it is.
- *Reconsider:* nothing.

**Q234. WebKitGTK's MiniBrowser starts GTK before it reads its options, so `--version` needs a display** (Browser). Without one it prints only GTK's warning that it can't open a display, and with one it would open a window before answering.
- *Seen:* asking the pinned MiniBrowser its version for `strider browsers`.
- *We:* `strider browsers` never runs a MiniBrowser: its version is read from the path it leads to, where that names one, as a Nix store path does, and is otherwise not reported.
- *Reconsider:* nothing.

**Q236. Firefox now and then answers neither `browsingContext.startScreencast` nor the navigation sent just after it** (Browser). A trace's native screencast starts Firefox's video in a fiber of its own, so `Trace.record` returns before the reply, and a `goto` at once sends `browsingContext.navigate` while `startScreencast` is pending. Sometimes neither is ever answered.
- *Seen:* on Firefox 158: the recordings slice's "records screencast frames" hung in one of two full runs; alone, in 2 of 6 runs, and in 1 of 6 on `main` at `0afd6ec`. Each time the last command sent was `startScreencast` (Q151), and `goto` never returned.
- *We:* nothing yet; the test hangs until Vitest stops it. `goto`'s deadline doesn't bound the command that starts its navigation (`adapter.navigate`), so it waits past the deadline too; `7b3c783` bounds every wait an operation makes.
- *Reconsider:* what Firefox is doing, from the protocol's messages; and whether `Trace.record` should return once the video has started, so a caller's next command never races it.
- **Resolved** for the integration tests in `97a4ee2`, which found the cause in parallel: Firefox's `startScreencast` captures the page through the chrome window's `getUserMedia`, which starts its media stack, audio included, though a screencast has none, and the integration environment's browsers reached the desktop's PipeWire through the system's ALSA configuration. During a hang the browser's main thread waited on a lock beside cubeb's and AudioIPC's threads, and no later command was answered. A probe of up to seven recordings in one browser hung in 9 runs of 15 on the maintainer's desktop; with ALSA's configuration empty, so Firefox found no sound card, 42 recordings over 6 runs never hung, and the browser's `alsa-pipewire` thread was gone. The integration environment's `ALSA_CONFIG_PATH` now names an empty configuration, as a CI runner has no sound card. A program on a desktop is as exposed as Firefox is: a gotcha on `Capability.Video` and the trace's native screencast if it's seen beyond this machine, and a report to Mozilla, which needs the main thread's stack from a debugger that starts Firefox itself (Yama's `ptrace_scope` is 1 here). The camera's device is still the host's, which nothing in the environment can hide without a sandbox.

**Q237. WebKitGTK's MiniBrowser run outside its package's wrapper has no TLS on Nix** (Browser). GIO finds a TLS backend among the modules on its default path and on `GIO_EXTRA_MODULES`; Nix's WebKitGTK names none, so every HTTPS load fails with "TLS support is not available", which reads like a network error, before any certificate is checked.
- *Seen:* the TLS fixture's navigation failed on stock WebKit, as it should, but for that reason, not its certificate.
- *We:* the integration environment sets `GIO_EXTRA_MODULES` to `glib-networking`'s modules, after which an untrusted certificate fails as one ("Unacceptable TLS certificate"); `WebKit.layer`'s documentation says a MiniBrowser from Nix needs the same. Other distributions install GIO's modules where it looks.
- *Reconsider:* nothing on our side: the library starts the browser in the program's environment.

## Ours: workarounds and odd shapes

**Q58. `PromptBlocking` carries the dialog's kind and text, not `Page.Prompt`** (Ours). `Reason` is a leaf module, and importing `Page` into it makes a load cycle.
- *Reconsider:* whether `Prompt` should live somewhere `Reason` can import.
- **Kept**: the *We* line is the decision.

**Q59. `PageNavigation.next` reaches `goto`'s outcome mapping through `Runtime.settle`** (Ours). `PageNavigation` can't import `Page` as a value: `Page.ts` needs `PageNavigation`'s classes as it loads.
- *Reconsider:* moving the navigation reasons out of `PageNavigation`, or the `PageError` constructor out of `Page`, so the import is direct.
- **Kept**: the *We* line is the decision.

**Q60. Unbuilt module functions are erased, so some are odd stubs** (Ours). Node erases a `declare const`, so a module that used one as it loaded failed to load. `Deferred.await` was a `NotBuilt` function (the module is gone now), and `Route.continue` is a decision nothing reads yet.
- *Seen:* `test/Modules.test.ts`.
- *Reconsider:* goes away as modules are built.
- **Resolved** in `a7ee8dc`: the builds removed the stubs: the one `NotBuilt` left is `Trace.record`'s `domSnapshots`, which is declared and documented.
- **Revised** in `d8ee372`: `domSnapshots` is built, so nothing is `NotBuilt` now; the module stays for anything declared before it is built.
- **Revised** in `4b7b77a`: `WebKit.layerAttach`, the last declaration a module had left, is built, so every member the API declares is.

**Q61. A `Watchable` is an effect value with members attached** (Ours). Effect 4 has no public way to subclass `Effect`.
- *Reconsider:* if Effect adds one.
- **Kept**: the *We* line is the decision.

**Q62. A wait on a final value fails at once with `Timeout`** (Ours). A download's `status` ends in a final value, not with its target; `waitFor` a value it can no longer reach fails at once with `Timeout{waitingForCondition}` and a hint, which isn't a timeout.
- *Reconsider:* a reason of its own for "can never happen", or `TargetGone` with a download as a target.
- **Resolved** in `c790129`: `Watchable.waitFor` fails with `Watchable.Ended`, carrying the final value, when the value settled on one that can't satisfy it; a watchable whose entity ended keeps `TargetGone`. A canceled download's `status.waitFor(Completed)` checks it.

**Q63. `AutoResolution.policy` names a setting that doesn't exist** (Ours). A canceled file chooser reads `policy: 'fileChoosers: "cancel"'`, though no `fileChoosers` option exists; there is one policy.
- *Reconsider:* an option, or a different way to say "the only policy".
- **Resolved** in `c790129`: `AutoResolution.policy` is a union: `ContextOption{ name: "dialogs", value }` for a context option, `Default` for the library's one rule, which a canceled file chooser gets.

**Q64. A body that isn't JSON is a `BackendFailure`** (Ours). `CapturedResponse.json` fails with `BackendFailure{IncompatibleResponse, method: "json"}`; no reason of `ResponseError` fits a page's malformed body.
- *Reconsider:* a reason for it.
- **Resolved** in `c790129`: `ResponseError` gains `MalformedBody{ expected: "json" }`, which `json` of a body that isn't JSON fails with.

**Q65. `BodyLimit` is compared with the encoded size** (Ours). The size the browser reports when a hop ends is encoded (compressed), which is what BiDi's collector bounds, so a 10 MiB limit admits a larger decoded body.
- *Reconsider:* whether callers expect a decoded size.
- **Kept**: the *We* line is the decision.

**Q66. A `Timeout` whose every observation was `NoMatch` has the phase `resolving`** (Ours). Not `waitingForCondition`, since nothing was ever there to wait on.
- *Reconsider:* nothing; recorded because it surprises.
- **Kept**: the *We* line is the decision.

**Q67. `getByText` doesn't search the document's `head`** (Ours).
- *Reconsider:* nothing; recorded because it surprises.
- **Kept**: the *We* line is the decision.

**Q68. A click that times out after dispatch says `dispatchedUnconfirmed`** (Ours). A dialog the input opened is what holds such a dispatch (Q17).
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q80. The fold published events after the state they change** (Ours). `goto`'s outcome was latched before the navigation's end was published, so a `PageNavigation.next` made right after `goto` received `goto`'s own navigation. Popups, workers, dialogs and document readiness had the same order.
- *Seen:* through the `waitUntil` test on Chromium.
- *We:* publish first, then change the state (CONCEPTS.md §9, Subscriptions).
- *Reconsider:* nothing; recorded because the order is now a rule every new fact must keep.
- **Kept**: the *We* line is the decision.

**Q81. The guard can't stop a page's own earlier window listeners** (Ours). The guard listens on the window in the capture phase, armed just before dispatch, so a page listener added there earlier runs first and sees an event the guard then stops. Listeners anywhere else are protected.
- *We:* nothing.
- *Reconsider:* if a page relies on window capture listeners for clicks.
- **Kept**: the *We* line is the decision.

**Q82. Every waiting expectation evaluates at every animation frame** (Ours). Not only those that depend on layout: one evaluation per frame for each, in the page, while it waits.
- *We:* accept the cost, for one rule.
- *Reconsider:* frames only for layout conditions, if pages with many waiting expectations slow down.
- *Measured* in `cd969df` (the comparison scripts, `packages/scenarios/RESULTS.md`): on a page animating 200 of its 3000 elements each frame, its renderers used 287 ms of CPU a second while an expectation waited, and 256 idle; Playwright's `locator.waitFor()`, 246 to 253. Open: a page with many waiting expectations is still unmeasured.

**Q83. A shadow root's mutations don't wake an expectation** (Ours). The `MutationObserver` watches the document, and doesn't see into shadow roots; the next frame, or in a page that renders none the next round, catches the change.
- *We:* nothing more.
- *Reconsider:* observing each open shadow root.
- **Kept**: the *We* line is the decision.

**Q84. A failed release leaves a page unable to take input, for good** (Ours). After a held key's or button's release fails on a live page, every later gesture on it fails with `BackendFailure`, and nothing but a new page resets it.
- *We:* fail loudly rather than act with a key that may still be down (CONCEPTS.md §5, Compensation).
- *Reconsider:* a reset that releases every key and button the page could hold.
- **Resolved** in `a7ee8dc`: the next gesture sends the release that failed again first. If it gets through, the page's input is known again and the gesture runs; the gesture fails only if it fails again.

**Q85. `Condition` isn't `Pipeable`, though `because` is dual** (Ours). `condition.pipe(Condition.because("…"))` doesn't compile; `Condition.because(condition, "…")` and `pipe(condition, Condition.because("…"))` do.
- *We:* nothing.
- *Reconsider:* making it `Pipeable`, like the handles.
- **Resolved** in `c790129`: `Condition` extends `Pipeable`; conditions are made with `pipe` on their prototype.

**Q86. Keys are the US layout's** (Ours). Shift turns `1` into `!` as on a US keyboard, and a character outside the table is a key with `code: ""`.
- *We:* nothing.
- *Reconsider:* other layouts, if a test needs one.
- **Kept**: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `64f94a7`: `UserContext.Options.keyboardLayout` chooses `us`, `uk`, `de`, `fr`, `es` or `it`, generated from Unicode CLDR's Windows layouts, and `type` and `press` hold Shift and AltGr and press dead keys as the layout does. Firefox follows a layout's keys but gives them US codes (`input.keyboardLayout`).

**Q87. `Expect.that` turns its subject's timeout into its own failure** (Ours). A subject still running at the expectation's deadline, or failing with `Timeout` once it has passed, ends the expectation with `ExpectationFailed`; a shorter deadline inside the subject stays the subject's failure. The two are told apart only by whether the expectation's deadline has passed.
- *Seen:* under full load: a `Locator.count` timed out while resolving.
- *We:* as above.
- *Reconsider:* nothing; recorded because it surprises.
- **Kept**: the *We* line is the decision.

**Q88. The CDP adapter assumes Chromium reports an intercepted drag before the next move** (Ours). A drag Chromium intercepts is announced by an event, `Input.dragIntercepted`; the adapter turns the moves after it into drag events, so an announcement that arrived after the release would leave a drag the adapter thinks is in progress.
- *Seen:* it held in every run.
- *We:* nothing yet.
- *Reconsider:* waiting for the page's `dragstart` after the first held move, as Playwright does, and clearing a drag the release didn't end.
- **Resolved** in `a7ee8dc`: a drag Chromium announces after its gesture's release is canceled (`dragCancel`) before the next gesture, which would otherwise continue it.

**Q103. Chromium's `Fetch` stays enabled for every page, with a pattern nothing matches** (Ours). It keeps the interceptor installed, so a route declared on a live page is in force when its declaration returns (Q46).
- *Seen:* one request in 40 went past a route under load before; none in 160 after.
- *We:* `Fetch.enable` from each page target's start, never disabled.
- *Reconsider:* whether an interceptor always installed costs anything measurable; and whether Chromium can say when its interceptor is in force.
- *Measured* in `cd969df` (the comparison scripts, `packages/scenarios/RESULTS.md`): a page with 300 images loaded in 106 ms with the interceptor always installed and no route, and 110 with a route; Playwright's, 73 with no route and 111 once a route is declared. The interceptor costs a load what Playwright's route does. Open: whether Chromium can say when its interceptor is in force.

**Q104. A decision a backend can't apply lets the request through** (Ours). `Route.abort("timedOut")` on Firefox, or a fulfill at the response phase there, is a handler failure, so the default, continue, applies, logged and published as an `AutoResolution`: the route fails open.
- *We:* as above, for one rule with handler failures.
- *Reconsider:* failing closed for an abort, which would be a decision nobody made.
- **Kept**: the *We* line is the decision.

**Q105. Routes' automatic decisions name a setting that doesn't exist** (Ours). `policy: 'routes: "continue"'`, as file choosers' do (Q63).
- *We:* nothing.
- *Reconsider:* with Q63.
- **Resolved** in `c790129`: a request no route decides is `policy: Default`, as Q63.

**Q106. A route with a `URLPattern` pauses every request** (Ours). L0 can't read a `URLPattern`, so the intercept covers everything and the route matches itself; requests it doesn't match continue at once, a round trip each.
- *We:* a glob or an exact URL is passed to L0 as it is.
- *Reconsider:* translating a `URLPattern`'s fixed parts into a glob.
- **Resolved** in `f223b83`: the intercept is the pattern's fixed prefix, from the scheme through the path up to its first variable part, with the origin as a URL writes it, and `*`; a prefix that ends inside the origin keeps the scheme only.

**Q107. A removed init script's dependents stay registered** (Ours). They don't run once their dependency is gone, since L0 runs a script only after what it comes after ran, but they are still declared until their own scope closes.
- *We:* as above.
- *Reconsider:* removing them, which would need L1 to own their scopes.
- **Kept**: the *We* line is the decision.

**Q108. The page clock's controls are on a symbol the page can find** (Ours). `Symbol.for` with a random token keeps page script from stumbling on them, not from looking.
- *We:* as above.
- *Reconsider:* driving the clock from the isolated world through the DOM, if pages turn out to touch it.
- **Kept**: the *We* line is the decision.

**Q109. A page's clock and its context's can't both be installed** (Ours). One timeline covers a page, so the second `install` is a `Conflict`.
- *We:* as above.
- *Reconsider:* letting a page's clock override its context's, as overrides do.
- **Kept**: the *We* line is the decision.

**Q122. A frame that isn't there yet is a request that matches nothing** (Ours). Its steps become `:not(*)`, so every operation handles it as it handles no match, in a round of at most 100 ms, so the next round looks for the frame again.
- *We:* as above; a read in a missing frame is `NoMatch` at once.
- *Reconsider:* waiting in the parent document for the iframe, which would save the short rounds.
- **Kept**: the *We* line is the decision.

**Q123. A round the deadline cut short reported what it never saw** (Ours). A round cut before its first frame noted `NoRenderingOpportunity`, or answered its default `NoMatch`, and one cut while a rect was still settling answered `NotStable`; under a short deadline that buried the real reason, a covered iframe.
- *Seen:* `Deadline.within("1 second")` on a covered frame.
- *We:* `NotReady` says whether the round noted anything (`checked`), and L1 adds the reason only then; a round under 100 ms doesn't note `NoRenderingOpportunity`.
- *Reconsider:* rounds that keep a stable check's frames across rounds.
- **Kept**: the *We* line is the decision.

**Q124. A snapshot's text and iframe nodes have roles that aren't ARIA's** (Ours). Text is `{ _tag: "Aria", role: "text" }`, its text the name, and an iframe is `iframe`; `Snapshot.Node` has no other kind.
- *We:* as above, as Playwright's aria snapshots write them.
- *Reconsider:* a node kind for text in the schema.
- **Kept**: the *We* line is the decision.

**Q125. A snapshot's generation names a table, and `Suspended` never happens** (Ours). Refs live as long as their document, so the generation is a random number the engine picks when installed, not a count that advances when refs go stale, and a ref from another table is `BindingLost`. Nothing tells a document in the back/forward cache from one replaced, so `StaleRef{Suspended}` is never given.
- *We:* as above.
- *Reconsider:* `Suspended` from the document's lifecycle, when the model folds it.
- **Kept**: the *We* line is the decision.

**Q126. An element screenshot of no element is `InvalidInput`** (Ours). `PageError` has no `NoMatch` or `StrictViolation`, so a capture's locator that doesn't match one element is `InvalidInput{input: "area"}`, the locator and what it matched in the hint.
- *We:* as above; a capture never waits.
- *Reconsider:* the locator reasons in `PageError`.
- **Resolved** in `c790129`: `PageError` gains Locator's `NoMatch` and `StrictViolation`, which an element capture of none, or of several, fails with; `InvalidInput{area}` stays for a frame on its way that went.

**Q127. Sites are approximated without the public suffix list** (Ours). A storage partition's top-level site is the URL's scheme and its host's last two labels, or the host itself for an IP address or a one-label name; `example.co.uk`'s is `co.uk`.
- *We:* as above, for storage state's partitions.
- *Reconsider:* the public suffix list, if a partitioned origin is ever mislabelled.
- **Kept**: the *We* line is the decision.

**Q128. The CDP adapter reads the device pixel ratio from the page** (Ours). `scale: "css"` clips at a scale of one over the ratio; `Page.getLayoutMetrics` as the protocol types it has no scale for the visual viewport, so the ratio is `devicePixelRatio`, evaluated.
- *We:* as above.
- *Reconsider:* `Emulation`'s device metrics, when an override is in force.
- **Kept**: the *We* line is the decision.

**Q129. Firefox's Xrays are waived to read IndexedDB records** (Ours). Q118 leaves no other way to iterate a page's `Map` or `Set`, so a page that patched `Map.prototype` or `Set.prototype` could change what an export reads.
- *We:* waive each record's Xray; the records are the page's own structured clones.
- *Reconsider:* with Q118.
- **Kept**: the *We* line is the decision.

**Q130. The page that writes a storage state is in the new context's history** (Ours). Its navigations and requests are the context's events, which `history` keeps, though the caller never had the page.
- *We:* nothing.
- *Reconsider:* writing from a page the model doesn't publish, or clearing the history it left.
- **Kept**: the *We* line is the decision.

**Q131. Some storage errors have no `Timeout` or `TargetGone`** (Ours). `CookieJarError` operations declare neither, and origin storage declares no `Timeout`, so a context that ended is a cookie jar's `BackendFailure`, and origin storage's deadline is one too; an origin with no storage (an opaque one) is `BackendFailure`, and a value over the quota `InvalidInput`.
- *We:* as above.
- *Reconsider:* the error channels, with the next API revision.
- **Resolved** in `c790129`: cookie jar operations declare `TargetGone`, and a context that ended is one; origin storage declares `Timeout`, which its deadline is (`dispatchedUnconfirmed`: a write may have happened).

**Q132. Handles are released one at a time** (Ours). Batched release isn't built: each handle's scope finalizer releases it alone.
- *We:* as above.
- *Reconsider:* releasing a scope's handles in one command per realm.
- **Resolved** in `64f94a7`: a scope's handles in a realm are one object group, released in one `Runtime.releaseObjectGroup` as the scope closes (on WebKit through an object made in the group, Q185), and in one `script.disown` on BiDi.

**Q133. `page.readHtml` reads from the engine's world** (Ours). Not the isolated world: the document's HTML is the same from either, and the engine is already there.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q134. A storage state's records are in the library's encoding in memory too** (Ours). A record's key and value in a `StorageState` are the JSON-safe encoding (`$date`, `$map`, `$bytes` and the rest), not the values themselves, so the same state round-trips through `StorageState.Json` unchanged.
- *We:* as above; the schema's `Unknown` says so.
- *Reconsider:* a schema for the encoding, if anyone reads records.
- **Kept**: the *We* line is the decision.

**Q135. A page released by its scope isn't closed by the time the scope is** (Ours). The finalizer asks the adapter to close it, and the BiDi adapter doesn't wait for the browser, so a new page right after can meet Q119.
- *We:* nothing yet, beyond the storage state's page (Q119).
- *Reconsider:* waiting for the close in the finalizer, under a short deadline.
- **Resolved** in `a7ee8dc`: a page released by its scope, or a popup by its opener's, is waited for after the close is asked for, under the default budget.

**Q141. A launched browser's own first tab is observed** (Ours). Every backend opens one tab in the default context before any page is created; no scope created it, so it is an observed page, open as long as the browser, which `inspect` and `control` gain access to.
- *We:* as above; `browser.pages` and the default context's `pages` list it.
- *Reconsider:* closing it at launch, which would make the browser exit on some platforms when the last tab goes.
- **Kept**: the *We* line is the decision.

**Q142. Access is a contract at the handle, not at the protocol** (Ours). A handle made under a grant has every member, its type narrowing what a caller sees: a `ReadonlyPage` from `inspect` still has `goto` at run time. A released grant is enforced at run time, by wrapping each member and through each locator's owner.
- *We:* as above (CONCEPTS.md §3: access is a library contract).
- *Reconsider:* refusing control members at run time on an `inspect` handle, if a cast ever reaches one.
- **Kept**: the *We* line is the decision.

**Q143. A released grant refuses some members with `NotPermitted`, or a clock with `NotInstalled`** (Ours). `route`, `addInitScript`, `emulate`, a context's cookies, `newPage` and storage state declare no `TargetGone`, so they fail with their module's `NotPermitted`; the clock's `adjust`, `setTime` and `resume`, whose errors have no `NotPermitted`, fail with `NotInstalled`, which is true, since the clock went with the grant.
- *We:* as above; every other member fails with `TargetGone{AccessReleased}`.
- *Reconsider:* `TargetGone` in those signatures, with the next API revision.
- **Resolved** in `c790129`: `route`, `addInitScript`, `emulate`, `grant`, `newPage`, `exportStorageState`, the cookie jar, the page clock, `Dialog.handle`, `FileChooser.handle`, `Har.record`, `Trace.record` and `Browser.newPage` declare `TargetGone`, and a released grant fails every guarded member with `TargetGone{AccessReleased}`. The refusal table went with it (`internal/refusals.ts` is `guarded.ts`, which lists only the members observing gives and the declarations a grant removes). A clock never installed is still `NotInstalled`.

**Q144. A page's `context`, when its context isn't controlled, refuses** (Ours). `Page.context` is a `UserContext`, but controlling a page doesn't control its context, so it is a handle whose members needing control fail with `NotPermitted`, and whose `control` gains it.
- *We:* as above.
- *Reconsider:* an `ObservedUserContext` there, with the next API revision.
- **Kept**: the refusing context's message names `page.context.control`.

**Q145. Controlling a context controls its pages** (Ours). A context granted for a scope hands out its pages as `Page`s under the same grant, as `UserContext.pages` is typed.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q146. A program that dies without ending its session locks Firefox** (Ours). The session is ended in the connection's finalizer; a killed process never runs it (Q137).
- *We:* nothing more.
- *Reconsider:* a CLI command that ends a stuck session, if one turns up.
- **Kept**: the *We* line is the decision.
- **Reported**: drafted in `upstream/firefox-session-outlives-socket.md`, not sent.
- **Resolved** in `6ff530c`: the CLI's daemons keep a ledger record of the browser they launched, so `strider prune --yes` kills a Firefox a dead program left running, which frees its session.

**Q147. An attached Chromium's every page gets the library's interceptor** (Ours). The CDP adapter enables `Fetch` for every page from its start, with a pattern nothing matches (Q103), observed pages included: nothing changes for the page, but the interceptor is installed while the client is attached.
- *We:* as above.
- *Reconsider:* enabling it only when a page is controlled, which brings back Q46's race for the first route.
- **Kept**: the *We* line is the decision.

**Q148. Chromium's HTTP endpoint is read with Effect's `HttpClient` over `fetch`** (Ours). `Chromium.layerConnect` provides `FetchHttpClient` inside the layer to read `/json/version`, so its requirements stay `WebSocketConstructor`.
- *We:* as above.
- *Reconsider:* taking `HttpClient` from the caller, if a runtime has no `fetch`.
- **Kept**: the *We* line is the decision.

**Q152. A file chooser answered with made files is let go before its handler counts** (Ours). `FileInput.bytes` files are set by the page on the chooser's input, and the chooser is then resolved as canceled, which no backend acts on; the page's `change` can arrive before the handler's `handled` goes up.
- *Seen:* on WebKit.
- *We:* the tests wait on `handled`.
- *Reconsider:* counting the handler before its files are set.
- **Resolved** in `a7ee8dc`: the handler is counted when it decides, as a dialog's is, and the page sets the files after; the slice test reads the count without waiting.

**Q153. One call can't mix made files with paths** (Ours). The browser sets files from paths and the page makes files from bytes, each replacing the other's, so `setInputFiles` and `FileChooser.choose` with both fail with `InvalidInput`.
- *We:* as above.
- *Reconsider:* reading local files into made ones, which loses nothing but the browser's own MIME guess.
- **Kept**: the *We* line is the decision.

**Q154. `Browser.layerTest`'s browser is a protocol of its own** (Ours). `Info.protocol` gained `"fake"`, the fake has its own support table, its timeline's URLs are `https://example.test/…`, and its `goto` commits at once, with no response.
- *We:* as above.
- *Reconsider:* whether a timeline should name its URLs.
- **Kept**: the *We* line is the decision.

**Q155. An operation's span no longer captures its call site** (Ours). `Effect.fn` adds the caller's stack frame to a span; the span helper opens spans with `Effect.withSpan` around `Effect.fnUntraced`, so `SpanNameGenerator` and `TracerDisabledWhen` apply to every operation alike.
- *We:* as above.
- *Reconsider:* capturing the call site in the helper when Effect exposes it.
- **Kept**: the *We* line is the decision.

**Q156. The model's own log uses the layer's diagnostics preset** (Ours). A route decision the backend refused is logged by the model's fiber, which runs with the layer's context, so `Diagnostics.withPreset` around an operation doesn't reach it.
- *We:* as above.
- *Reconsider:* carrying the preset with the route's declaration.
- **Kept**: the *We* line is the decision.

**Q157. Vitest copies each attached file into `.vitest/attachments`** (Ours, from Vitest). `recordArtifact` with a path copies the file under the project root, named by its hash.
- *Seen:* the `TestRun.attach` test.
- *We:* the repository ignores `.vitest/`.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q162. Ids are unique within the process, not the connection** (Ours). A trace recording learns of operations from their spans' attributes, which carry ids; two connections minting `N1` would have made one's operations look like the other's.
- *We:* every connection's ids come from the process's counters, so no two connections mint the same one.
- *Reconsider:* nothing; it makes ids stronger evidence everywhere.
- **Kept**: the *We* line is the decision.

**Q163. A recording's timings are the library's, not the browser's** (Ours). A HAR's `wait` runs from the request event to the response event, and `receive` from there to the end, on the library's monotonic clock; `blocked`, `dns`, `connect` and `ssl` are -1, since no backend reports them alike. `startedDateTime` is the wall time read as the recording started, plus the monotonic time since. A minimal HAR's timings, and a response that never came, are -1, as Playwright writes them.
- *We:* as above.
- *Reconsider:* each backend's own phases as `_` extensions.
- **Kept**: the *We* line is the decision.

**Q164. A HAR has no request bodies** (Ours). The event model keeps a request's body only while a route holds it.
- *We:* entries have no `postData`.
- *Reconsider:* keeping bodies for recordings, through `requestBody` where the backend has it.
- **Kept**: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `f223b83`: a recording reads each hop's request body as the hop ends, kept where its body collection, which now names the bodies it keeps, covers the page: from the event on Chromium, or `Network.getRequestPostData` for the last hop's (Q182), a request data collector on Firefox (Q183), the event on WebKit (Q184). An export writes them as `postData` only when `include` names `"requestBodies"`.

**Q165. A caller's span in a trace spans the operations inside it** (Ours). Its own start and end are on Effect's clock, which `TestClock` freezes, so its step runs from its first recorded operation's start to its last one's end.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q167. The toolkit brings a page to the front before acting on it** (Ours). Its tools name pages and have no `activate`; a Firefox page behind another renders about once a second (Q71), so a click there timed out once a popup opened. `screenshot`, `click`, `fill`, `press`, `select`, `scroll` and `expect` activate their page first, and their descriptions say so.
- *Seen:* the toolkit's popup test on Firefox.
- *We:* as above.
- *Reconsider:* with Q71: whether every page could render in the background.
- **Kept**: the toolkit is given its context, so it keeps activating; it matters only on a Chromium context without focus emulation.

**Q168. `--attach` reads its backend from the endpoint** (Ours). An HTTP endpoint, or a WebSocket to `/devtools/`, is Chromium's; any other WebSocket WebDriver BiDi's. CLI.md names one `--attach` flag.
- *We:* the rule is in the session's start, and the spec it prints names the backend.
- *Reconsider:* a flag per protocol, if an endpoint is ever ambiguous.
- **Kept**: the *We* line is the decision.
- **Revised** in `4b7b77a`: an endpoint is ambiguous now. Stock WebKit's inspector server is an HTTP endpoint too, which `--attach` reads as Chromium's, so stock WebKit isn't reached from the CLI; the flag per protocol above is the way, not yet decided (CLI.md, Built).

**Q169. A session's context is its own, also when it attaches** (Ours). The daemon creates the session's one context, so its pages are controlled from the start; the attached browser's own tabs aren't in it, and `strider control`, which would take one, isn't built.
- *We:* `control` fails, saying so.
- *Reconsider:* the default context as an attached session's, observed, with `control` acquiring for the session's scope.
- **Kept**: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `6ff530c`: `strider tabs` lists the browser's own tabs, `strider control` takes one into the session for its scope, named, and `strider release` gives it back; the toolkit has the same tools when made with the browser.

**Q170. The client learns a session started from one line** (Ours). `strider start` runs the daemon detached, with its standard output piped; the daemon writes one JSON line, ready or why not, and from then on writes its own output to `daemon.log` in the session's directory, since nothing reads the pipe.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q171. The CLI's socket carries JSON lines, not `effect/rpc`** (Ours). CLI.md had the daemon serve the tools as an `effect/rpc` group; the client must forward a command without loading Effect, so it sends the command's arguments as one line, the daemon parses them with `effect/cli`, and the answer is lines of output and an exit code. An `Interrupt` line interrupts the command.
- *We:* as above; `--json` prints a command's result as one JSON line.
- *Reconsider:* an `effect/rpc` surface beside it, for programs that drive a session.
- **Kept**: the *We* line is the decision.

**Q172. The package compiles without Node's types** (Ours). The CLI is Node's alone, and uses its built-ins through a small interface of its own (`cli/node.ts`) over dynamic imports, so nothing else in the package can come to rely on Node.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q173. A page a segment opens with `newPage` ends with the segment** (Ours). A segment runs in a scope of its own, which a page it opens belongs to; a page it returns is named into the session, but only one that outlives the segment, such as a popup of a session's page, stays open.
- *We:* as above; `strider page new` opens a page for the session.
- *Reconsider:* transferring a returned page's ownership to the session, which CONCEPTS.md §3 allows.
- **Kept**: a declared piece still unbuilt, built when a use needs it.
- **Resolved** in `6ff530c`: `CurrentSession.keep(page, name)` transfers a page the segment opened to the session's scope; returning a page still only names it.

**Q174. A popup collected by `await` is usually still blank** (Browser). The popup event comes before its first navigation, so the URL `await` can report is `about:blank`; the toolkit says "so far".
- *Seen:* on every backend.
- *We:* as above.
- *Reconsider:* waiting for the popup's first commit, which would be a wait the tool adds.
- **Kept**: the *We* line is the decision.

**Q175. A segment is imported afresh on every run** (Ours). Its URL gets a query of its own, so an edited file runs as edited; module state doesn't carry from one run to the next.
- *We:* as above.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q176. The digest has what arrived before the call returned** (Ours). An event that arrives just after a tool's result, such as a 404 a click's page fetches, is in the next call's `sinceLast`.
- *Seen:* the toolkit's tests.
- *We:* as above; no tool waits after it acts.
- *Reconsider:* nothing.
- **Kept**: the *We* line is the decision.

**Q177. The adapters kept every request for the connection's life** (Ours). Each adapter's request and hop tables dropped an entry only when a redirect replaced its hop, so a long-lived connection, such as the CLI's daemon or an agent's session, kept every request it had seen.
- *Seen:* fixing Q39.
- *We:* keep a finished request answerable while there is room for 1000, as the model keeps hops (`maxHops`), and forget the oldest after (`internal/retired.ts`). A request still in flight stays until it ends.
- *Reconsider:* ending a target's requests with it, which Q159's favicon, never ended, would need.
- **Resolved** in `a7ee8dc`: as above.

**Q190. A world was created twice for a WebKit page just made** (Ours). `Page.createUserWorld` refuses a name the target has (`World with the given name already exists`); a popup's first locator asked for the engine's world while its target's setup, which creates the page's worlds in each target it gets, created it too, and the click failed.
- *Seen:* in a full run: call site 3 on WebKit, once.
- *We:* both take a world that exists as made, and a world asked for is waited for until its realm is reported or its document ends.
- *Reconsider:* nothing.
- **Resolved** in `9c8280c`: stock WebKit makes no worlds (Q194), and the adapter creates none.

**Q192. A snapshot's canvas is drawn from screenshots** (Ours). The trace viewer draws a canvas in a DOM snapshot from the action's screenshot, cropped by the canvas's box, so a trace without `screenshots: "perAction"` shows its canvases empty; the capture writes only where each canvas is.
- *Seen:* the viewer's renderer (research/playwright-trace-snapshots.md, Canvases).
- *We:* as the viewer does; `Trace.record`'s documentation says so.
- *Reconsider:* nothing, while the viewer draws them so.

**Q193. Firefox's video in a trace ends at the first export** (Ours). The file is written when the screencast stops, and an export needs it, so the first `exportTrace` stops each page's video and later exports reuse what it read.
- *We:* as above, documented on `Trace.record`.
- *Reconsider:* recording a new segment after each export, if a use exports more than once while recording.

**Q194. On stock WebKit, the engine runs in the page's world** (Ours). Stock WebKit's inspector has no `Page.createUserWorld`, so the locator engine, the trace capture, `inspect`'s setup and the library's own reads, such as storage's, run where the page's scripts can see them, and change what they use.
- *We:* `isolatedWorlds` is `unsupported`, and `WebKit.layerAttach`'s documentation says where the engine runs; a caller's function never moves there: `evaluate` fails `Unsupported`, and `evaluateInMainWorld` runs.
- *Reconsider:* nothing while stock WebKit makes no worlds.
- **Revised** in `508e013`: the library's own functions given a node, a drag's and those that set files made in the page, run there too, with the node passed as its binding (Q229); and the engine takes the page's real timers where a page clock shares its world (Q222).

**Q210. Every WebKit protocol's generated header named the patched build's directory** (Ours). The emitter wrote `protocols/<dialect>`, and the stock and Automation protocols are in WebKit's dialect, so their modules said to correct `protocols/webkit`.
- *We:* each source names its own directory (`Emit.Source.directory`).
- *Reconsider:* nothing.
- **Resolved** in `251796e`: as above, which corrected the stock protocol's headers.

**Q219. Launched stock WebKit pairs a page's two names by its document's time origin** (Ours). Automation knows a page by its handle and the inspector by its target, and neither names the other; the adapter reads `performance.timeOrigin` through both and pairs them, which writes nothing the page sees.
- *We:* as above, under one permit at a time; a page made by the connection is the one paired to the handle it made.
- *Reconsider:* if a WebKit release names a page's target in Automation's browsing contexts.

**Q220. A context's defaults the backend doesn't report are left out, not refused** (Ours). Every context the library makes downloads to a temporary directory and declares its file choosers; where `downloads` or `fileChooser` is `unsupported`, as on stock WebKit, those defaults are skipped, and asked for, they fail.
- *Seen:* every `newPage` failed on the defaults.
- *We:* as above (`browser.ts`).
- *Reconsider:* nothing.

**Q222. On stock WebKit, the page clock's shim leaves the real timers for the engine** (Ours). The engine runs in the page's world there (Q194), where a controlled clock replaces `setTimeout`, `requestAnimationFrame` and `performance.now`, so the engine waited on the clock's frames, which never came.
- *Seen:* the slices' call site 10 on stock WebKit, whose click waited 30 s for `Runtime.callFunctionOn`.
- *We:* the first shim in a document keeps the real timers under a well-known symbol, `@usestrider/browser/clock/real`, and the engine takes its timers from there, or the page's own at its install, before any shim.
- *Reconsider:* nothing, while the engine shares the page's world; the symbol is the page's to see, as the clock's own is.

**Q228. Launched stock WebKit finds the frame an iframe holds through Automation, by its document** (Ours). The inspector can't say (Q201), and Automation knows frames by handles of its own: the iframe element, found by its path, is resolved to Automation's frame, and its document's time origin and URL are compared with each of the inspector's child frames' documents', read in the page's world. Two frames whose documents began at the same moment at the same URL are told apart by a property Automation sets on one's window, which the inspector looks for, removed at once.
- *Seen:* every frame locator failed on stock WebKit, as `contentFrame` was `Unsupported`.
- *We:* `frames.contentFrame` is `supported` when launched, and each frame's Automation handle is kept, so a file input in a frame has its files set too.
- *Reconsider:* the mark, which a page's scripts could see for a moment.

**Q231. A trace's polled frames are PNG where a backend's screenshots are** (Ours). Playwright's trace format names its frames JPEG, and stock WebKit writes PNG only; a polled screencast asked it for JPEG, failed, and recorded nothing, unsaid.
- *Seen:* the recordings slice's polled trace had no frames on stock WebKit.
- *We:* where `screenshot.format` isn't `supported`, polled frames are PNG, written as `.png`.
- *Reconsider:* whether Playwright's trace viewer shows PNG frames, which hasn't been checked.

**Q233. Firefox's conformance test of a navigation after a failure sometimes sees a third navigation start first** (Ours). "Navigates again at once after a failure" expects its page's started navigations to be the refused `goto`'s and the next's; now and then a third, numbered between them, is reported started before both.
- *Seen:* in the second full integration run, and twice in three runs of the test alone just after it; then not in 13 runs alone, nor in 3 at the commit before. Which navigation the third is wasn't caught.
- *We:* the test's assertion prints the navigations it saw, to say which when it recurs.
- *Reconsider:* when it recurs: likely Firefox's report of a new tab's first `about:blank`, arriving late.
- **Resolved** in `97a4ee2`: the printed navigations caught it, and it wasn't a new tab's `about:blank` but the refused navigation itself, started twice. Firefox replied to `browsingContext.navigate` for port 9 with an error, `deniedPortAccess`, and reported the navigation's start and its error page after the reply. The BiDi adapter's `neverStarted`, which reports a navigation whose command failed, took the navigation's expectation outside the adapter's serialized step, so the start event, handled in between, found none and began it again under a new id. It takes and reports it in one step now: the test failed twice in 12 runs alone before, and in none of 15 after.

**Q235. A deadline's waits ran on Effect's clock, which `TestClock` freezes** (Ours). The deadline is a live instant, and the loops that compare against it are live, but the 22 waits it bounded (`Effect.timeoutOption(Operation.millisLeft(at))`) slept on Effect's `Clock`, as did `pressSequentially`'s `delay`. Under `TestClock`, which `it.effect` installs, an event wait, the wait for a page's input permit, a dispatch the browser never answered, or a page that reported no document waited for `TestClock.adjust` instead of timing out. An action whose element never became ready still timed out, since a timer in the page caps each round.
- *Seen:* `Popup.next` with a 200 ms deadline on `Browser.layerTest`, under `it.effect`, hadn't failed after a second of real time, and failed once the test clock moved.
- *We:* a deadline runs on the clock the browser runs on, read from one reference, live unless set. Actions, reads, the runtime's wait for a document and `pressSequentially`'s `delay` use it.
- *Reconsider:* nothing.
- **Resolved** in `7b3c783`: every deadline, and every wait on a browser, reads the browser's clock: the live clock for a real browser, and for `Browser.layerTest` the `Clock` its layer was built with. Building it found more of the same: Expect's re-check, a trace's polled frames, typing delays, stock WebKit's polls, Chromium's launch retries and Firefox's session end each waited on the fiber's clock, so under `TestClock` a real browser's launch never finished; they run on the live clock now (`BrowserClock.onLive`). The events slice checks a wait under `TestClock`.

**Q238. A WebKit HAR sometimes has no body for the document the page left at once** (Ours). The slices' HAR test records a `goto` and then another; the first document's entry had no body, in one full integration run, where Q179's resolution reads it as its load finishes.
- *Seen:* a second full run; not in 5 runs of the test alone after it. The read's failure, if it failed, isn't reported: the entry is written without a body. Again in a later full run, 1 of the WebKit slice's 126, on a change that touched neither the read nor the navigation's commands.
- *We:* nothing yet.
- *Reconsider:* when it recurs, which of two it is: the read, sent over the inspector as the document's load finishes, answered after the next `goto`'s navigation, sent over Automation, has committed and cleared the document's resources; or the read sent to a target a process swap had just replaced. The first would be fixed by a navigation the adapter sends waiting for its page's reads in flight; either needs the read's error, which the adapter could log.

**Q239. A build left an earlier build's output in `dist`, where a publish would have taken it** (Ours). `tsc -b` writes `dist` from the sources and never deletes an output whose source is gone, and `pnpm build` cleaned nothing, so the generated BiDi modules' output from before their rename, `browser.js`, `session.d.ts` and the rest, sat beside `Browser.js` and `Session.d.ts`, and `files` packs `dist/**`.
- *Seen:* the package check's first run: the consumer project's type check saw two declaration files differing only in case, and offered `@usestrider/browser/bidi-protocol/session` as a subpath.
- *We:* `pnpm build` runs `strider-utils clean` first, which removes the published packages' `dist` and their build information, and the package check fails a `dist` file with no source beside it.
- *Reconsider:* nothing.
- **Resolved** in `7583260`.

**Q240. The backends' `BackendMetadata` keys didn't type-check without `exactOptionalPropertyTypes`** (Ours). Each backend declares its key on `Reason.BackendMetadata` by `declare module`, optional, as `cdp?`; `BackendMetadata` extended `Metadata`, whose index is `MutableJson | null`. With `exactOptionalPropertyTypes`, which the workspace sets, an optional key's type has no `undefined`; without it, which TypeScript's `strict` doesn't set, it has, and the index doesn't admit it, so a project that checks its libraries failed on `Bidi.d.ts`, `Chromium.d.ts` and `WebKit.d.ts`.
- *Seen:* the package check's first run.
- *We:* `BackendMetadata` has an index of its own, `Metadata`'s values or `undefined`, and the package check type-checks the packages without `exactOptionalPropertyTypes` or `skipLibCheck`.
- *Reconsider:* nothing.
- **Resolved** in `7583260`.

**Q241. An element of no opacity is hidden to Strider's actions, and visible to Playwright's** (Ours). CONCEPTS.md §8 defines visible with `checkVisibility({ opacityProperty: true })`, so `opacity: 0` is hidden, and an action that checks `visible` waits for it out its deadline. A styled checkbox is often an `opacity: 0` input under its label, which receives the pointer: TodoMVC's is. Playwright counts an element of no opacity as visible, so its `check` checks it.
- *Seen:* the comparison scripts: `check()` on TodoMVC's first todo timed out `waitingForCondition`, its last observation `NotVisible`; Playwright's passed.
- *We:* the rule stands; the scenario turned the check off at its call site, `check({ checks: { visible: false } })`, and its note said why, until it was replaced by The Internet's dynamic controls (2026-10-27), TodoMVC's demo being hosted by Playwright.
- *Reconsider:* whether an action's `visible` should ignore opacity, as `receivesPointer` already says whether the pointer reaches the element; `Expect.toBeVisible` could keep it, which reads as a person would see it. A design change.

**Q242. A scenario takes Strider longer than Playwright, on the same Chromium** (Ours). Over 10 runs each, 8 of the comparison's 10 scenarios took 1.4 to 2.4 times as long with Strider, contexts and pages made and closed in each: the README's program 173 ms to Playwright's 98, a popup with a dialog 311 to 145, TodoMVC 424 to 176; a route blocking analytics took the same, and a HAR recorded and replayed 139 to 152. A launch with a first page took 201 ms to 130. Where the time goes isn't known.
- *Seen:* the comparison scripts (`packages/scenarios/RESULTS.md`), on the maintainer's desktop at `nice 19`.
- *We:* nothing yet.
- *Reconsider:* where the time goes, from one scenario's protocol commands and spans (`TraceProtocolCommands`) beside Playwright's: a context's and a page's setup (`Fetch.enable`, the utility world and its engine, init scripts), an action's checks (`stable` waits animation frames), and an expectation's first evaluation are the candidates.

**Q243. `getByRole` matches a role and a name, and none of the states Playwright's filters by** (Ours). `Locator.RoleOptions` has `name`, `exact` and `includeHidden`; Playwright's also has `level`, `checked`, `pressed`, `expanded`, `selected` and `disabled`, so a heading's level or a checked box is a CSS selector or a filter in Strider.
- *Seen:* the comparison scripts: The Internet's `h2` was to be `getByRole("heading", { level: 2 })`, which doesn't type-check; both versions read `locator("h2")`.
- *We:* nothing yet.
- *Reconsider:* the states as `RoleOptions`, from the accessibility tree the engine already computes.

**Q244. A handler's or a route's decision ran under the deadline in force when it was registered** (Ours). `Dialog.handle`, `FileChooser.handle` and `route` run each decision with the context they captured at registration, the deadline included, so a handler registered inside `Deadline.within("5 seconds")` failed its operations with `Timeout` once those five seconds had passed, though its own budget, `Deadline.DefaultBudget` per decision, had barely begun. Its time limit was also on the fiber's clock, which `TestClock` stops.
- *Seen:* giving every operation a record and a deadline of its own, which would have handed the registration's to every decision too.
- *We:* a decision runs apart from the operation that registered it, with no record of its own and a deadline of the budget from when it starts (`Operation.apart`, then named `Operation.deciding`), timed on the browser's clock captured at registration. Work an operation leaves running, a recording's polls and followers, starts with no deadline of the operation's (`Operation.detached`).
- *Reconsider:* nothing.
- **Resolved** in `7b3c783`, with a test of a handler registered under a 10 ms deadline deciding a dialog later.

**Q245. A URL `goto` can't parse fails before its operation's span opens** (Ours). `page.goto("not a url")` fails with `PageError{InvalidInput}` from its argument check, which runs before `navigate` opens the span, so no span, and no `error.type`, records the failure.
- *Seen:* writing the test of `error.type`, first against a `goto` of a URL that doesn't parse.
- *We:* nothing yet; the error still carries its diagnostics.
- *Reconsider:* checking arguments inside the operation, so every failure has its span.

**Q246. The browser-finding test ran the machine's own browsers** (Ours). Its search included Linux's install locations, so on a machine with Chrome or Edge in `/opt`, as GitHub's runners have, it ran each with `--version`, one after another, before leaving them out; on a cold runner that passed the test's 5 seconds.
- *Seen:* CI, once, on `9806fe2`, which changed nothing it reaches; it passed locally in milliseconds.
- *We:* `Browsers.among` searches given candidates, and `find` is it over every place; the test passes only `PATH`'s and WebKit's, and WebKit's are never run.
- *Reconsider:* nothing.
- **Resolved** in `1bafdf0`.

**Q248. An exported test leaves out a check of a secret's text** (Ours). `strider expect … --text %password%` checks the page's text against the secret's value, which the toolkit puts in as the call runs and takes back out of the result. A test that repeated the check would hold the value in a matcher, and a failed `Expect.toContainText` prints the text it expected, so the secret would reach the test's output.
- *Seen:* making the export put a secret in wherever the session did.
- *We:* `export test` writes the expectation's state check, and in place of its text check a comment saying it was left out and why, at the maintainer's decision.
- *Reconsider:* a text matcher that takes a `Redacted` and leaves it out of its failure, with which the export would keep the check.

**Q249. An exported test of a forked or profiled session starts empty** (Ours). A session started with `--fork` took its state from the other session's memory, and one started with `--user-data-dir` runs on a profile its browser keeps locked, so the test `export test` writes can start from neither, as it starts from a `--state` file.
- *Seen:* checking what an exported test repeats of its session.
- *We:* the test's context is made as a fresh session's, with a comment at the top of the test saying which the session started from and that the test starts empty, at the maintainer's decision.
- *Reconsider:* writing a fork's state to a file at export, with `state save`'s mode, for the test to read as it reads `--state`'s.

**Q250. A `%name%` that names no secret is sent as written** (Ours). The agent toolkit, and so every `strider` command and `strider mcp` tool, read any `%name%` in a value or URL as a secret's placeholder and refused one that named no secret, so a URL's percent-escapes failed: `strider goto "https://shop.example.com/caf%C3%A9"` read `%C3%` as a secret and failed with "No secret named C3".
- *Seen:* driving a page at a percent-escaped URL through the CLI.
- *We:* a `%name%` is a secret only when the toolkit has one by that name, in every tool, and so every command, and in the exported test; any other is passed through unchanged, at the maintainer's decision. The cost is that a mistyped name, `%pasword%`, passes through too, as literal text, with no error: a field it fills gets the text `%pasword%`.
- *Reconsider:* a placeholder syntax that a URL or a field's text can't hold, or a note in the result when a value holds a `%name%` close to a secret's.

**Q251. An exported test waits for a popup the session never waited for from the command running as it opened** (Ours). A popup the session never waited for, seen only in the digest or `pages`, and a page a segment returned or kept had no declaration in the exported test, so every step on one, a rename included, used a variable the test never declared. The toolkit reports a popup as it opens, with its opener but not the command that opened it, and a page it finds among the context's pages with no opener at all, as every popup on stock WebKit is.
- *Seen:* checking what an exported test repeats of its session.
- *We:* the daemon gives a popup to the command acting on its opener as it opened, or, when none is, to the last that acted on it (Q253), and the test waits for it with `Popup.next` from just before that command; a popup that opened while a `next popup` was pending on its opener is that wait's; a page with no opener is taken by its place among the context's pages, as `UserContext.pages` teaches; and a segment's pages are its placeholder's. A page that opened while a command the test leaves out ran, or a second popup of one opener from one command, which `Popup.next` can't single out, is a placeholder naming its variable, at the maintainer's decision.
- *Reconsider:* telling the commands apart by when the popup's event came rather than by what was running; a second popup of one command by its first URL, with `Popup.next`'s `url`; and a page's place among the context's pages, which an earlier page closing late in the test shifts.

**Q253. An exported test gives a popup to the command acting on its opener, and two at once on one page leave it to a placeholder** (Ours). The daemon gave a popup the session never waited for to the command that started last among those running as it opened, whatever page each acted on, and between commands to the last command to end. With two commands at once, or a popup that opened late, as a click's timer opens one, while a command on another page ran, the exported test waited for it from before the wrong command, and a `Popup.next` there may subscribe after the popup opened. A popup's event names its opener, not the command that opened it.
- *Seen:* checking what an exported test repeats of a session that two commands drove at once.
- *We:* a command acts on the page it names with `-p`, on the page it opens, from the moment the toolkit opens it (`page new`, or `newPage` through `strider mcp`), and on the popups given to it; a segment acts on every page. A popup goes to the command acting on its opener as it opened, or, when none is, to the last that acted on it. When two commands act on its opener at once, the session can't know which opened it, and the test has a placeholder for it.
- *Reconsider:* the popup's opening event's initiator, where a backend reports the script or the input that opened it, which would single out the command even on one page.

**Q256. Independent CLI help calls exhausted one test's time budget on CI** (Ours). The nested-command description test started seven synchronous Node processes under one five-second test budget. Two GitHub checks at `33674aa` took 7399 ms and 7035 ms and timed out, while local runs passed. Another test combined several MCP help calls and reached 4822 ms on CI.
- *Seen:* ROOK-90's durable CI failures and the opt-in subprocess timings in `dd0b80b`. Locally the seven calls totalled 2361 ms; separate phase tracing showed dependency loading and evaluation dominated each process, with only 6–8 ms from starting the CLI runner to its first output. CI phase timings were unavailable, so that phase breakdown is established only locally.
- *We:* each independent invocation has its own named test; assertions about the same output stay together, including toolkit descriptions. The five-second test budget, ten-second subprocess limit, actual subprocess boundary and argument coverage stay intact.
- *Reconsider:* if an individual invocation exceeds its budget, measure its phases on the failing runner before changing CLI loading or the timeout.
