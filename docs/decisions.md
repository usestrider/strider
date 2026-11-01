# Decisions

The principles and architectural decisions behind Strider, with the alternatives rejected and why, so that a settled
question stays settled unless the evidence changes. The layer documents (README.md, API.md, CONCEPTS.md, PROTOCOL.md,
CLI.md) state the contracts that follow from them.

## Principles

**Strider drives stock browsers and depends on nothing but Effect.** The maintainer: "I don't want to use the
playwright builds at all, I want my own versions of everything, ideally using stock as much as possible. playwright
builds are immediately detected by bot protection", and "How does that not align with my goal of no dependencies from
the start?" A patched browser is a dependency as much as a package is. Its protocol changes whenever its vendor rolls
it, users can get it only through the vendor's installer, and its patches are a fingerprint. Rejected: Playwright's
WebKit build as an option, and a patched WebKit of our own. Where a feature would need a dependency, it isn't built.
Only Firefox records a video file, because turning Chromium's or WebKit's frames into one needs an encoder. A trace's
DOM capture is our own code. Playwright's snapshotter is read to learn what the trace viewer expects, never copied or
shipped, and there is no viewer of our own, since trace.playwright.dev already runs anywhere.

**The library installs nothing.** "I don't think I want the library to automatically install anything for the
user." There's no download default and no install command, because the tools that already install browsers remain:
an operating system's packages, a vendor's installer, Nix.

**A launch never picks a browser nobody named.** A launch takes an executable path. There are no channels, no
default to an installed browser, and no lookup on `PATH`. Any of those would launch different programs from a
terminal, an editor's test runner and CI. No channel table reaches NixOS, Snap, Flatpak, Guix or the open-source
Chromium ("I think that will fall apart on various flavors of linux, like NixOS"). Finding a browser is
`strider browsers`, a command a person or agent runs once to copy a path from. It isn't a library function, because
a program would call it at launch. On NixOS it lists the profile's link, which survives updates, not the store path.
Any Chromium or Firefox version is accepted, because their protocols change slowly and compatibly. `Browser.Info`
says what connected.

**Playwright is evidence, not the template.** Each feature Strider shares with Playwright is there because one of our
principles produces it:

- Lazy locators: a held element goes stale, a query doesn't.
- Strictness: ambiguity fails at once instead of picking an element.
- Actionability checks are named, adjustable per call and reported in errors.
- Retrying expectations: a retry has a name and is asked for in code.
- Contexts and storage state: isolation per user context is a spec concept, and export is deliberate.
- Routes: an intercepted request gets exactly one decision.
- Init scripts: declarations with stated timing.
- Snapshot text with refs: one rendering of a structured, evidence-tagged tree.
- `Browser.newPage`: a convenience documented as its expansion.
- Launch flags: a visible `LaunchProfile`, where Playwright adds them silently.

Where Playwright's surface is a string DSL, or overlaps itself, ours isn't and doesn't. `toMatchAria` takes a typed
`AriaPattern`, not a YAML template with its own matching rules to specify and parse. The page clock's modes are data
in `install(mode)`, not `setFixedTime` beside `install({ mode: "fixed" })`.

**Outcomes come from evidence, never from a guess or a timer.** An adapter reports what the protocol showed. Firefox
reports an unhandled rejection exactly as it reports a throw, so its exceptions are `kind: "unknown"`, not guessed
from a missing stack, since a throw can lack one too. Nothing waits for a settling window after an action. Something
would have to decide how long to keep watching: Playwright's MCP server waits 500 ms, and Chrome DevTools MCP waits
for the DOM to stay quiet. The agent digest's boundaries are calls, not time, and it claims no causation. Whether the
DOM changed is an explicit `snapshot.diff`. Evidence supports recovery, but it never proves the business action
happened: a fully acknowledged gesture doesn't show the application acted on it.

**The library changes nothing the caller didn't ask for.** Contexts don't emulate focus by default
(`UserContext.Options.focus` is `"system"`), because every page would then report focus and visibility it doesn't
have. The library doesn't bring a page to the front before acting, because that changes which page is in front
without the caller asking. A page that can't render says so (`NoRenderingOpportunity`) and names the two remedies.

**Nothing of the library's runs in a page's world unless the caller declared it.** "Never a wrapper in the page." A
page can see a wrapper, for example that `alert` isn't the browser's, and bot detection looks for exactly that. So:

- On stock WebKit, whose Automation reports a dialog without its kind, a dialog is `Dialog.Unknown` rather than
  learned from wrapped dialog functions.
- A trace capture reads each sheet's `cssRules` from the isolated world instead of hooking CSSOM methods.
- A storage state is restored through routed pages of the new context, not init scripts that would carry it into
  pages where their scripts could read it.
- The query engine is one self-contained function in our source, with no library in the page.

What does run in the main world is what the caller declared: their init scripts and the page clock.

**The design is checked as compiled code.** A compiler checks what prose can't:

- whether an ordinary verb's error channel stays small;
- whether a caller's `E` and `R` survive the combinators;
- whether ordinary call sites stay free of `Scope` and platform services.

A scenario that needs protocol knowledge or repeated ceremony is a defect in L1. Features are built one at a time,
each a slice through L1 and L2 that runs on every backend through the public API. Each shared L1 mechanism is built
once, in full, the first time a feature needs it.

## The protocol layer (L0)

**A target's initialization gate never waits on another target.** A paused popup blocks its opener: `window.open`
doesn't return until the popup resumes, and the opener's commands get no reply. Waiting on an opener, or on any other
target, deadlocks until a timeout. Targets Strider doesn't control that attach paused are resumed at once.

**`PageAdded` comes before `PageReady`.** L1 needs a page's id while its gate runs, for declarations scoped to the
page and for its opener's `Popup` event. So a page isn't held back until its gate finishes.

**On CDP, popups are paused browser-wide or not at all.** Only auto-attach pauses a target before its scripts run.
Discovering targets and attaching on `targetCreated` comes too late, so pausing per opener isn't possible.

**Stock WebKit is driven over its inspector socket, by a client of our own.** Rejected:

- `WebKitWebDriver` as a go-between: one more process, with no events and nothing the socket can't do.
- Starting Xvfb inside the library: a display server the program didn't ask for. A program that wants no visible
  window provides a display.

Stock WebKit with a reachable automation mode is WebKitGTK and WPE, on Linux. On macOS, WebKit is Safari, reached
through `safaridriver` or Safari Technology Preview's WebDriver BiDi. Windows has no stock WebKit browser.

**On launched stock WebKit, each context is a browser process.** An Automation session has one profile, so
`Browser.newContext` launches another browser. Sharing one browser between contexts would make two `Browser.newPage`
calls share cookies without saying so. The cost was accepted: a second browser's session is ready about 0.6 s after launch, and each browser is up to
0.8 GB resident.

**An id an adapter minted that has ended is `Gone`; only one it never minted is `Foreign`.** L1 can name a page,
document or realm in the moment between its end in the adapter and the fact that tells L1, and `Operation.fromAdapter`
raises `Foreign` as a defect, so that race must not be `Foreign`. The adapter kit (`adapterKit.ts`) knows what a
connection minted as ranges of each kind's counter, a few numbers however many ids. Rejected: a tombstone per ended
entry, which grows with every request and realm, or forgets and turns `Foreign` again once bounded; and prefixing ids
with their connection, which would change every id L1 and the tests see.

**Adapters keep their state in one object their per-domain modules take, on a shared kit.** Each adapter was one
closure of 3,000 lines over two or three dozen tables, so nothing in it could move to a file of its own, and the three
had copied the same bookkeeping and drifted apart: an empty reference sent for a handle not held, empty bytes for
base64 that didn't decode, a race in reporting a navigation that never started, and two ways each to wait for a
document's realm and to send what the fold can't wait for. The kit holds that bookkeeping once: ids, the fact buffer,
waits on the model checked after each flush, commands the fold can't wait for in a `FiberSet` in the connection's
scope, expectations, typed event handlers and value handling. Rejected: a base class, which would bring back one
object closing over everything; and a fully generic navigable tree, since each protocol commits documents and
realms differently (CDP keeps the initial realm, WebKit drops a replaced document's, BiDi restores from its past), so
the kit takes hooks for its tables instead.

**A transport frames and routes; what a message means is its adapter's.** Stock WebKit numbers frames, loaders and
requests anew in each web process (QUIRKS.md, Q195). Its transports qualified those ids inside each page's messages,
by method, and answered a command to a page that was gone with an error of their own, so every message from a page
was parsed and written out again twice before the wire parsed it, and a page's message that didn't parse was a
defect in the transport's fiber. Now the WebKit adapter keys a target's ids by its session, as it keyed requests
already, and the transports, through the envelope's endpoint (`webkitEnvelope.ts`), only put a page's `pageProxyId`
in its text and route commands by it: the wire parses each message once, and a malformed one loses the connection.
A command to a page that can't be reached is dropped; the page's end, which follows, fails it. Rejected: a wire
decorator that qualifies decoded messages, which would still rewrite messages by method name, away from the tables
that need the ids, and can't see which command a reply answers.

## The browser model (L1)

**The fold is the model's one writer, and a caller's setting is a command in its stream.** Every write goes through
the fold: entity state, and the caller's settings (handlers, routes, a context's options, a page's owner, grants, a
`beforeunload` stay). The adapter's facts and the caller's commands are one inbox, applied one at a time in arrival
order with the model's context, and registering returns once the registration is applied. Who decides an obligation
is chosen as its opening is folded. Each entity has one state, whose ref only the fold holds; readers get its read
side and entities by id, never the model's tables. Deciding, releasing and installing the engine happen apart, and
send back what they write.

- **Why.** CONCEPTS.md said the fold was the only writer, and the code didn't do it: a page had three refs and five
  mutable fields, and eleven places outside the fold wrote the model's maps. A handler registered after a dialog
  opened could still decide it, depending on when the decider's fiber ran, so whether a handler applied was a race
  between a fact and a registration. In one stream, the order is defined: what folds after a registration returned
  is the registration's. A ref only the fold holds makes the rule a compile error to break.
- **Who applies.** An input that finds the fold idle is applied at once on its caller's fiber, then whatever arrived
  meanwhile; one that finds a step running waits for the fiber applying it. A protocol event's facts are applied back
  to back, as they were, so a reader never sees half of one.
- **Exceptions.** A page's input state is the input permit's holder's to write, at the rate of input events. Where
  the engine is installed is the runtime's `Cache`, which dedupes concurrent installs: an install waits on the
  browser, which no step may do, and the memo is neither the browser's state nor a caller's setting.
- **Rejected:** settings the caller writes directly, as they were, which leaves the race and a rule only prose
  states; leaving it as it was and correcting CONCEPTS.md instead, which keeps the race; a fiber of the fold's own
  taking from a queue, which costs every fact two scheduler turns and lets readers run between a protocol event's
  facts (a Chromium EventSource's first message reached a subscription made on its connection's event); and a
  `Semaphore` callers take in turn, which isn't first-come first-served and runs each step with its caller's
  operation and deadline in context, for whatever the step forks.

**Backend failures are typed reasons, not defects.** A reply outside the supported schema is an external
compatibility failure, not a broken invariant of the caller's program. A long-running service must be able to catch,
report and isolate it without `catchCause` and without losing its other jobs. The error channel stays small because
the failure is a reason, `BackendFailure{Rejected | IncompatibleResponse}`, inside the module's error.

**An operation keeps its own deadline.** There is one deadline per operation, inherited by nested calls and only
ever shortened. The operation reads the deadline and fails with its own evidence of how far it got, instead of being
interrupted from outside as `Effect.timeout` would. The deadline runs on the clock the browser runs on: the live
clock for a real browser, even under `TestClock`, and Effect's clock for `Browser.layerTest`.

- **Why the browser's clock.** A real browser is another process, and nobody adjusts the test clock in a browser
  test, so a deadline on it would never fire: a test whose button was renamed would hang until Vitest stopped it,
  with none of the evidence the deadline exists to give. `Browser.layerTest`'s timeline runs on Effect's clock, so
  beside it a live deadline would pass or not by how fast the test ran.
- **Rejected:** `Effect.timeout` around each operation, which interrupts and loses what the operation knew; and one
  clock for both, either way round.

**An operation's deadline bounds every command it sends.** L1 calls the adapter through one wrapper
(`src/internal/boundedAdapter.ts`): inside an operation, each call ends at the operation's deadline with its
`Timeout`, and each command waits for its reply until that instant rather than for `Protocol.CommandTimeout`. Each
adapter method is classified once by what it does to the browser: a read, a write (marked sent before it goes), a
creation (run to completion apart, and closed if it finishes after the deadline), or a release (never bounded by an
operation, so cleanup happens after a deadline passed). A new method doesn't compile until it's classified.

- **Why.** Each operation bounded its own calls by hand, and 32 of 44 didn't: a cookie read, a declaration or a
  page's creation waited for the protocol's 30 seconds whatever the deadline, then failed as a `BackendFailure` the
  browser never sent, and under `TestClock` waited forever. A command a backend sends where it can't be interrupted
  has to end by itself, so the deadline is the command's, not only a race around the call.
- **Rejected:** bounding each call site by hand, the pattern that missed them; keeping `CommandTimeout` inside
  operations, which cuts a command short of a longer deadline and needs a reason of its own for "no reply"; and
  marking a read as sent, which would tell the caller something may have changed when nothing did.

**A page's release waits once, for the page's end.** When its owner's scope closes, an owned page's close is sent
in a fiber of the model's scope, and the release waits for the page's end, not for the close's reply first, under a
budget of its own: `Deadline.DefaultBudget` from when it starts. The close runs to its own end, its reply bounded by
`Protocol.CommandTimeout`, however the release ends. A close that fails without ending the page ends the wait, since
nothing else will. Halfway through its budget, a release still waiting logs a warning naming the page and what it
waits on, the close's reply or, once that came, the page's end; it warns again if it stops waiting with the page
still open, and when the browser refused the close.

- **Why.** The release waited for the reply, up to `CommandTimeout`, and only then for the end, up to its budget, so
  a browser slow on both kept a test's teardown about a minute (a WebKit frame test, under load, once). The page's
  end is what a page created next must not meet unfinished (QUIRKS.md, Q119 and Q135); the reply adds nothing once it
  came. The budget was the deadline in context, and a page's release, a finalizer of the scope it was created in,
  captured `UserContext.newPage`'s: a page closed after that deadline didn't wait for its end at all, and one closed
  before it waited what was left. A release is cleanup, which no operation bounds. A wait that stops without a word
  leaves a slow browser invisible, so it says which step it is stuck on; half the budget is derived from the bound
  itself, so a caller who sets `DefaultBudget` moves both.
- **Rejected:** a deadline of the release's own on the close, which would cut cleanup short (a close interrupted
  between Chromium's two commands never sends the second); forking the close as the release's child, which ends it
  with the release; a setting of its own for the warning, a second knob for one wait; and waiting out the budget
  after a refused close, which waits for nothing.

`Page.close` and a context's removal wait the same way. `Page.close` sends its close in a fiber of the model's
scope and is done once the page ends, whether or not the browser has answered; being an operation, it keeps its own
deadline, and fails with `Timeout` only when the page hasn't ended by then, with the browser's refusal, or with
`CloseCanceled` once a handler stays. A context the library created is removed when its scope closes by the
mechanism a page's release uses (`ownership.ts`, `Model.remove`): the adapter's `removeUserContext` returns once the
browser has answered, and reports the context's end, after its pages', as `UserContextRemoved`; the removal waits
for that end under `DefaultBudget` from when it starts, warns halfway naming the context and whether the browser has
answered or which of its pages haven't ended, and warns again as it stops. A command that fails because its target or
the connection is gone already ends either wait without a warning, since the fold reports the end, and a target that
has ended, as everything has once the connection is lost, sends nothing and isn't waited for.

- **Why.** `Page.close` waited for the reply and then the end inside one bound, so a page that ended before a late
  reply failed the close with `Timeout` though it was closed, and the bound interrupted the close, between Chromium's
  two commands if it fell there. Removing a context waited, in the CDP and WebKit adapters, for the dispose and then
  every page's session, with no bound at all: its finalizer ran under `Browser.newContext`'s captured deadline, which
  no adapter reads, so a browser that never ended a page held the scope's close forever, silently. The wait belongs
  in L1 because only the end differs by backend, and each adapter already knows its own: Chromium may answer the
  dispose before its pages' sessions end, a stock WebKit context's pages end with its process's connection, and
  Firefox answers `browser.removeUserContext` after the `contextDestroyed` events of its pages, which the adapter
  folds before it reports the end. So each adapter reports the end as a fact, as it does a page's, and L1 has one wait
  for both, with one set of warnings.
- **Rejected:** bounding each adapter's wait in its own way, three mechanisms with three warnings and the dispose
  still in the finalizer's fiber; keeping the wait in the adapter and racing the whole call in L1, whose warning
  couldn't tell the dispose's reply from the pages' ends; a deadline on the finalizer, which would interrupt the
  dispose; and `Page.close` waiting for the reply first, which reports a closed page as a timeout.

**An operation keeps a record, and its `Timeout` comes from it.** An operation notes facts as they happen: what it
observed, that its input or call may have reached the browser, that the browser confirmed it. Its `Timeout` takes its
phase from them, by the meanings `Deadline.Timeout` documents, and a wait inside it is bounded in one place, the
record's. An operation started inside another is a step of it, and adds itself to the enclosing record's `progress`
when it ends, moving the enclosing dispatch as far as its own went.

- **Why.** With helpers that each operation called by hand, every place an operation could fail chose its phase as
  a literal, which the compiler couldn't check: an evaluation that may still be running reported `resolving`, as if
  nothing had happened. Each wait chose its clock, so most waited on the fiber's, which `TestClock` replaces, and
  `progress` stayed empty on every failure but a launch's.
- **Rejected:** keeping the helpers with a check on how they map the deadline's failure, since phases would still be
  chosen by hand; the record as a parameter of the body, which would make the signature differ from `Effect.fn`'s and
  leave a helper unable to find the operation around it; and new phases for users' operations, since the five say
  where any operation stops and its steps say the rest.

**Init scripts are ordered, not overridden.** A later script wins only a last-write-wins assignment. It can't undo an
earlier script's listeners, requests, captured references or clock. So scripts are an explicitly ordered bundle per
world and document. Removing a script affects future documents only, and nothing that ran is rolled back.

**Every frame is resolved by its own document's engine, same-origin frames too.** Reaching into a same-origin iframe
from the parent's engine works only for same-origin frames, and a cross-site frame needs the per-document route
anyway. One path for both keeps locating independent of what a page's script can reach.

**A value means the same on every backend.** Where backends measure differently, Strider measures once itself. HAR
timings are an example. Chromium, Firefox and WebKit each time a response on their own base, so `wait` and `receive`
are measured on the library's monotonic clock. Recording each backend's own timings would make one HAR mean three
things.

**The page clock is a main-world shim, not Chromium's virtual time.** Virtual time exists only on Chromium, and it
stops rendering, which actionability's frame-based checks depend on. The library's isolated world keeps the real
timers and frames on every backend.

**A challenge no route answers gets the server's response, in a context the library creates.** Headless, a
browser's own answer to an authentication challenge is a prompt nobody sees: Firefox and stock WebKit wait on it, and
Chromium fails a navigation with `net::ERR_INVALID_AUTH_CREDENTIALS` and leaves a `fetch` waiting. A timeout that
stands for a prompt tells a test nothing it can act on, while the server's `401` page is what a visitor without
credentials sees. So every context the library creates pauses the challenges its backend can, and one no route
answers is canceled.

- **Why only documents on Chromium.** Chromium asks about a challenge only for a request it paused as it started, so
  asking about a subresource's would pause every request, a round trip each: about 0.17 ms over a local pipe, and a
  network's over a remote endpoint. A navigation pays one.
- **Rejected:** leaving the browser's answer, which turns a missing route into a timeout; pausing every request on
  Chromium, for the cost above; and canceling challenges in contexts the library didn't create, where a person's
  browser shows its prompt.

## The public API (L2)

**A decision that doesn't apply is a type error.** A dialog handler gets `Dialog.Pending`, whose shapes carry only
the decisions valid for that dialog: an alert can't be dismissed. A route's decisions are module-level values typed
by phase, `Decision<in P>`. Contravariance gives the same guarantee while keeping `Route.continue` and
`Route.fulfill` plain values a handler returns.

**A wait is an `Effect`, not a `Deferred`.** See [conventions.md](conventions.md#a-wait-is-an-effect-not-a-deferred).

**Users' operations are kept as the library's are.** `Operation.fn` and `Operation.named` give a user's helper what a
click has: one deadline for everything inside, a span named for it, and a `Timeout` that says how far it got. The
maintainer: "If we add an Operation module, the user should be able to use it too."

- **What leaves an operation is its own `Timeout`.** One a step ran out with keeps the step's phase, history and
  hint, which are true of the operation too; it takes the operation's name and budget, its steps as `progress`, and
  the furthest dispatch any step reached. Inside the body, a step's `Timeout` is still the step's. Rejected: the
  step's `Timeout` unchanged, which says neither that the operation was what timed out nor what it had done.
- **`named` is the primitive, `fn` the convenience.** Library members that are values, such as `page.title`, need
  an operation without a function, as `Effect.withSpan` sits beside `Effect.fn`. `fn` is documented as `named`
  around the body, with its pipeables around that, so a `Deadline.within` among them sets the deadline it reads.
- **Recording needs the operation.** `markSent`, `observe` and `bound` require `Operation.Current`, which only `fn`
  and `named` provide, so recording outside an operation doesn't compile, and a helper that records says so in its
  requirements. The library reads it where it is optional, since its operations also run outside any user's.
- **Rejected:** keeping the module internal; `Deadline.fn`, since the record is more than a deadline; and a
  `step(name, effect)` combinator, since a step is an operation and `named` makes one.

**Locator positions follow Effect's collection indexes.** `nth(index)` counts from zero, and negative indexes
are out of range, as in Effect's Array and Chunk. `last` is a separate selection so a caller can still select the
end of a list. Both it and `first` match nothing on an empty list. Rejected: counting negative indexes from the
end, which makes the same index mean something different from Effect's collections, and rejecting `last`
along with negative indexing, which removes a useful selection.

**Locator diagnostics preserve the selection the caller wrote.** The step model keeps `First`, `Last` and
`Nth` separately, so errors and traces say `nth(0)`, `nth(-1)`, `first` or `last` without guessing from an
index. Rejected: canonicalizing `nth(0)` to `first` and `nth(-1)` to `last`, which hides the call a user
needs to find and, for a negative index, would name a different selection.

**Checked and selected are independent states.** All supported ARIA checkable roles read `aria-checked`. Option and treeitem require a nonempty value other than the literal `"undefined"`: absent, empty or undefined means unsupported checking, while `"false"` means checkable but unchecked, following [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/#aria-checked). WAI-ARIA [state processing](https://www.w3.org/TR/wai-aria-1.2/#state_property_processing) treats zero-length values as absent; this does not introduce whitespace trimming or general token normalization. Checked reads and check/uncheck reject unsupported checking with `WrongElement` before input. The other supported roles retain their existing false default. Native checkbox/radio inputs keep their checked property; native options keep their selected property. Reads, expectations, actions and snapshots agree. Rejected: defaulting optional checkability to unchecked for option/treeitem, which allows a click on an ordinary native option to change selection before failing with `StateUnchanged`; matching Playwright's missing-attribute behavior does not justify that effect. Also rejected: using `aria-selected` as checked for option/treeitem, which conflates two independent states and makes check/uncheck reject or skip valid controls; suppressing checked in snapshots of selectable roles, which hides a state the other operations observe.

**Checking a label prefers its own checked state and clicks the label.** `check` and `uncheck` read the
selected element's own checked state first, preserving ARIA checkable labels even when an associated control has
a conflicting state. Only when the label has no checked state of its own do the before and after reads use the
browser's native label association. Pointer targeting, actionability and
positions still belong to the selected label, so native activation decides whether the control changes; a prevented
activation yields `StateUnchanged`. Public `isChecked` and checked expectations keep reading the selected element.
Rejected: always preferring the associated control, which changes existing ARIA label behavior; refusing labels,
which prevents normal label activation; redirecting the pointer to the control, which
changes the requested target and coordinates; and teaching all checked reads to follow labels, which changes the
meaning of read and expectation APIs beyond these actions. (ROOK-118.)

## Agents

**Page-provided tools (WebMCP) are designed, and built once a browser ships the API.** A page registers tools with
`navigator.modelContext.registerTool`, and only the browser lists them. The design is a main-world init script that
wraps `registerTool` and `unregisterTool` before the page's scripts run. `Page.modelTools` is a watchable of the
tools. `BrowserToolkit` gains `pageTools` and `callPageTool`, which checks the model's arguments against the tool's
input schema and marks every result as the page's untrusted input.

**The `strider` client loads Effect, and talks to its session's daemon through one `effect/rpc` group.** Each caller,
the command, `strider mcp`, `strider sessions` and `start --fork`, uses the same RPC client over the session's Unix
socket, so what crosses it is a Schema: a command's output and exit code, a tool call's parameters and result, the
session's description. Interrupting a call interrupts the command in the daemon, which is what Ctrl-C and an MCP
client's cancellation need. A forwarded command loads only the client, about 175 ms, against about 45 ms for the
Effect-free client it replaced. Rejected: keeping that client, a hand-written JSON-lines protocol with an untyped
parse at each end and a second, Effect-based copy of it for `strider mcp`, `sessions` and `--fork`; its saving
didn't pay for two protocols.

## Testing

**`Browser.layerTest` emulates no DOM.** A fake browser with a DOM would be a second engine to keep honest, and real
browsers are cheap to launch.


## Document observation and delayed attribution

A browser can report an error document before a navigation command reply supplies its identity (ROOK-130).
Document observation is immediate, with explicit `UnattributedErrorPage` provenance when ownership is unknown.
Only unresolved terminal correlation waits for command replies; later starts, commits, readiness, requests and
downloads proceed in receive order. Their handlers must see the same current navigation and document state.

Use `NavigationEnded`'s `Failed.errorDocument` to associate the original document when its outcome is still pending.
That relationship cannot add a document to a `Failed(None)` already published: another `NavigationEnded` would
produce a second outcome, and mutating the first would change a fact its consumers already saw. Only that case
uses `ErrorDocumentAttributed`, an immutable relationship naming the original document and the ended navigation.
The L1 fold does not derive document lifecycle state from that relationship. Its document and readiness state
already came from observation; the relationship must not reopen or replace anything.

Rejected: guessing ownership from a matching live reservation, because identical event prefixes can have different
command replies; holding every navigation event, because downloads and network consumers must observe starts at
once; delaying or replaying a document commit until attribution, because it would restore an old document after a
newer commit and reset readiness; and mutating published provenance or publishing a second outcome. Command-scoped
correlation is released on completion or interruption, and all correlation state is cleared on navigable removal.
The one retained completed failure is not a live reservation and is cleared when its document arrives or a normal
commit supersedes it after outstanding correlation finishes. No public operation or policy is added.
