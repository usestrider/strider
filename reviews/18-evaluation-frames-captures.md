# Design review: evaluation, frames, captures and storage

*2026-10-23. Review of commit `e418b97` (declarations built, after review 17) on batch 3 of the five proposed after review 14, all still declared but not built:*

- *evaluation and handles: `page.evaluate`, `evaluateInMainWorld`, `evaluateHandle`, `JSHandle`, `Locator.evaluate`, `Page.withUserGesture`;*
- *frames: `page.frame`, `Locator.frame`, `FrameLocator`, `Page.frames`, and coordinates in child frames;*
- *snapshots: `page.snapshot`, `Locator.snapshot`, refs, diffs, `Expect.toMatchAria` with `AriaPattern`, and `ExpectationFailed`'s `nearest` and `suggestions`;*
- *captures: `page.screenshot`, `page.pdf`, `page.readHtml`;*
- *storage: `context.cookies`, `page.localStorage` and `sessionStorage`, `context.exportStorageState`, and `UserContext.Options.storageState`, which is the rest of call site 1.*

*Prompted by the maintainer: "do the next batch when you're done". This commit records the review only.*

L0 has most of the mechanism:

- **Evaluation:** in any realm, by value or by handle, with user activation where the backend grants it, and the serializer review 14 built for workers.
- **Captures:** screenshots on every backend and PDFs on two.
- **Cookies:** read, set and cleared per context.
- **The engine** runs in each document's utility world and already computes roles and accessible names for `getByRole`.

Three things are missing, and they are the substance of this batch:

- **Locating across documents.** The engine resolves a locator in one document, and a frame is another document, often another process.
- **The accessibility tree as data.** A snapshot needs the engine's roles and names as a tree, with refs that point back at the nodes.
- **Storage beyond cookies.** Origin storage and IndexedDB have no protocol on two of the backends, and a new context's storage has to be written before any of its pages exist.

## What the browsers do

Probed through the three adapters on the pinned builds (a throwaway test, not kept).

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** A click at page coordinates over a same-origin iframe's button, its content box found by adding the iframe's position, border and padding | lands | lands | lands |
| **P1.** The same over a cross-site iframe | lands | nothing reaches the frame, not even `pointerdown`, though the page's hit test at the point is the iframe | lands |
| **P2.** The same click sent to the frame's own browsing context, in the frame's coordinates | — | lands, same-origin and cross-site | — |
| **P3.** An iframe's `contentWindow`, returned by handle | an object with no frame id | an array-like with no frame id | the same |
| **P3.** What names an iframe element's frame | `DOM.describeNode`'s `frameId` | a window proxy's `context`, by value | `DOM.describeNode`'s `contentFrameId` |
| **P4.** Screenshots of a 400×300 viewport at 2×: the viewport, a clip, a clip below the fold, the full page | 800×600, 200×100, 200×100, 800×4000: device pixels | the same, but the full page is 776 wide, without the scrollbar | as Chromium |
| **P4.** JPEG at quality 50 | yes | yes | yes |
| **P5.** Cookies a page set, as each backend reports them | an unspecified `SameSite` is absent; a partitioned (CHIPS) cookie names its top-level site; a priority | an unspecified `SameSite` is absent; no cookie says it is partitioned | an unspecified `SameSite` reads `Lax`; `Secure` cookies an `http://127.0.0.1` page set are dropped |
| **P5.** A cookie set again with an expiry in the past | removed | removed | removed |
| **P5.** A cookie set for another site before any page of it exists | sent by that site's first page | the same | the same |
| **P6.** `localStorage` and `sessionStorage` written from the isolated world, read in the main world | the same storage | the same | the same |
| **P7.** IndexedDB from the isolated world: a store with a key path, auto-increment and an index; a record with a `Date` and a `Set`; `indexedDB.databases()` | all of it | all of it; the record's `Date` and `Set` aren't `instanceof` the sandbox's, since they are the page's | all of it |
| **P8.** Another origin's `localStorage` written from a temporary page whose document a route fulfills, then read by a real page of that origin | there | there | there |

## Candidates

### 1. Evaluation and handles

**Where:** `Page`, `Locator`, `JSHandle`; `src/internal/evaluation.ts` (new); the adapter contract.

**What changes.**

- **`page.evaluate`** calls the function in the isolated world for the caller's code, `__strider_isolated__`, which isolated init scripts already use, in the page's current document. `evaluateInMainWorld` calls it in the page's own world, with user activation inside `Page.withUserGesture`, a `Context.Reference` now built. Arguments and results cross by value through review 14's serializer: a value that can't cross fails with `NotSerializable{path}`, and a throw with `EvaluationThrown`, both in `PageError`.
- **`page.evaluateHandle`** returns a `JSHandle` owned by the caller's scope. A handle's `evaluate` and `evaluateHandle` pass it first, `read` returns its value, and `release` releases it, idempotently. A handle whose realm ended fails with `TargetGone{RealmDestroyed}`.
- **`Locator.evaluate`** resolves the one match at once, as a read does (`NoMatch`, `StrictViolation`), and passes the element first, in the caller's isolated world.
  - The engine's world isn't the caller's, so the element crosses by its node binding. The contract's `LocalValue` gains `Node{binding}`.
  - CDP and WebKit resolve the binding into the target realm (`DOM.resolveNode` with an execution context).
  - BiDi passes its shared id, which every realm of the document understands.

**Recommendation.** Adopt.

### 2. Frames are entered by their element

**Where:** `Locator`, `Page`; the engine; `src/internal/frames.ts` (new); `runtime.ts`; the adapter contract.

**What changes.**

- **A frame locator is a boundary in a locator's steps.** `page.frame(iframe)` and `locator.frame(iframe)` add the iframe's steps and a `Frame` step; what follows resolves in that frame's document.
  - L1 splits the steps at each boundary and resolves each part with the engine of its own document.
  - The iframe element must be the one match.
  - The contract's new `contentFrame(binding)` names the frame it holds (P3): CDP's `DOM.describeNode`, BiDi's window proxy `context`, WebKit's `contentFrameId`.
  - A frame is entered again on every attempt, so an iframe that navigates or is replaced is followed, as any locator is.
  - Same-origin and cross-site frames go the same way, so none of this depends on what a page can reach.
- **Coordinates.** The engine answers an action point in its frame's viewport. L1 adds each ancestor iframe's content-box origin, which the engine in the parent document reports, to get the page's coordinates.
  - The input names the frame and its origin. CDP and WebKit send page coordinates, which reach every frame (P1). BiDi sends the frame's coordinates to the frame's own context (P2), since Firefox doesn't deliver page coordinates into a cross-site frame.
  - The iframe is scrolled into view in its parent before the frame's checks run.
  - The action point must hit the iframe in its parent as well as the target in the frame: a frame's `receivesPointer` is checked in every document on the way down.
- **`page.frames`** is a `Watchable<FrameTree>` of the model's frames, each with its document's URL. `name` is `None`: no backend reports a frame's name, and reading `window.name` would need its document.
- **Not built:** a frame's own evaluation (`frame.evaluate`): the API declares none, and `Locator.evaluate` on an element inside a frame covers it.

**Recommendation.** Adopt.

### 3. Snapshots are the engine's accessibility tree

**Where:** `Snapshot`; `page.snapshot`, `Locator.snapshot`; the engine.

**What changes.**

- **The tree.** The engine walks its document's flat tree, as `getByRole` does, with the same roles and names:
  - An element with a role is a node; one without (`generic`, `none`, `presentation`) gives its children to its parent. Hidden elements (`aria-hidden`, not rendered) are left out.
  - Text is a node, unless it only repeats its parent's name.
  - States: `checked`, `expanded`, `selected`, `disabled`, `focused`, `pressed`.
  - An iframe is a node whose children are its frame's tree, which L1 stitches in.
- **Inferred interactivity**, the default (`sources: "aria+interactivity"`). An element with no role becomes `clickable`, `editable` or `focusable` when it shows evidence: `cursorPointer` (computed, unless its parent shows it too), `tabindex`, `contentEditable`, `onclickAttribute`. Its name, if it has no accessible one, is inferred from its `text`, `title`, `placeholder`, `alt` or a `nearbyLabel`, and tagged with where it came from. `clickListener` needs the backend to list listeners; it isn't built (`snapshot.clickListeners`, unsupported everywhere for now).
- **Refs.** Every element node has a ref, kept by the engine for its document: the same node keeps its ref while the document lives. `snapshot.ref(id)` is a locator pinned to that node, in its frame; once the node, its document or its generation is gone, acting on it or reading it fails with `StaleRef{why}`, and it never rebinds.
- **`text`** is the tree as indented YAML: `- button "Save" [ref=e9]`, and `- clickable "Add" [ref=e3] [inferred: cursorPointer]`.
- **Options and diffs.** `depth` and `interactiveOnly` narrow the tree. `snapshot.diff(previous)` compares refs: nodes added, refs removed, nodes whose role, name or states changed. It fails with `DocumentsDiffer` across documents.

**Recommendation.** Adopt.

### 4. `toMatchAria`, and what a failed expectation says

**Where:** `AriaPattern`, `Expect`; the engine.

**What changes.**

- **Patterns.** `AriaPattern` is built as data the engine reads:
  - `node(role, name, children)`: a name is a string matched whole, after collapsing whitespace, or a `RegExp`, and `""` means no accessible name;
  - `text(value)`;
  - `exactly(...)`: these children, in order, and no others;
  - `including(...)`: in order, others between;
  - `unchecked`: children not compared.
- **Matching.** `Expect.toMatchAria(pattern)` matches the locator's one match against the pure accessibility tree (`sources: "aria"`), waiting in the page as the other matchers do. What it saw is the subtree's `text`.
- **`nearest` and `suggestions`.** They are filled when an expectation fails with nothing matched.
  - `nearest` is the accessibility text of the element the longest matching prefix of the locator's steps found, two levels deep.
  - `suggestions` are locators for elements near it whose role matches and whose name is close: contains, is contained in, or is within two edits, case-insensitively.

**Recommendation.** Adopt.

### 5. Captures

**Where:** `page.screenshot`, `page.pdf`, `page.readHtml`; the adapter contract.

**What changes.**

- **Screenshots** map the options onto the contract:
  - `area`: the viewport; `FullPage`; `Clip`, in the document's coordinates and beyond the viewport (P4); or `Element`, whose box the engine measures, a frame's included.
  - `format`: PNG, or JPEG with a quality.
  - `scale: "css"`: CDP scales the capture by the device pixel ratio's inverse. BiDi and WebKit capture device pixels only (`screenshot.cssScale`), so the default stays `"device"`.
  - `omitBackground`: CDP's transparent default background; WebKit's, where its protocol has it; refused elsewhere (`screenshot.omitBackground`).
  - The contract's `ScreenshotOptions` gains `scale` and `omitBackground`.
- **PDFs** map paper names and lengths to inches. Headers and footers are CDP's (`pdf.headerFooter`). WebKit has no PDF (`pdf`, as now).
- **`readHtml`** is the document's doctype and `outerHTML`, from the isolated world.

**Recommendation.** Adopt.

### 6. Cookies are a context's, origin storage a document's

**Where:** `CookieJar`, `OriginStorage`; `context.cookies`, `page.localStorage`, `page.sessionStorage`.

**What changes.**

- **Cookies.**
  - `list` reads the context's cookies; `listFor(url)` filters them as a request to the URL would, by domain, path, `Secure` and expiry.
  - `set` writes one. `remove(match)` sets each match again with an expiry in the past (P5), and `clear` clears them all.
  - A change acts once; a scope doesn't undo it.
- **The `Cookie` schema says what's known.**
  - `sameSite` is an `Option`, `None` where the cookie didn't say: the browsers' defaults differ, and WebKit reports `Lax` for it (P5).
  - `priority` is an `Option`, Chromium's alone.
  - `partitionKey` is `Partitioned` where the backend reports a partition: only CDP does. A partitioned cookie set where the backend can't set one fails with `Unsupported` (`cookies.partitioned`).
- **Origin storage.** `localStorage` and `sessionStorage` read and write the current document's storage from the isolated world (P6). `entries`, `get`, `set`, `remove` and `clear` are built. A `Redacted` value is written as its value and never logged.

**Recommendation.** Adopt.

### 7. Storage state, IndexedDB included

**Where:** `StorageState`, `context.exportStorageState`, `UserContext.Options.storageState`.

**What changes.**

- **Export.** `exportStorageState` is the context's cookies and, for every origin of a document open in its pages and frames when it runs, that origin's `localStorage` and IndexedDB. A cross-site frame's storage is partitioned by its page's top-level site, and says so.
- **IndexedDB.**
  - Each database's version and stores are read in the isolated world, each store with its key path, auto-increment and indexes (name, key path, unique, multi-entry), and its records.
  - Records cross in an encoding of ours, so a `Date`, `Map`, `Set`, `ArrayBuffer` or typed array survives. Firefox's are the page's objects, so types are told by their tag, not `instanceof` (P7).
  - A value that can't be encoded (a `Blob`, a `File`) fails the export with `Unsupported`, naming its database and store.
  - The schema gains the key path, auto-increment and indexes, which restoring needs.
- **Import.** `UserContext.Options.storageState` is applied before the context's first page.
  - Cookies are set first.
  - Each origin's storage is written from a temporary page whose document a route of ours fulfills (P8), from a frame of a page at the partition's top-level site where it is partitioned.
  - The temporary page is closed, and the span records each origin.
  - A partitioned cookie the backend can't set fails the context with `Incompatible{partitions}`, and nothing is applied partly.

**Recommendation.** Adopt.

### 8. Tests, on every backend

**Where:** `test/integration/slice/`; the conformance suite.

**What changes.** A sixth slice suite:

- **Evaluation:** values, a throw, `NotSerializable`, handles and their release, `Locator.evaluate`, the main world and a user gesture.
- **Frames:** reads, actions and expectations inside a same-origin and a cross-site frame, nested; a frame that navigates; `page.frames`.
- **Snapshots:** the tree, inferred interactivity, refs and `StaleRef`, diffs, a frame's tree.
- **Call site 16:** `toMatchAria`, and `nearest` and `suggestions`.
- **Captures:** screenshots of each area and format, and `Unsupported` where not; a PDF.
- **Storage:** cookies, origin storage, and call site 1 to the end: export, encode, decode, and a new page signed in. The state includes IndexedDB and a partitioned frame's storage.

The conformance suite adds `contentFrame`, node arguments across worlds, and input sent with a frame.

**Recommendation.** Adopt.

## Considered and not adopted

- **Page coordinates into every frame, as on CDP.** Firefox doesn't deliver them into a cross-site frame (P1).
- **Reaching a same-origin frame's document from its parent's engine.** It works only same-origin, and a cross-site frame needs the per-document route anyway.
- **The browsers' own accessibility trees** (CDP's `Accessibility.getFullAXTree`; none on BiDi or WebKit). Ours is the same on every backend, and it is the one `getByRole` matches.
- **Exporting only cookies and `localStorage`, as Playwright does by default.** A login kept in IndexedDB would be lost silently.
- **Seeding storage with an init script on each origin's first document.** It needs state in the page, which the page could see, and it never writes until a page of that origin loads.
- **Click listeners from CDP's `DOMDebugger.getEventListeners`.** It costs a command per element, and on CDP alone.

## Decision

Adopted, 2026-10-23, under the maintainer's direction to build the next batch. The revision follows this commit, and the build records where it differs.
