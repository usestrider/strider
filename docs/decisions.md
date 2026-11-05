# Decisions

The principles and architectural decisions behind Strider, with the alternatives rejected and why, so that a settled
question stays settled unless the evidence changes. The layer documents (docs/design.md, API.md, CONCEPTS.md, PROTOCOL.md,
CLI.md) state the contracts that follow from them.

## Principles

**Strider drives stock browsers and depends on nothing but Effect.** A script should run in the browser a site
expects, not a build made for automation. A patched browser is also a dependency as much as a package is: its protocol
changes whenever its vendor rolls it, and users can get it only through the vendor's installer. Rejected: Playwright's
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

**Nothing of the library's runs in a page's world unless the caller declared it, or the browser leaves no other way.**
"Never a wrapper in the page." A page can see a wrapper, for example that `alert` isn't the browser's, and a script
shouldn't change how a site behaves. So:

- On stock WebKit, whose Automation reports a dialog without its kind, a dialog is `Dialog.Unknown` rather than
  learned from wrapped dialog functions.
- A trace capture reads each sheet's `cssRules` from the isolated world instead of hooking CSSOM methods.
- A storage state is restored through routed pages of the new context, not init scripts that would carry it into
  pages where their scripts could read it.
- The query engine is one self-contained function in our source, with no library in the page.

What does run in the main world is what the caller declared, their init scripts and the page clock, and, on stock
WebKit alone, the library's own engine and reads, because its inspector makes no other world (QUIRKS.md, Q194).

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

**A plain click's commands go out as one step, and only their replies overlap.** The move's reply waits a rendering
frame the click has no use for. So `sendOrdered` writes the move, press and release to the transport in order, in a
step interruption doesn't split, then waits for all three replies together. A deadline or interruption stops only
the waiting, so it can't leave the button pressed, and no cleanup has to run: a failed click needs no release, and the
failure is reported on time. A transport send that never finishes holds the click until it does, which the built-in
transports don't do. CDP uses this only for one unheld move/press/release click at the same point, on a page without
child frames and before the page has enabled HTML drag interception; late drag announcements still need sequential
cancellation. Frame routing stays sequential after an acknowledged cross-site click failed to reach its target in a
full integration run, and checking the whole page also covers coordinate clicks, whose target frame is
unknown before dispatch. Playwright's `mouse.click` also sends these commands without waiting for each reply.
Rejected: starting the sends concurrently, which can reorder them when a transport send suspends; awaiting every
reply before the next send, which adds the measured wait; letting interruption stop the sends and releasing the button
afterwards, which sends a stray `mouseup` in the usual case where all three were already written, overruns the deadline,
and on Firefox, whose release repeats the click's move, can leave an off-viewport click's page blocked for good; and
applying this to drags or modifier transitions without establishing their semantics.

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

**Late resources are released.** When a caller stops waiting for a resource-producing protocol command, the
library uses the protocol client's default late handler to release any resource the reply returns. BiDi script
success and exception handles are disowned in the realm named by the reply. Consumed results keep their normal
owner; L0 callers may supply a custom late handler and choose when to run its release effect.

- **Why.** An interrupted or timed-out caller cannot receive the resource. Releasing it avoids retaining remote
  handles until realm teardown and follows the policy of closing late page and context creations.
- **Rejected:** a general L1 adoption handler, which would retain resources no caller can use and require ownership
  bookkeeping for abandoned results without improving the caller's recovery.

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
anyway. One path for both keeps locating independent of what a page's script can reach. Parent-frame clipping follows the same boundary: L1 reads visible iframe content bounds in each parent document and passes their intersection in child viewport coordinates to the target engine. Viewport scrolling uses geometric fragment presence, independently of coverage. With pointer checks enabled, the browser hit-tests fragment centres in order, and L1 selects the first reaching the target or a descendant and its iframe in every parent document. If none reaches it locally, the first geometric candidate preserves local Covered; if all locally reachable candidates are blocked by parents, the first parent Covered is retained. Candidates are fresh on each round and under the input permit. This permits a later uncovered line when an earlier line is covered. Disabled pointer checks use the first geometric candidate without probing coverage; explicit offsets are never substituted. Parent candidate probes use each document’s engine across origins and processes. Rejected: restarting at the first child candidate after a parent rejects it, which never reaches an available later line, and carrying candidate coordinates across attempts or permit acquisition, which could reuse stale geometry. Rejected: inferring ancestor clipping from computed overflow and containing-block styles, which duplicates an incomplete layout model and misclassifies inline boxes, SVG and top-layer elements. Rejected: inspecting `window.parent` for same-origin frames, which would give cross-origin frames different pointer behavior, and selecting the first fragment before translating it, which can aim outside the page's visible viewport.

**Stability measures from the current rectangle across the requested rendering updates.** The first rectangle is
sampled immediately; the following samples still require native rendering. Checks run again after acquiring the
input permit, so a queued action never uses the preliminary check's stale geometry or element.

- **Why.** Waiting for rendering before taking the baseline adds one frame to each of the two checks without
  adding a rendering update between samples. A changed rectangle or replacement element still resets stability.
- **Rejected:** removing the rendering wait entirely when stability is disabled, since a browser may drop input
  before rendering; and skipping the check under the input permit, since another action may change the target
  while this one waits for the permit.

**An unqueued click, check or uncheck may reuse stability within the same rendering frame.** Its preliminary check returns a
single-use token. Under the input permit, the engine resolves the locator again and checks every condition; only
the stability wait can be reused, and only for the same element, rectangle and requested frame count. The next
rendering update or another action attempt invalidates the token. The engine retains at most one such record.

- **Why.** Repeating the observation window for a target just observed to be stable adds two frames to an ordinary
  click or an acting check/uncheck. Immediate revalidation retains that observation while checking the conditions
  that could have changed. Check and uncheck still read the initial state and confirm the result after input.
  A queued action always takes new samples; an expired token, moved target or replacement also takes new samples.
- **Rejected:** dropping the second check, sharing evidence across rendering updates, or treating matching
  rectangles on different elements as the same observation. Each can dispatch input using stale readiness.
  Moving the entire wait under the input permit would also block other actions while a target isn't ready.

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

**Chromium sent headers wait for attribution, not merely arrival.** CDP reuses a request id across redirects,
allows ExtraInfo before the corresponding main event, and does not emit ExtraInfo for every hop. A main request
followed by request ExtraInfo therefore cannot tell us whether those headers belong to that hop or to its
unannounced successor. Early headers wait in `ahead`; outstanding expectations in `owed` retain the hop and
phase, so a late report satisfies the earliest expectation for its phase without changing another hop's headers.
The redirect flag determines whether the preceding hop expects both phases; for a final network response,
`hasExtraInfo: true` registers both expectations and holds the response for its headers. A final response from
a cache, service worker or route does not wait even if that flag is true, and uses the request event's headers
when sent headers have not already been reported. A failure assigns only already-queued headers to the last hop.
Correct attribution takes precedence over prompt publication for slow or outstanding Chromium requests.

The wait uses the operation's deadline. A hop's end, including failure or cancellation, or its page's removal
settles it promptly with the available sent headers, otherwise the request snapshot's headers. Page removal
need not produce a network terminal event, so it releases header waiters without inventing one. Code that awaits
`headersSent` before allowing the same response to proceed waits until its deadline; callers can instead let
the response proceed first or use the immediate snapshot with its possible omissions.

Rejected: eager publication followed by correction, because a caller can already have received another hop's
Cookie header; matching main-event headers or connection timestamps, because CDP supplies no reliable per-hop
match there before the response; and returning a provisional snapshot as definitive before termination, because
it can omit the network additions the caller requested. An earlier protocol hop identifier or presence flag
could remove the wait; current CDP does not supply one.

## The public API (L2)

**Decision types describe where they apply.** A dialog handler gets `Dialog.Pending`, whose shapes carry only
the decisions valid for that dialog: an alert can't be dismissed. A route decision's type, `Decision<in P>`, carries
the phases where it is valid. Contravariance allows a decision valid at more phases where fewer are required:
`Decision<Phase>` is assignable to `Decision<"request">`, while `Decision<"auth">` is not. With an explicit `phase`
option, a route handler must produce a decision compatible with that phase.

**Handlers produce decisions through Effects.** Route's constructors and the decisions on `Dialog.Pending` and
`FileChooser.Pending` provide `Effect<Decision<…>>`, so a handler can return `Route.abort()` or `dialog.accept`
directly. A generator that does other work ends with `return yield* Route.abort()` to produce the decision rather
than another Effect. This keeps handlers consistent with Effect's own callbacks and removes the
`Effect.succeed(…)` wrapper from one-line handlers.

Rejected: allowing a handler to return either a plain decision or an Effect of one, because the union return is
unlike Effect's own callbacks; and making a decision itself an Effect, as `Exit` is, because that requires Effect's
internals. The decision remains a plain value produced by the Effect; `isDecision` checks that produced value.

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
meaning of read and expectation APIs beyond these actions.

## Agents

**Page-provided tools (WebMCP) are designed, and built once a browser ships the API.** A page registers tools with
`navigator.modelContext.registerTool`, and only the browser lists them. The design is a main-world init script that
wraps `registerTool` and `unregisterTool` before the page's scripts run. `Page.modelTools` is a watchable of the
tools. `BrowserToolkit` gains `pageTools` and `callPageTool`, which checks the model's arguments against the tool's
input schema and marks every result as the page's untrusted input.

**CLI segments declare their argument schema before running.** A default export is `Segment.make(schema, run)`:
the CLI parses `--arg` strings and JSON files, decodes them with the schema, and only then invokes the callback
with the decoded type. This makes malformed inputs fail before browser actions and removes the need to generate
a source file per payload. A plain Effect default export is rejected with a migration hint, keeping one segment
contract. Return values use evaluation's serialization rules; JSON adds explicit type tags where JSON alone loses
information. Plain output bounds its preview, while JSON preserves the complete captured result. Strict capture
masks arbitrary returned data as a whole: a value no longer identifies the editable field it came from, so applying
snapshot-text masking alone would let a segment expose that field. Page handles retain their names and IDs.

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

A browser can report an error document before a navigation command reply supplies its identity.
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


## Chromium viewport restoration as bounded cleanup

CDP viewport release explicitly waits for the original renderer dimensions after clearing emulation.
Chromium can acknowledge clearing device metrics before its native-view resize reaches the renderer: immediate
release reproduced a successful clear followed by the overridden width. A clear reply alone cannot implement the
restoration contract. Each target attempts to record its original width and height before its first viewport override; nested
and replacement registrations retain those dimensions until the last override has been cleared and restored.
While an override remains, release reapplies the current effective override. Per-target serialization recomputes
that effective override when the command runs, including when registrations are released out of order.

Measure in the named `__strider_viewport` isolated world for the target's main frame (or its own frame for an iframe),
passing the returned execution context id explicitly to `Runtime.evaluate`. Create or retrieve that world for each
measurement rather than caching an execution context across navigation. Main-world lexical bindings and numeric
or nonnumeric shadows must not supply the baseline. Missing, rejected or nonfinite measurements do not prevent
sending the viewport command. Record an explicit unknown baseline on the first unsuccessful attempt; do not
recapture after emulation has started, even across nested/replaced overrides or an unverifiable clear. Final release
still sends clear, then warns if the original size is unknown, without claiming verification. A clear that fails
because the session ended stays quiet. A successfully verified clear releases the saved known baseline.

A native window resize during emulation can make the saved original size stale. Navigation can reject a measurement
or replace a renderer without the resize event the wait needs. Such cases warn or reach the cleanup deadline;
there is no retry or promise to track external window resizing, and an unknown baseline persists for the target's
remaining lifetime. This policy preserves viewport application when verification is unavailable.

Subscribe to resize events before clearing, measure immediately after its reply, and remeasure on resize until the
original dimensions return. There is no sleep, polling timer or command retry. Cleanup runs detached from the
expired operation with its own `Deadline.DefaultBudget` (30 seconds by default), measured on the browser clock.
The bound includes acquiring the target's viewport lock, the clear reply and the restoration observation. A hidden
page or absent compositor frame cannot hold cleanup indefinitely: at the deadline the subscription and pending
reply wait are released, a warning records the incomplete restoration, and scope cleanup continues. Session end
also closes the wait and is quiet. The original dimensions remain recorded after incomplete restoration so a
later override does not mistake stale dimensions for the native viewport.

Rejected: `dontSetVisibleSize: true`. It passed restoration and viewport/full-page capture checks, but Chromium
screencast frames remained at the native 780x493 instead of an overridden 640x480. Keeping native resizing preserves
that existing rendering behavior. The bounded wait accepts that a hidden page might not complete restoration;
that exception is explicit and warns, rather than silently changing the surface size or waiting indefinitely.

Release errors are handled per target and per download context. A quiet ended session cannot cancel another
target's restore or hide its rejection. Other protocol failures and restoration deadlines warn without failing
scope cleanup. Capture checks cover dimensions and pixels beyond the native view and at the full page's far edge;
screencast coverage checks overridden frame dimensions. This closes the reproduced ordering gap; it does not
establish the cause of the earlier unrecorded failure.

## Launched WebKit verifies its inspector listener through Linux procfs

A connection to a selected port is not evidence that the child started its inspector. In the traced
failure another MiniBrowser accepted the connection before the child reported its failed bind. Starting an
Automation session on that connection could interfere with someone else's browser.

Launched WebKit therefore requires Linux with readable child procfs. Before connecting, the exact spawned PID must
hold the loopback LISTEN socket inode; after connecting, it must still hold the same listener and be running before
any inspector write. The stock inspector binds exclusively, so retaining the same listener across connection
establishment excludes a different server accepting that connection. A wrapper must exec MiniBrowser, not merely
fork it. We do not search descendants or fall back when the proof is unavailable. Refusal explains why and directs
the caller to attach to an externally managed inspector HTTP endpoint. A procfs read failure, including permission
errors, can precede the child exit event, so it stops ownership attempts and closes any rejected connection before
waiting for the actual event within the remaining launch deadline. No later collision report restarts ownership
attempts. If no exit is observed, `ConnectionFailed` retains the original access error and uses `stage: "refused"`.
This deliberately allows a genuine access refusal to take the rest of the launch budget; it does not use a fixed
grace period or guess the child's state from another kernel file. An ordinary readiness timeout keeps its prior
`stage: "handshake"`.

Stderr ending alone is not an exit; a live child may still start successfully. An observed exit retains
`ProcessExited` with its exit code when available; the code can be absent, such as for a signal. Stderr contains
only what was collected within the same launch deadline, since descendants may hold it open. Exits before ownership
also explain that wrappers must exec MiniBrowser and name attach, without assuming every exit was caused by a fork.
Attach keeps its existing requirements. The existing deadline, 100 ms polling and five reported-collision attempts
remain the policy.

Rejected: checking port availability then releasing it (another process can bind in the gap), a launch mutex
(other processes do not participate), delaying for stderr (there is no bounded time that proves success), and
checking ownership only after connecting (a replacement listener could then be mistaken for the connected server).
Pinned WebKitGTK's launch interface accepts only a fixed nonzero IP port, with no success acknowledgement or
inherited listener, so a private Unix socket and socket activation are not available. A portable ownership service
or native helper would need another design and dependency; the owner approved the narrower Linux procfs requirement
for launched WebKit. Procfs inaccessible under a sandbox is a refusal, not permission to write to an unknown server.

## Confirm stock WebKit viewport requests against the renderer

Stock WebKit sizes a native window. Its reply can follow a native target-size wait that expired, and renderer
geometry updates are asynchronous. A successful command therefore needs an observed match, not an assumption
that the reply is a completion fence. Confirm immediately and on resize events through Automation, with a
browser-enforced default limit of five seconds capped by the operation deadline, and one final measurement at
that confirmation limit. Report `Reason.ViewportMismatch` with numeric requested and actual dimensions if the
target was not observed. This does not assert permanent inability or prevent a later window-manager change.

Pair a page before applying its explicit override. Confirm defaults on pages created by an operation; close a
failed page before returning the failure. Popup defaults have no creation operation to fail and remain attempted
but unconfirmed until an explicit declaration. Restore failed overrides under a detached five-second cleanup
budget, and expose failed rollback alongside the initiating failure rather than claiming the old size was restored.
Reserve the last second of this shared budget for a final measurement, including when multiple pages restore at
once. Nested cleanup cannot extend it. Ordinary release retains non-failing teardown: confirmed gone resources need
nothing, and other release errors are warnings rather than restoration claims. Callback disposal likewise preserves
the primary result, ignoring vanished windows and logging other failures. Failed-creation cleanup prefers the page
paired to its Automation handle and waits only for that page, independent of popup labels, unrelated popups or
other pending creations. Without a pairing it waits for newly observed non-popup candidates within the same bound.
Popup labels come from the pending creation count: a popup arriving first can consume that count and leave the
actual created page labelled as a popup. If an unpaired popup-labelled candidate remains, cleanup reports identity
ambiguity rather than waiting for that popup or claiming the failed page was removed. An unrelated page wrongly
labelled as a creation can still exhaust the bounded wait when no pairing exists. Concurrent unpaired creations
and a creation count whose announcement never arrives remain ambiguous; no identity is guessed from those labels.
Context-wide restoration is fail-fast: a non-gone failure can interrupt sibling restoration, and the rollback
failure or release warning does not claim that every sibling was restored.

Rejected: treating the resize reply or an arbitrary number of frames as completion; polling or resending the
resize; using screen dimensions as a universal preflight limit across window managers; reporting `Unsupported`
for a bounded observation; and enlarging the test display without retaining the constrained-display regression.

**CLI HTTP attachment identifies the server before choosing a layer.** One `/json/version` response supplies
validated Chromium discovery or the exact `WebKitInspectorHTTPServer` Server-header product token, which the
pinned inspector sends even on a 404 and with no targets. The discovered Chromium WebSocket is reused, avoiding
a second discovery request. Startup bounds this probe to five seconds and Chromium's body to 64 KiB, rejects
redirects and reports unsupported responses or failures. The selected backend remains in the session and its
exported tests. A new protocol flag would duplicate information these servers already provide; HTML matching
would trust page titles controlled by a site, and treating any 404 as WebKit would misclassify unrelated servers.
Proxies removing the inspector identity are rejected rather than guessed. This detects compatibility, not server
authenticity. An attached inspector uses scoped control of its existing default context, rather than
creating a context the inspector cannot supply. Startup state and viewport defaults are rejected in this mode;
existing tabs remain available for explicit control, and stopping releases control without closing them. The
supplied endpoint stays in the spec and export; the discovered socket is connection state for this startup alone,
since Chromium's browser socket identity changes when the browser restarts. Every exported attachment supplies
its required WebSocket constructor.

Shared-context tabs are listed as held pages only while explicitly controlled. Digest subscriptions in this mode
belong to each controlled page's scope, including waits for failed requests, instead of the shared context: the
fold publishes context events for uncontrolled tabs too. Subscriptions start at control without replaying history
and stop at release, covering page events and workers attributable to that page. Context-wide digest subscriptions
remain appropriate for sessions with their own context. Filtering the context stream only when draining it could
admit events queued before control or after release; page scopes enforce the same lifetime as control.

## Chromium capture invalidation on document replacement

Chromium 155.0.8059.79 left every forced capture/navigation overlap unanswered in the recorded fixture: 11 raw CDP and 16 Playwright captures, with all eight no-navigation controls completing. The destination committed within about 4–7 ms. Source inspection supports an originating-widget callback lifetime gap, but does not dynamically prove the exact lost callback. The unrecorded October 29 sightings have no traffic establishing this cause.

Bind Chromium `page.screenshot` to the current main document before L1 geometry preparation, register without a subscription gap, and recheck before native dispatch. A committed replacement before a terminal native capture reply fails with `Page.CaptureInvalidated`, carrying old and replacement document IDs. Reply receipt, rather than completion of decoding, decides precedence against replacement; receive sequence accounts for document events still queued in the event worker. Same-URL reload qualifies; same-document navigation and canceled provisional navigation do not. Preserve already terminal closure/crash and deadline failures and remove the binding on every exit.

The policy applies to `page.screenshot`; trace screenshot collection is outside this contract. This policy cannot cancel Chromium's pending command or prove temporary capture settings were restored. The pinned Chromium 155.0.8059.79 regression explicitly captures again immediately after invalidation and observes replacement pixels at 1100×1000, without waiting for load, repair or retry. That successful observation is no general repair or completion guarantee. Keep other backends unchanged; a subframe-only change or a hang without a committed main-document replacement remains bounded by the existing deadline.

Rejected: retaining a 30-second wait for this observed race; retrying or returning replacement-document pixels; waiting for destination load; increasing deadlines; silently restoring viewport or browser state without evidence that this repairs the pending native work; reusing `NavigationSuperseded`, which describes a navigation operation; and generalizing the workaround to browsers not covered by the Chromium evidence. The upstream report remains independent of the workaround and is not posted externally.

## Chromium screenshot and screencast renderer synchronization

Read `Page.getLayoutMetrics` once for every Chromium screenshot and reuse it for full-page and CSS sizing. For `page.screenshot`, it runs inside the existing document guard and operation deadline. Keep the wait interruptible, then drain observed events and check the document before native capture dispatch. A rejected or malformed metrics reply drains observed events and checks the guard before returning its typed failure, so an earlier observed replacement wins; metrics receipt never counts as native capture receipt. Lost sessions, unanswered commands, timeouts and interruption keep their existing behavior. Per-action and polled trace captures use the same adapter metrics read and incur its renderer/layout cost, without acquiring the public screenshot document guard. No new timeout default, option, retry or delay is added. The operation already marks dispatch before adapter preparation, so a readiness timeout remains `dispatchedUnconfirmed`; cancellation prevents later dispatch but cannot cancel commands already sent.

In Chromium 155.0.8059.79 (revision `a49e2e3d4addfd84e765b52afe230bedb81096db`), `PageHandler::AssureTopLevelActiveFrame` rejects a screenshot when its top-level render frame is not active. Renderer `frameNavigated` is emitted in `InspectorPageAgent::WillCommitLoad`, before it establishes browser-side activation. Browser-handled screenshot commands run immediately, whereas the renderer's layout-metrics command queues behind tracked navigation processing in `DevToolsSession`. The renderer updates style/layout for that read. This adds a round trip and renderer responsiveness/layout cost to viewport screenshots that previously skipped metrics. A paused renderer or slow layout can consume the existing deadline.

A native immediate replacement capture rejected once in five bounded trials without the adapter. The metrics candidate returned expected replacement pixels in five native and five public-path diagnostic trials. That small sample supports the source reasoning, not a reliability or latency bound. A response carries neither document identity nor an activation lease; another navigation can intervene. The original full-run rejection's internal lifecycle state was not instrumented.

Rejected: relying on `frameNavigated`, execution-context creation or loading events as activation acknowledgments; tab focus, which is unrelated to the lifecycle check; waiting for the earlier screenshot, which remained unanswered through the bounded observation in four of five waiting trials; and transient-error retries or fixed delays. Successful replacements also occurred with an unanswered earlier capture. Keep the replacement-pixel regression and its immediate second call unchanged.

Screencast acquisition uses the same small adapter helper for one `Page.getLayoutMetrics` read after subscribing to frames and before `Page.startScreencast`. It shares the existing acquisition deadline and may fail before start; renderer responsiveness and style/layout work consume that budget. A timeout remains conservatively `dispatchedUnconfirmed`, even if start was never sent. Interruption prevents a late metrics reply from starting acquisition. The subscription remains in the caller's scope and successful start registers the existing stop finalizer. Screenshot document guards, error precedence, observed-event draining, native reply receipt ordering and sizing reuse remain specific to screenshots and unchanged.

In the same pinned Chromium revision, `PageHandler::StartScreencast` calls `AssureTopLevelActiveFrame` at `page_handler.cc:1583`, sharing screenshots' active-frame check. Native acquisition rejected with `Not attached to an active page` after both the navigation reply and `frameNavigated` in one of five bounded trials; a second native diagnostic that started from the frame event rejected twice in five. All five direct public-path trials succeeded. With exactly one successful metrics read before start, all fifteen trials across these three paths acquired frames. The native setup has fewer initialization commands than the public path, and its rejection rate is not the public path's rate. These traces and the renderer-dispatch source reasoning support the ordering change, without establishing an activation lease or a reliability bound. The instrumented full baseline's screencasts succeeded, so these trials do not reproduce the earlier full-run failure itself.

For screencasts, rejected alternatives are retaining direct start after navigation replies or `frameNavigated`, which the native traces show can precede activation; duplicating screenshots' synchronization rule; and retries, fixed delays, focus changes or load waits, which do not establish the required renderer-dispatch ordering. A metrics reply grants no protection against another navigation, detach or target change. Native trace recording uses this capability under its detached acquisition budget; its existing policy ignores acquisition errors and marks each page seen before acquisition, so a failure can leave that page without frames for the rest of the trace, without another attempt. This read does not change that trace failure policy or the existing post-start cleanup behavior.

## Experimental Chromium claims and internal handoff

Keep durable tab identity separate from connection-local public ids. The experimental subpath issues opaque,
serializable branded claims only for targets the connection owns: a control grant on a discovered page is not
ownership, and control of the default context never grants its removal. Disposable contexts and their pages
cannot issue claims; default-context pages are exempt from disposal on disconnect. Page and context claims
carry distinct kinds, checked on use before target lookup. Chromium claims bind the browser
WebSocket GUID, the native tab target and its native context. Tab-level attachment identifies the active page;
URLs cannot distinguish two tabs and page targets can change during prerender activation. Identity lookup uses
a separate short-lived CDP client so it does not change the model's attachment hierarchy. A pipe connection
without the browser WebSocket identity, Firefox and stock WebKit refuse the capability explicitly.

Persistence is explicit, through the experimental context constructor; ordinary contexts retain
`disposeOnDetach: true`. A reclaimable context uses false but still closes on ordinary scope exit. The internal
Chromium handoff suppresses only owned target destruction while closing the old scope: registrations, paused
request handlers and access grants still run their finalizers. Reclaim acquires close-on-scope-exit ownership
again. Context reclaim borrows the surviving context during setup, acquiring destruction ownership only after
setup succeeds. Failure or interruption immediately unwinds setup registrations and restores prior model
settings without deleting existing tabs or the context, including when storage application fails. Data already
written by storage application is not transactional. Requested context options apply to existing and future pages; routes and init scripts are redeclared by the host. The default context is never owned for removal.
Reclaim observes before acquiring ownership, so failed observation does not close somebody else's tab. On pinned
Chromium 155.0.8059.79, both a dialog proved open before handoff and one opened after it blocked a new inspector's
`Page.enable`; the existing model's initialization gate also could not complete. This prevents reliable dialog
rediscovery with the implemented protocol path. These observations do not identify a surviving tab's current
dialog state from a later connection.

The approved fallback acquires ownership after an explicit bounded observation and returns a Schema union:
`Observed` carries dialog observations with a closed kind union; `Unknown` carries no current dialog data and
names no inferred cause. Observation defaults to 1000 milliseconds and counts against the caller deadline.
An earlier caller deadline remains `Timeout`, and interruption remains interruption; neither is converted into
Unknown success or ownership. Browser-level close and ordinary scope cleanup work independently of the blocked
initialization gate; ordinary actions remain bounded by their own operation deadlines. Context recovery returns
its context plus per-page observations from before settings application; failure during settings application
still preserves the borrowed context rather than returning partial setup as successful recovery. Empty and
all-Observed contexts use normal setup, including the normal defaults when settings are omitted. Adoption is
restricted to no-settings recovery with at least one Unknown page. It bypasses session setup for the whole
context so ownership and cleanup do not enter a blocked initialization gate. This conservative boundary also
applies to healthy siblings and future pages: adoption installs no automatic dialog policy, unrouted HTTP
challenge forwarding, file chooser interception/cancellation, or temporary download directory with an allow
declaration. Native browser behavior remains, and there is no automatic restoration later. The per-page report
is an observation of current state, not a guarantee that these defaults were installed.

Every supplied setting, including local `dialogs` or `eventLog`, is refused with `UserContext.reclaim.settings`
if any page is Unknown, before any setup or ownership transfer. `observationTimeout` and `lastKnown` are
metadata rather than settings. The host may choose no-settings recovery but accepts these omissions for the
entire context; this trade-off must be stated when presenting the change. Rejected: adoption for empty or
all-Observed contexts, silently dropping requested settings, selectively configuring healthy siblings while
leaving an apparently uniform context, or requiring renderer-dependent defaults before adopting Unknown pages.

Planned handoff captures the model's current prompt before finalizers run and returns serializable snapshots
bound to the exact page or context claim. Context snapshots aggregate historical events for all their pages,
including pages with no individual claim. The caller explicitly carries them to the matching reclaim. Their Schema tag is `LastKnown`,
and they remain separate from the current report even when the current state is Unknown. Active prompt data
is independent of the event-log cap. A killed client cannot supply such a snapshot. Neither empty historical
details nor an observed empty dialog list promises that the page is generally healthy.

Planned Chromium handoff permits a narrowly different action from observational reclaim. The owning page's
release finalizer waits for handler resolution, then dismisses a still-open dialog using its original session,
before context declaration teardown. It has a 1000 ms budget independent of the closing caller. Confirmed reply
and a matching dialog-closure fact are required before publishing a typed `DialogDismissed` event with kind and
message. Failed or timed-out dismissal produces a typed Unknown handoff report and does not fail scope closure.
The new client receives this historical event separately from current Observed/Unknown state. A caller handler
may still accept normally, but shutdown fallback cannot apply an accept policy or beforeunload's ordinary
implicit acceptance. Dismissing beforeunload cancels the pending navigation and leaves the tab/document alive.
A client killed without finalizers cannot perform this handoff action and reclaim never tries it afterward.
`Complete` refers to the dismissal loop at page release, not to the absence of dialogs during later teardown or
on the next connection. Current observation remains separate even when historical handoff completed.

Every handoff declaration release has a separate 1000 ms confirmation budget, independent of the ordinary
operation's deadline and of the dismissal budget. Local registrations are removed immediately. Failed or expired
release logs its unconfirmed outcome and makes the returned handoff report Unknown without erasing confirmed
events or failing scope closure. Expiry can interrupt restoration before every healthy page is restored, including
when the old connection remains open; Unknown explicitly preserves that uncertainty. The number of declarations
determines the total possible teardown wait; there is no implicit 30-second wait per blocked release. Rejected: treating a warning as confirmed cleanup, suppressing
the warning, or making ordinary caller deadlines wait for a fresh cleanup budget. Borrowed-context rollback
still waits for confirmation under its own cleanup lifetime. Connection shutdown can interrupt that background
lifetime; its waiting finalizer records an unconfirmed release rather than interrupting the caller.

Ownership transfer, report registration and result construction commit together under interruption masking.
Snapshot registration moves to the new scope with the claim instead of surviving in the old scope.

Rejected: automatic acceptance during handoff, including an option or policy enabling it, because shutdown could
confirm a deletion or payment; pretending failed dismissal succeeded; treating a handoff event as current state;
and disabling warnings about unconfirmed declaration teardown. Leaving all dialogs untouched during planned
handoff was superseded: on pinned Chromium a residual dialog prevents file-chooser declaration release, while
dismissal on the original session permits that release to complete.

Rejected: matching by URL; storing connection-local public ids or page-target ids; accepting control as proof of
ownership; changing ordinary context cleanup; a public handoff option; dismissing dialogs during reclaim; and
refusing all ownership when bounded observation cannot complete; calling an observation timeout a confirmed
dialog; returning fresh-looking empty current state; treating historical details as current; and adding a lease
or expiry implementation here. Claim leases and expiry are separate work, and no host may
enable persistent contexts before expiry cleanup ships. Claims are identity tokens, not authentication or a
mutual-exclusion mechanism. A browser debugging endpoint remains the trust boundary.

Identity discovery must not interpret an ended observation stream as target destruction. Actual transport loss
already fails subscriptions with SessionEnded; a subscription ending without an active page now fails as
modelUnavailable instead of returning Gone for a known live tab. Native absence still permits Gone. Recovery
snapshots exist only for issued page/context claims; unclaimed pages have no claim-bound recovery record. The
separate, scoped identity WebSocket per candidate tab is unchanged; no performance improvement is claimed here.

## CDP declaration cleanup lifetime and caller wait

Removing a declaration updates the registry synchronously, then starts the browser reapplication in a
connection-owned fiber with its own cleanup budget. Its lifetime must outlast the operation that registered it:
an expired registration deadline must not prevent restoration. Its caller's wait is separately bounded by the
operation doing the cleanup. A caller timing out stops waiting without canceling that connection-owned work.
Borrowed-context rollback explicitly requests confirmation, so prior settings are not reported restored before
its setup registrations have been released. Finalizers preserve their registration environment for browser work,
but read the closing caller's deadline and confirmation policy before entering that environment.

Rejected: retaining an expired protocol deadline for release; waiting for a fresh full cleanup budget inside
every ordinary operation; cancelling restoration when the caller stops waiting; discarding release failures;
and returning borrowed-context rollback as confirmed while browser restoration is still pending.

## Stability determines release bumps

Strider follows Effect's stability-based changeset policy, including its November 2026 rule that compatible additions
to unstable APIs ship in patch releases. The [release policy](../.changeset/README.md#release-policy) is the source for
bump selection. The CLI's commands and data contracts are explicitly unstable, just as the default public TypeScript
API is before 1.0. This lets compatible features ship without consuming the minor release boundary that signals
breaking changes to unstable APIs.

Rejected: treating every addition as a minor release regardless of stability, which gives compatible features and
unstable breaks the same version signal; treating every pre-1.0 change as a patch, which removes that signal; and
inferring CLI stability from its implementation's location under `internal/`, which says nothing about its public
contract.


## Strict capture matches the redacted snapshot

Use one structured redacted tree for toolkit snapshot output and find matching, including names and paths.
Matching hidden content and masking only the response confirms guesses at field values, so strict find must
search what it can show. Preserve label searches and role filters; keep local capture unchanged.

Carry optional field editability separately from role in engine and public snapshot data. Semantic articles,
paragraphs and headings can be contenteditable, including plaintext-only. Native and ARIA fields count even
when disabled or read-only: capture concerns their data, not whether an action may edit them. Absent editability
can mean that metadata was not collected or that the node is not a field; older snapshot data remains valid. Accessible names derived from editable content carry
optional text provenance without changing local text rendering. Track field contributions through the chosen
accessible or inferred name, including ancestor content, embedded values, referenced controls, nearby fields
and image-alt inference. Optional `fieldContent` on names lets shared redaction mask these copies outside the
field subtree while retaining genuine public labels. Inspecting only the finished tree loses those origins.
Labels, semantic roles, states and refs survive.

For non-full console capture, exception digests and history retain a library-authored event marker and monotonic
occurrence time, with no page-provided name, message, stack or origin text. Error names and origins are no safer
than messages. Full local capture keeps its previous diagnostics.

Rejected: matching original text while redacting output, which leaks guesses; masking by role alone, which misses
semantic editables; replacing semantic roles with editable, which loses meaning; mandatory false flags on every
node, which enlarge every snapshot and reject older data; and masking exception messages alone, which leaves
other page-controlled exception details visible. Strict remains a bounded capture policy: ordinary page text,
labels, URLs, dialogs and other metadata remain available, so it is not a secrecy or inference guarantee.

Assertions such as `expect --text` and action selectors continue matching original page content and can confirm
guesses at masked values. Restricting those operations is a separate contract decision; this change restricts
snapshot/find capture and does not change assertion or action semantics. Name provenance is limited to field
contributions during name construction, not general tracking of sensitive data across arbitrary page scripts.

Field-content provenance follows the contributor's flat-tree ancestry through assigned slots and shadow hosts,
including native/ARIA field ancestors whose descendants do not inherit DOM editability. Keep explicit public
label precedence; do not infer privacy by checking only the named element or a role-limited descendant walk.
Mixed names are masked whole, and native select/ARIA listbox options follow field-subtree masking. This
conservative choice can hide public portions of a derived name or option labels; separate unmasked nodes
remain searchable. It avoids treating a copied private contribution as a public label.

Memoize field classification, field ancestry and inferred-text provenance only within each tree walk. Cache
both positive and negative ancestor paths to avoid repeating a full walk per contributor. Clear these caches
with names, roles and text before every engine request, expectation observation and action revalidation round;
role changes, slot reassignment and reparenting must be observed by the next walk. Caching across walks would
retain stale privacy decisions; DOM-only closest checks miss slot/shadow ancestry. This bounds the additional
provenance traversal, not the existing cost of constructing all nested accessible or inferred name strings.

Field editability and name provenance are requested only by redacted snapshot capture, including custom policies with the same masking
setting. Ordinary library and full/local snapshots omit that masking metadata, skipping field classification,
field-contribution ancestry and subtree analysis. Ordinary rendering and queries do not consume the editability
flag. The optional public codec can carry it and diff can compare it when supplied, but neither requires
automatic collection. The masking request is internal operation context, forwarded to each frame; it is not inferred
from a preset's identity. Clear naming caches between requests and scope cached toolkit snapshots to their
policy, so switching modes cannot reuse an unannotated tree for masking. Always computing provenance imposed
material cost on ordinary snapshots without benefiting their output. Keep the same precise naming algorithm
when requested rather than introducing separate name strings or speculative optimizations.

## One-shot event waits keep their first terminal outcome

An event being published is not a completed match: delivery can load and decode a response body or wait for a
navigation, and a caller predicate can reject it or still be running. A one-shot wait commits exactly one outcome:
completed delivery accepted by its predicate, delivery/predicate failure, its registration-time deadline, target
end, or acquiring-scope cancellation. Target end commits `TargetGone` in the channel's end path rather than waiting
for its worker to take another queued entry. A channel that already ended commits that failure at registration.
Scope cancellation commits before stopping workers; completed results, errors and timeouts remain latched.

The model's end path only commits immutable terminal data and signals the waiter; it runs no delivery, predicate
or effectful finalizer. A separate deadline waiter commits independently of blocked delivery on the browser's clock.
The delivery worker observes the committed outcome and cancels its work through Effect interruption. A user effect
that is already uninterruptible can finish its own work, but cannot replace the committed result or cause a new
predicate to start. Closing a scope never drains queued work. A terminal outcome releases the queue and subscriber immediately; the delivery worker releases its internal child
scope only when it exits. The acquiring scope therefore keeps owning any still-running delivery or predicate,
even after Timeout or TargetGone notification. A deadline waiter must not close and detach that child scope while
its delivery worker is still using caller resources. Prompt terminal notification does not imply that acquiring-scope
release has finished. The caller can keep the latched result. Streams retain their existing ordered
buffer-draining contract on normal target end.

Rejected: making target failure depend on worker progress, which can return success after the target has ended
and contradicts the target-lifetime contract; treating publication as a match, which bypasses effectful delivery
and predicates; draining or evaluating queued work during scope closure, which delays cancellation and starts user
work after ownership ended; retaining completed subscriptions until their acquiring scope closes, which keeps
unusable entries and callbacks alive. This is a correctness rule, not an observation optimization.

## Validation observation during toolkit clicks

Keep snapshot invalidity as current state, including before interaction. Observe native invalid events only
over the toolkit click operation and report “validation observed during click”, rather than claiming a refused
submission. Trusted invalid events also arise from scripted validity checks, and user-invalid state cannot
identify repeated attempts or attribute a change to a click. Neither is submission-specific evidence.

Use the existing per-document engine lifecycle, with a token per observation. Collect optional feedback in the
click's interruptible use phase under its existing deadline. Awaiting a detached stop in an uninterruptible release
would extend that deadline when the page is busy, so a release finalizer only starts idempotent cleanup in the
toolkit's scope, apart from the caller. Cleanup bypasses the read's dialog refusal, allowing a queued stop to
execute when the dialog closes. It never publishes feedback. A busy document may retain listeners until its
queued release executes or the document ends; neither the caller's return nor interruption waits for that reply.
The cleanup fiber uses the ordinary operation budget, with no retry or extra grace period. Deduplicate controls
within one observation only.
Read current messages without invoking validation methods, changing focus, cancelling events, patching page
functions or waiting for later timers. Cleanup addresses the original document, never its replacement; document
loss, an open dialog or expiration of the click's deadline may lose observations, and cleanup errors must not
replace click errors. Late cleanup replies are discarded, so they cannot enter another call's digest.

The bounded scope is the top document and existing open shadow roots, tested on the pinned Chromium, Firefox
and stock WebKit. Child frames, closed roots and newly created roots are excluded. Expanding scope would need
explicit lifecycle and target-routing work; a public event API is unnecessary for this digest. Strict capture
omits all control names and masks messages because accessible names may themselves contain editable values;
local capture includes the engine's accessible name and current message.

## Chromium captures use a new surface in automation and concurrent

The shared Chromium automation arguments enable `CDPScreenshotNewSurface`; concurrent inherits the same setting
and adds its three throttling switches. On Chromium 155.0.8059.79, paired off/on runs in both variant orders
suppressed the slow viewport mode: order-stratified p95 fell from 58–71 ms to 37–41 ms. Repeated five-capture
batches approached Playwright's two observed modes, with p95 falling from 255–265 ms to about 170 ms. These
mixed distributions support lower tails, not a fixed median saving, parity, a general element benefit or a dense
image improvement. Renderer, encoding and transfer costs remain unsplit.

Pinned Playwright 1.64.1's `playwright-core/lib/coreBundle.js`, in `chromiumSwitches`, includes
`process.env.PLAYWRIGHT_LEGACY_SCREENSHOT ? "" : "--enable-features=CDPScreenshotNewSurface"` in its default
switches. The surrounding switch array filters empty entries and also disables background timer, occluded-window
and renderer throttling. Thus setting its legacy opt-out omits the enable switch; it does not explicitly disable
the feature. This is prior art for the path, not proof of compatibility or a reason to copy its other defaults.
Strider uses its own measured scope and retains every capture guard and required layout-metrics read.

Captures can drive rendering and are not promised to be unobservable. With both paths, genuinely minimized
windows under private Xvfb/Openbox remained natively minimized while capture transiently emitted visible/hidden
page events and animation callbacks; matched no-capture controls emitted neither. All bounded captures returned
exact interior pixels within ten seconds with live connections. The new path changed observed duration and
callback counts; those observations do not isolate a new scheduling rule. Only Chromium 155.0.8059.79 on Linux
was validated; other Chrome/Edge builds and desktop configurations remain unverified. Browser rolls must recheck
capture, navigation and genuine minimization, as the browser-pin notes require.

Stock, independently constructed custom profiles and attached browsers keep their behavior. Caller arguments
remain verbatim after preset arguments. Chromium replaces repeated feature lists: a later enable list omitting
the surface feature selects the older path on the tested build, and the effective disable list wins. Callers can
retain the feature by including it in their own enable list, or explicitly disable it. Strider does not merge lists.

Rejected: keeping the legacy default and requiring raw opt-in, given the repeatable tail improvement and bounded
compatibility checks; enabling automation alone, which contradicts concurrent's inheritance; rewriting caller
feature lists, which changes raw argument semantics; removing navigation synchronization, adding retries or
repairing native screenshot pixels, none of which this launch setting justifies. No runtime version gate or
assumed fallback for unknown feature names is introduced. The changed unstable default and narrowed previous
observability contract require a minor release under the release policy, including the CLI launches using it.

## Checked actions on ordinary label descendants

Check and uncheck prefer the selected element's own checked state. When it has none, a directly selected label
or an ordinary descendant's nearest DOM label supplies the associated control. Pointer input and relative positions
remain on the selected element; already-correct state sends nothing, and post-click verification uses the same
checked-state lookup. Public isChecked and checked expectations continue to read only the selected element.

Association follows only DOM parents, without crossing a shadow root. It uses the label's control, never the
ancestor label's own ARIA state. A selected element inside a shadow root cannot borrow an outside label.

For descendants, check both DOM ancestors and the path through assigned slots and shadow hosts, up to, excluding,
that associated DOM label. Interactive ancestors above the label remain outside this guard. The slot-aware walk
adds refusals without introducing associations or replacing the DOM guard: a shadow label encountered along that
path must neither choose another control nor hide a DOM interactive ancestor. Refuse
buttons, inputs, selects, textareas, details, summaries, frames, embeds, objects, links with href (including
SVG links with namespaced xlink:href), images with
usemap, audio/video with controls, ARIA widget roles (button, checkbox, combobox, grid, gridcell, link,
listbox, menu, menubar, menuitem, menuitemcheckbox, menuitemradio, option, radio, radiogroup, scrollbar,
searchbox, separator, slider, spinbutton, switch, tab, tablist, textbox, tree, treegrid and treeitem) and
editable content. This conservative boundary keeps separate controls from receiving
input meant for the associated checkbox, including when that checkbox already matches. Association uses the
browser's label.control; missing or non-checkable controls are refused.

Slot-added controls can be inspected only in open shadow roots. A control inside a closed shadow root can
receive input before the action fails with `StateUnchanged`.

Rejected: clicking the associated input directly, which loses the selected target and its relative coordinates;
following labels for public state reads, which expands an unrelated contract; using a slot-aware path to
choose the label, which would create associations across shadow roots; replacing
DOM guards with slot traversal, which can skip DOM ancestors; and copying Playwright's activation
of links before reporting unchanged state, which sends input to a separate control unnecessarily.


**Actions accept transparent controls; visible means a person can see it.** Action readiness ignores opacity on the
element and its ancestors and requires the other action checks. Styled controls commonly put a transparent real input over
their decoration. Pointer reception establishes whether pointer input can reach them. Non-pointer actions such as
fill also accept transparency and require enabled, editable and not inert, without a hit test.
With `opacity: 0` on an element or any ancestor, `isVisible` returns false, `Expect.toBeVisible` waits,
and visibility filters count the element as hidden. Opacity alone does not make an action wait for a fade-in.

- **Rejected:** ignoring opacity in the shared visibility observation, which would make assertions and filters
  count unseen elements as seen; requiring callers to disable the visible check, which also drops useful checks
  for CSS visibility and missing boxes; and limiting the exception to pointer actions, which would leave transparent
  text fields unusable by fill despite being enabled and editable.

## Retain Chromium's startup window by default

Keep the initial window in Chromium's automation profile and, by inheritance, concurrent. Skipping it saves
measurable time, but changes default-context session behavior and the initial tabs exposed by the CLI and tools.
A saving paid once per browser does not justify those changes. Stock, custom and attach behavior also stays
unchanged. Callers who choose the trade can already opt in through launch options with
`args: ["--no-startup-window"]`; no new option or persistence exception is introduced.

On pinned Linux Chromium 155.0.8059.79, Playwright 1.64.1 and Node 24.21.0, two reversed-order sweeps each used
three warmup and twenty measured alternating Strider/Playwright pairs per variant. Launch and first isolated,
configured page were timed from the same browser, with validation and cleanup outside timing. Combined Strider
medians fell from 205.916 to 147.624 ms and from 191.340 to 151.012 ms: savings of 58.292 and 40.328 ms.
Playwright's combined control medians changed by −0.705 and +3.372 ms. First-page medians rose by 0.808 and
5.437 ms, so skipping the window did not merely move the launch cost to that page. The control medians support
the saving, but the reverse sweep's Playwright combined p95 rose from 124.144 to 178.997 ms. These measurements
do not establish a stable tail improvement, parity, or a headed-launch benefit.

On the same Chromium pin, closing the last page in a windowless default context dropped its session cookie;
a later page retained a lasting cookie and localStorage. Leaving the ordinary startup page open preserved the
session cookie, while closing that startup page first exposed the same loss. Isolated contexts retained their
session cookies. This is an observed boundary while the browser remains alive, not a traced Chromium cause or
a claim about other session-only state. It affects default contexts with temporary as well as supplied profile
directories, so preserving the window only for `userDataDir` would leave part of the behavior change in place.
It is distinct from whether signal-based browser shutdown flushes newly written storage to disk.

Without a startup window, initial `strider tabs` and the `tabs` tool return empty listings. Existing callers
would have to create a page explicitly. Retain the current initial-page behavior and the session-cookie guard;
the benchmark and explicit-argument windowless tests remain useful without changing the production default.

Rejected: enabling the flag in automation and concurrent for a once-per-browser 40–58 ms median saving while
silently changing session-cookie lifetime and initial tab listings; enabling it only without a supplied profile,
which still changes temporary default contexts; and treating the saving as evidence that the startup page has
no behavioral role. Caller opt-in keeps that trade explicit.
