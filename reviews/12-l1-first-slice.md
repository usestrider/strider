# Design review — L1 against the built adapter contract, for a first slice

*2026-10-20. Review of commit `36278c1` (revision 5.25, with the protocol layer built for CDP, BiDi and patched WebKit, and launches by executable path) on L1, CONCEPTS.md, against the contract L0 now gives it (`src/internal/adapter.ts`, review 08), and on what a first slice through all three layers needs: the README's program, launched, navigated, clicked and checked on every backend. Prompted by the maintainer: "let's do that next step". This commit records the review only.*

L0 is built, and so is the public API's shape, as declarations. Nothing sits between them: no model folds the adapter's facts, no `Browser` exists at run time, and the README's program doesn't run. CONCEPTS.md was written before the adapter contract, and building against it shows three kinds of gap: places where the two disagree, a part of L1 that CONCEPTS.md never designed (how a locator finds elements), and decisions every operation needs that the documents leave open (how an action waits, what an unbuilt member does).

The slice is this program, run against a local site on Chromium, Firefox and WebKit:

```ts
const program = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(site)
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("1 item").pipe(Expect.toBeVisible)
})).pipe(Effect.provide(Chromium.layer({ executablePath })))
```

## Candidates

### 1. Where CONCEPTS.md and the built contract disagree

**Where:** CONCEPTS.md §1, §2, §4, §7; `Firefox.layer`.

| CONCEPTS.md says | The contract does | Change |
|---|---|---|
| "Every public id is minted by L1" (§1) | The adapter mints every id, per connection, in L1's types (review 08, candidate 2) | §1 says the adapter mints them, in L1's types, and L1 never sees a protocol id |
| A document is `Active ⇄ Suspended` on confirmed evidence (§2, §4) | No backend reports suspension. Chromium and Firefox restores are recorded as new documents, `createdBy: Restored{from}`, after the old one ended; WebKit keeps no back/forward cache | §4 says restores are new epochs on every backend built, the "otherwise" branch it already describes; `Suspended` stays in the model for a backend that can confirm it |
| A document's `loading: LoadingResult` holds a post-commit failure (§2) | There is no fact for one; readiness reaches `interactive` and `complete` only | `loading` is marked not observed until a backend reports it |
| Precedence: Frame, then Page, then Context, then Browser (§7) | `DeclarationScope` is Browser, UserContext or Page; the API declares nothing on a frame | §7 drops Frame until a declaration needs it |
| — | `Firefox.layer` requires `ChildProcessSpawner \| FileSystem`, but Firefox has no pipe: its launcher dials BiDi's WebSocket | `Firefox.layer` and `layerConfig` require `Socket.WebSocketConstructor` too |

**Recommendation.** Adopt.

### 2. L1 is a fold of facts into entities, one model per connection

**Where:** CONCEPTS.md §2; a new `src/internal/model.ts`.

**What changes.** The adapter's sink is L1's fold. It runs in receive order, before the adapter publishes the event, and is the only writer of entity state (§2). The slice folds what its operations read:

| Fact | Entity |
|---|---|
| `UserContextAdded`, `UserContextRemoved` | a context: id, whether default, its pages, `closed` |
| `PageAdded`, `PageReady`, `NavigableRemoved` | a page: id, context, kind, status (`Open{url, document, prompt}` or `Closed{reason}`), `closed` |
| `DocumentCommitted`, `DocumentUrlChanged`, `DocumentReadiness` | the page's active document: id, URL, readiness |
| `RealmAdded`, `RealmRemoved` | the realms of a document, by world |
| `NavigationStarted`, `NavigationEnded` | a navigation: its outcome, latched once |
| `RequestSent`, `ResponseReceived` | the responses of navigation requests, so a committed navigation can carry its response |

Each entity is its immutable fields plus one `SubscriptionRef`, and a `Deferred` for its end. Connection loss ends everything with `ConnectionLost`. Facts the slice doesn't fold (frames' own documents, other requests, console, downloads, obligations) are listed as not built; they belong to the modules that consume them.

**Recommendation.** Adopt.

### 3. Locators resolve through one engine of our own, in the utility world, on every backend

**Where:** a new CONCEPTS.md section, "Queries"; `Locator.Queries`' JSDoc; a new `src/internal/engine.ts`.

**What changes.** CONCEPTS.md defines the readiness predicates (§8) but never how a locator finds elements, and the two must agree on what "the element" is. The options are the browser's own accessibility tree (CDP's `Accessibility.queryAXTree`, BiDi's `locateNodes` with an accessibility locator) or an engine of ours. Three engines' trees differ in edge cases, WebKit's protocol has no such query, and an action needs the element in the utility world anyway to check it. So:

- **One engine, ours, the same on every backend.** It is a self-contained function in our source, evaluated in each document's utility world (`adapter.realm(document, Isolated)`) and installed on first use, as WebKit's evaluation helper is. Its source crosses as text, so it needs no bundler; a test holds that it has no free variables. A locator is data, a list of steps the engine interprets, so a locator means the same thing in every browser, and a test of it on one backend speaks for all three.
- **The tree it searches** is the document's composed tree: open shadow roots are searched, closed ones aren't, and iframes are entered only through `frame()`. Matches come in tree order.
- **`getByText`** matches the smallest element whose text matches: an element matches when its text does and no child element's text does, so `<p>1 <b>item</b></p>` is found by "1 item". Text is the text content through open shadow roots, skipping `script`, `style`, `noscript` and `template`, with whitespace collapsed and trimmed; a button-like `input` contributes its value. Not `innerText`, which depends on layout, differs between engines and is slow over every element. A string is a case-insensitive substring; `exact` is equality, case-sensitive; a `RegExp` is tested as given. The JSDoc's "rendered text" becomes this rule.
- **`getByRole`** takes an element's role from its `role` attribute (the first token the engine knows), or else its implicit role under HTML-AAM, from a table in the engine. Its name is computed under accname 1.2: `aria-labelledby`, `aria-label`, the native label (`label`, `alt`, `caption`, `legend`, a button's value), the content for roles named from content, then `title` and `placeholder`. Elements excluded from the accessibility tree (`aria-hidden`, `display: none`, `visibility: hidden`, the `hidden` attribute) are skipped unless `includeHidden` is set. A name matches as text does.
- **The other queries** follow from those: `getByLabel` matches labelable elements by their label (`label[for]`, a wrapping `label`, `aria-labelledby`, `aria-label`); `getByPlaceholder`, `getByAltText` and `getByTitle` match their attribute; `getByTestId` matches `data-testid` exactly; `locator(css)` runs `querySelectorAll` in the document and each open shadow root, and a malformed selector fails with `InvalidInput` at once.

**Recommendation.** Adopt. Playwright's injected script is evidence for the role table, not a template; Testing Library's `dom-accessibility-api` would need a bundler to put a dependency into the page.

### 4. An action checks in the page at each rendering opportunity, and dispatches once

**Where:** CONCEPTS.md §5 and §8; API.md, Locators.

**What changes.** CONCEPTS.md leaves to L2 "whether to wait, scroll, activate or fail" and says nothing about how often an action re-checks. A timer would be a cadence nobody chose, and every check an action makes is about layout, which changes only when the page renders. So an attempt is one evaluation that resolves the locator and runs the checks at each animation frame, in the page, until they pass or a round's cap (one second, or what is left of the deadline) runs out:

1. **Resolve.** No match is `NotReady{NoMatch}`; two or more fail at once with `StrictViolation`, counting hidden matches.
2. **Check**, in the documented order: visible, enabled, notInert, inViewport (scrolling the element to the centre of the viewport when it is outside, once, recorded in the span), stable (the rect unchanged across *k* frames), and receivesPointer (`elementFromPoint` at the action point, through open shadow roots, lands on the element or a descendant). A round that sees no frame ends `NotReady{NoRenderingOpportunity}`.
3. **Act.** Ready, L1 takes the page's input permit (a `Semaphore`), checks again in one evaluation, and dispatches the pointer move, down and up at the point: the padding box's centre, or `position` from its top left, in viewport CSS pixels. From the first input event the dispatch may have been sent, and nothing is retried.
4. **Fail** with the deadline: `Timeout{phase: waitingForCondition}` with the last `NotReady` reason and its de-duplicated history, so "covered by `div.toast`" is the error.

`trial` stops after step 3's check. The guard on the first trusted event (§8, ReceivesPointer), coordinates in child frames and `dblclick`, `hover` and the other actions are listed as not built.

**Recommendation.** Adopt.

### 5. Expectations re-check at the interval until change signals exist

**Where:** API.md, Expectations; CONCEPTS.md §9.

**What changes.** API.md re-checks an expectation when the model invalidates a key the subject depends on, and at `Expect.CheckInterval` for conditions with no change signal. Visibility is such a condition. The slice builds the interval and no keys, which is what visibility needs, and lists invalidation by DOM mutation as not built. `toBeVisible` passes when exactly one element matches and is visible; zero matches, several, or a hidden one are observations it keeps re-checking, and the failure reports the last one and the history.

**Recommendation.** Adopt.

### 6. A member that isn't built fails as a defect that names it

**Where:** every object the slice builds: `Browser`, `UserContext`, `Page`, `Locator`.

**What changes.** The interfaces are the finished design, and the slice builds a few members of each. An object must still have every member, so each one not built yet is `Effect.die(new NotBuilt({ member }))`, or a function returning it: a defect, because it is a gap in the library and not a condition of the browser a caller could handle, and loud, never a no-op. Module-level functions not built stay declarations, absent at run time. PROTOCOL.md lists what is built.

**Recommendation.** Adopt.

### 7. The backend layers are the launcher, the adapter and the model

**Where:** `Chromium.layer`, `Firefox.layer`, `WebKit.layer` and their `layerConfig`; `Browser.Browser`, `Browser.newPage`; the `Deadline` module.

**What changes.** A layer launches the executable it names, connects the backend's adapter with `ownership: "launched"`, builds the model and provides `Browser`; closing it closes what the program owns and then the browser. `Browser.newPage` creates a context and a page in it, both owned by the caller's scope, which closes the page and removes the context. `goto` asks the adapter to navigate, waits for that navigation's outcome, maps a failure onto `PageError`'s navigation reasons, and for `waitUntil` waits for the committed document's readiness, all under one deadline. The `Deadline` module is built as API.md declares it, since every operation reads it. `Watchable` is built over a `SubscriptionRef`; Effect 4 has no public way to subclass `Effect`, so a watchable is an effect value with its members attached.

**Recommendation.** Adopt.

### 8. One test of the slice, written once, run on every backend

**Where:** `test/integration/slice/`.

**What changes.** The README's program runs against a shop page on the local site, through the public API only, on all three backends, as the adapter's conformance suite does. Beside it: a button rendered late (the click waits), one disabled then enabled, one below the fold (scrolled to), one covered (the timeout names what covers it), two matches (`StrictViolation` at once), a failed navigation (`NavigationFailed`), and an expectation that never holds (`ExpectationFailed` with its history). The engine's queries get a browser-free test of the role and name rules too, against a DOM in each browser rather than a simulated one.

**Recommendation.** Adopt.

## Considered and not adopted

- **The browser's accessibility tree for `getByRole`.** It is what assistive technology sees, which is the point of a role query, but it differs per engine, WebKit can't be queried, and the element still has to reach the utility world to be checked. The engine's role and name rules are tested in all three browsers instead.
- **`innerText` for text queries.** It depends on layout and CSS, differs between engines, and forces layout for every candidate.
- **Re-checking actions on a timer, or with backoff.** A timer is a cadence nobody chose, and backoff adds lag the longer a test waits (rule 23); rendering is when layout changes.
- **A typed `Unsupported` for unbuilt members.** It means the browser can't, and a caller would handle it as such.
- **Building the event modules, frames or the agent toolkit in the slice.** Each consumes facts the model will fold the same way; they come after the slice proves the layering.

## Decision

Adopted, 2026-10-20, under the maintainer's direction to review L1 and build the slice. The revision follows this commit, and the build records where it differs.
