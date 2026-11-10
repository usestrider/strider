# Decisions

The principles and architectural decisions behind Strider, with the alternatives rejected and why, so that a settled
question stays settled unless the evidence changes. The layer documents (docs/design.md, API.md, CONCEPTS.md, PROTOCOL.md,
CLI.md) state the contracts that follow from them.

## Principles

**Strider drives stock browsers and depends on nothing but Effect.** A script should run in the browser a site
expects, not a build made for automation. A patched browser is also a dependency as much as a package is: its protocol
changes whenever its vendor rolls it, and users can get it only through the vendor's installer. Rejected: Playwright's
WebKit build as an option, and a patched WebKit of our own. Optional services supply external tools when the caller explicitly provides them. Firefox writes video itself;
Chromium writes it through an optional `VideoWriter`, whose ffmpeg layer takes an explicit executable path. A trace's
DOM capture is our own code. Playwright's snapshotter is read to learn what the trace viewer expects, never copied or
shipped, and there is no viewer of our own, since trace.playwright.dev already runs anywhere.

**The library installs nothing.** "I don't think I want the library to automatically install anything for the
user." There's no download default and no install command, because the tools that already install browsers remain:
an operating system's packages, a vendor's installer, Nix.

<a id="explicit-browser-path"></a>

**A launch never picks a browser nobody named.** A launch takes an executable path. There are no channels, no
default to an installed browser, and no lookup on `PATH`. Any of those would launch different programs from a
terminal, an editor's test runner and CI. No channel table reaches NixOS, Snap, Flatpak, Guix or the open-source
Chromium ("I think that will fall apart on various flavors of linux, like NixOS"). Finding a browser is
`strider browsers`, a command a person or agent runs once to copy a path from. It isn't a library function, because
a program would call it at launch. On NixOS it lists the profile's link, which survives updates, not the store path.
Any Chromium or Firefox version is accepted, because their protocols change slowly and compatibly. `Browser.Info`
says what connected.

<a id="locator-design"></a>

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

<a id="typed-patterns-and-clock-modes"></a>

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

**Paused CDP pages write their declarations before resume without waiting for renderer replies.** A page in a new
browsing context group may need its first response before Chromium creates the renderer. Its initial sync therefore
folds network events, navigation starts and Fetch decisions while frame and realm events wait for the sequenced
snapshot; events folded early are never replayed. Required declaration replies must finish before Ready, including
successful script identifiers needed for cleanup when another declaration fails. Rejected: resuming before writing
declarations, which loses first-request routing and first-script initialization; waiting for renderer replies before
resume, or withholding Fetch decisions until the snapshot, both of which can deadlock initialization.


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

<a id="composable-operation-deadlines"></a>

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
success and exception handles are disowned in the realm named by the reply. Consumed successful handles keep their normal
owner; the adapter releases consumed exception handles that it does not return. L0 callers may supply a custom late handler and choose when to run its release effect.
Additional release bindings are singular and non-overlapping; unsupported wildcard bindings are rejected during
code generation. A malformed reply missing a required release binding is skipped, since guessing a realm could
release the wrong resource. Such a handle may remain until its realm ends. Union paths are validated independently
against the alternatives, without proving that every binding coexists with each resource path.

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

Bounding-box reads use the browser's axis-aligned rect in top-level viewport CSS pixels, composed through
frames, rather than reconstructing layout or original corners. Native frame conversion is used where
reliable; stock Firefox supports positive axis-aligned frame scaling, zoom and translation, and refuses
rotation, skew, reflection, 3D, perspective and frame motion paths with descriptive typed Unsupported.
Target camera clipping and motion paths retain the browser rect. Stock defaults remain unchanged, without a
launch-profile prerequisite. Rejected: layout solvers, handwritten CSS grouping/layout rules, original-
corner accuracy as the rect contract, and enabling a page-visible native-quad preference for unrelated
contexts. Optional geometry runs only for a bounding-box request.

**Stability measures from the current rectangle across the requested rendering updates.** The first rectangle is
sampled immediately; the following samples still require native rendering. Checks run again after acquiring the
input permit, so a queued action never uses the preliminary check's stale geometry or element.

- **Why.** Waiting for rendering before taking the baseline adds one frame to each of the two checks without
  adding a rendering update between samples. A changed rectangle or replacement element still resets stability.
- **Rejected:** skipping the check under the input permit, since another action may change the target
  while this one waits for the permit.

**Readiness waits for a drawn frame by default only for pointer actions.** Per-call `checks.rendered` keeps
pointer routing aligned with what was drawn, while fill and other non-pointer actions check current layout
immediately. Stability sampling, retry waits and the check under the input permit remain independent. A frame
is no hydration guarantee; callers can wait for application readiness or opt one action into rendering. With
rendering disabled, timeouts retain readiness reasons rather than a no-frame hint. Rejected: a uniform default
on, which delays ready fills; a uniform default off, which risks pointer routing; and a suite-wide switch, which
hides the choice from the action that needs it.

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

<a id="effectful-handler-decisions"></a>

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

**Options a caller writes carry no `_tag`.** A choice with no data is a string literal (`area: "fullPage"`,
`format: "jpeg"`); one with data is told apart by its keys (`area: { clip }` or `{ element }`, a cookie's
`scope: { url }` or `{ domain, path }`, a test's `attach({ trace })`), each member ruling out the others' keys with
`?: never` where a caller could write both, so the union stays exclusive. Outputs keep `_tag`, since a caller matches on them. Rejected: tagged objects, which made callers spell
`{ _tag: "FullPage" }` for a choice with nothing in it; and constructors (`Screenshot.fullPage`), which add a module
to import for plain data.

**Checked and selected are independent states.** The seven supported ARIA checkable roles share checked parsing across reads, expectations, filters, actions and snapshots. ARIA keywords `true`, `false`, `mixed` and `undefined` are recognized ASCII case-insensitively, without trimming. `mixed` is false on radio, menuitemradio and switch; on checkbox, menuitemcheckbox, option and treeitem it matches neither boolean filter and reads false for boolean reads and actions. Absent, empty, undefined and unrecognized values use the role default: unsupported checking on option/treeitem, false on the other five roles. Unsupported reads and check/uncheck fail with `WrongElement` before input. This invalid-token fallback is Strider policy, so malformed optional state cannot authorize a click; it does not claim browser accessibility parity. Snapshots emit checked only for boolean true. Keyword recognition follows HTML enumerated keyword matching without trimming; role-specific mixed behavior follows [WAI-ARIA checked](https://www.w3.org/TR/wai-aria-1.2/#aria-checked). Native checkbox/radio checked and indeterminate properties retain precedence; native options keep selected independent from checked. Rejected: accepting arbitrary nonempty optional state, which allows malformed markup to authorize input; mirroring Chromium's arbitrary-invalid-to-true accessibility mapping, which grants that input and is not evidence of cross-browser parity; treating mixed identically on all roles, which loses the two-state roles' false state; using selected as checked or suppressing checked snapshots on selectable roles, which conflates or hides independent states. Snapshot representation remains a positive checked marker, not a mixed-state encoding.

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


## BiDi viewport precedence belongs to the declaration registry

BiDi viewport declarations use the shared registry's Page, Context, Browser precedence for both dimensions and
device scale. A broader change first sets each affected user context's effective default for future pages, then
reapplies the effective value only to existing pages with page overrides. Page release explicitly applies its
remaining effective value, or null when none remains. Creating a user context initializes only that context.

Firefox 158.0 applies a user-context viewport command to existing pages, overwriting page settings; clearing a
page restores the implementation default rather than an outer declaration. Native layering therefore cannot
implement the declaration contract. Rewriting all contexts during creation also overwrites unrelated declarations.

Rejected: relying on native scope precedence; applying only page commands, which leaves future pages without
defaults; and redundantly writing context defaults to every page, which adds commands without changing their
effective value and can address startup contexts Firefox announces but rejects by ID. Broader writes and page
reapplication are sequential protocol commands; successful installation has its effective state when it returns.

Release skips closing pages and removing contexts. Every remaining native context or page write has an independent
five-second budget on the browser clock, detached from the releasing operation and with a fresh protocol deadline.
A typed failure warns and marks cleanup unconfirmed; only an ended session is quiet. One failure cannot stop another
target's restoration. Installation keeps propagating failures on active resources instead of treating them as cleanup.

A failed or interrupted context removal resets its in-progress flag and restores that surviving context's current
viewport default and page overrides. A failed page close resets only its own closing marker and restores that
surviving page's current effective viewport. This repairs declaration changes skipped while the resource was
closing; retaining the skipped native value or replaying the old declaration would leave stale state. Recovery
uses the same independent target budgets and connection ownership as release, preserving the original close or
removal outcome even if restoration rejects or times out. An ended transport skips these recovery writes.

Viewport release runs in a connection-owned fiber. Read the releasing caller's operation before supplying the
registration's captured context: a finished installation's operation is not the releasing caller. An active caller
waits only within its own deadline and marks cleanup unconfirmed if it stops waiting. Ordinary release outside
an operation, or release requiring confirmation, joins the cleanup fiber. Registry removal happens synchronously
before any caller returns. A closing connection performs cleanup inline if its scope can no longer own a fiber.
Keeping the native cleanup budget separate from the caller's wait avoids extending an expired operation by five
seconds while still retaining ownership of restoration work.

A context create reply is owned until initialization has installed its rollback path. The context is announced
before viewport initialization so pages observed during initialization have a known parent. Failure or interruption
of initialization attempts removal under a separate five-second detached budget, preserving the primary error or
interruption. Confirmed removal ends any remaining pages before removing the context's tables and emitting its
removal fact. If removal fails or times out, retain its known state and addition fact, reset the removal-in-progress
flag, warn, and mark cleanup unconfirmed. A native command may have taken effect without confirmation; neither a
warning nor a missing reply establishes that the context ended.

Rejected: aborting all release work on the first failure; swallowing install errors; reporting a context removed
without a successful native removal reply; and borrowing the initialization deadline for rollback, since it may
already have expired; and waiting for that independent cleanup budget inside an expired caller's finalizer.
Cleanup does not retry, and unexpected defects remain defects.


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

## Local upload transport follows launch and attach

A connection records only whether Strider launched or attached to the browser. Launched `FileInput.local`
retains native path upload, including absolute paths without caller services, relative paths resolved through
captured `Path`, and mixtures with Remote paths. Locator existence checks remain conditional on captured
`FileSystem`; chooser native paths keep their backend failure contract. Launch ownership is a practical storage
assumption, not proof: container or wrapper launches with a different filesystem must use `FileInput.bytes`.
An attached browser may be local, but always transferring there makes remote files work without further
connection classification. Copying every launched upload was rejected because it adds many commands and browser
storage to the common native-path case.

Attached Local and Bytes share a sequential transfer. Local descriptors open in a scope and use open-file stat
metadata followed by reads of at most 64 KiB. Bytes use views of their existing input. Each chunk is independently
base64 encoded, sent and acknowledged before the next is read; no complete encoded file or message is constructed.
A remote collector holds chunk parts and completed Files through an owned handle. The upload scope closes local
files, clears the collector and releases the handle on success, failure or interruption; remote cleanup has its
own bounded budget. Browser backing storage grows with the files. There is no arbitrary library size cap or
constant browser-memory promise: browser resource limits still apply. A disk sink and hard quota were rejected
as new capability and compatibility contracts without an established requirement.

Native paths and transferred files cannot coexist in one selection, because their two setters each replace it.
Preparation rejects such mixtures before any selection changes. Attached Local therefore combines with Bytes,
while launched Local combines with Remote. Empty lists use page-side construction: Chromium can retain synthetic
files after an empty native-path command. The collector validates live input type and cardinality before transfer
and again before final assignment; it never mutates selection or dispatches events during transfer. Locator native
selections also check live cardinality before dispatch, since native backends do not uniformly refuse several
files on a single-file input. Detached
chooser inputs remain valid when the backend identifies them. No WebKit adapter behavior is changed here: stock
WebKit currently appends native paths on multiple inputs, an existing replacement limitation.

The caller's basename and available open-file stat modification time survive transfer. Effect MIME lookup infers
MIME from the extension, falling back to `application/octet-stream`. Missing timestamps and Bytes use page-side
creation time. Local open, stat and read failures retain `FileUnreadable` for locators; chooser failures use the
existing decision failure report and cancellation policy. Missing caller services fail explicitly.

A chooser's user handler, preparation and staged application run in one registration-scope fiber under the
original absolute browser-clock deadline. Reads and chunk acknowledgements consume time left after the handler;
preparation cannot reset its budget or apply after expiry. Decision failures report in the resolving fiber, and
staged decisions retain their existing count-before-application ordering. Scope interruption cancels stalled work;
cleanup cannot leave a chooser waiting without a bound.

Chooser transfer preparation runs before the registration's handled count advances. The internal decision has
its own scope spanning preparation and staged assignment, so failed reads or acknowledgements stay uncounted,
while a prepared decision is counted before its final application as before. The user handler retains its
registration scope; introducing a temporary scope around that user callback would close resources the handler
intends to keep. The collector is released even if the deadline expires between preparation and application.

Launched stock WebKit supplies upload-time creation timestamps rather than disk modification times on its native
file path. This existing native limitation remains unchanged; transferred files preserve available open-file stat
times. Native timestamp expectations are explicit in the integration capability table, including exact disk-time
assertions for Chromium and Firefox and exact transferred-time assertions for attached Chromium.

## Password snapshot designation

Password inputs have no implicit ARIA role, but agents need a ref to fill them. When inferred interactivity is
enabled, the engine represents a roleless password input as an inferred editable node with password evidence,
including disabled and read-only controls. The designation describes its kind rather than promising an action
will succeed. Accessible names remain intact; controls with no accessible name remain unnamed. Password nodes bypass
inferred names so nearby text cannot become a false label. Their values are absent from snapshot and find data, including embedded-control values used to name other
elements. Explicit ARIA roles remain intact.

Find matches the literal designation `password` under its existing case and exact rules, separately from the
accessible name, and filters these nodes as `editable`. Snapshot diffs already compare role evidence.
Exported named password refs use `Expect.that` to wait for a snapshot containing inferred password controls
whose computed accessible name matches exactly, then combine their ref locators. This uses the engine's naming precedence without duplicating it
in generated selectors or inventing a role. A missing name waits under the current deadline and check interval; duplicate names remain ambiguous rather than
choosing one control. The first matching ref supplies the frame context, so a single framed match is supported;
combining matches from different frames still requires manual narrowing. Unnamed refs retain a password input selector and can require narrowing.

Rejected: dropping every name, which makes ordinary new/confirm forms ambiguous; treating every name as a label,
which misses title and placeholder names; and joining label/title/placeholder queries, which can match another
field's overridden hint even when its accessible name differs. The snapshot reads use the existing expectation wait rather than freezing an empty result before a late field
appears. Returned refs retain their normal stale-ref guarantees if a field is replaced after resolution.

Rejected: inventing an implicit textbox role, which would change ordinary role queries; naming the field
"Password", which would replace or invent an accessible name; and including its value, even under local capture.

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

## Chromium screencast ownership belongs to the session

CDP's parameterless Page.stopScreencast stops the session's stream, not one acquisition. Pinned Chromium
155.0.8059.79 rejects another start with `Screencast is already active`, so consumer counting alone does not
support overlapping acquisitions. Reuse a confirmed stream without another start, while keeping each acquisition's
metrics read. If an earlier owned start is still unconfirmed, a newer acquisition sends its own start; only the
specific already-active reply (-32000) can confirm joining the earlier stream. Other errors keep their mapping,
and an already-active reply with no earlier owned attempt remains a failure. An unknown start is not silently
assumed to be a working stream. Native overlapping-consumer coverage requires newly sized frames after the
first scope closes, so frames buffered before closure cannot establish delivery. A consumer reserves
ownership before the renderer metrics read and start, and registers its idempotent scope release before either
can run. Acquisition failure releases the same reservation without waiting for cleanup. Scope closure requests interruption
of a still-running acquisition before releasing ownership; it does not wait for a held metrics reply or transport
write. The start claim checks that its reservation is still open immediately before marking the command pending,
so scope closure cannot leave a later dispatch outside the abandoned-start cleanup path. The protocol client
reports a command's wire outcome synchronously, before a waiting fiber can consume the reply, including when
that waiter was abandoned. The adapter can therefore track a successful start without transferring ownership
after reply consumption. Rejection and session end are distinct outcomes; neither creates a stream to release.
This preserves the existing session-loss error mapping rather than introducing a new error contract.

A session's live and acquiring consumers suppress stop. Confirmation for sharing is separate from uncertain
start evidence requiring best-effort cleanup. The last release stops a known stream; an abandoned
unconfirmed start releases its reservation and supplies uncertain-start cleanup evidence immediately, unless
another stop was already attempted after it. Abandonment, last release, reply outcome and session end drive
cleanup; no grace interval or reply wait precedes the cleanup claim. This retains no consumer count indefinitely
and cleans even a start that never replies. A later rejection adds no cleanup, but cannot undo a stop already
issued for uncertainty. A stop before a future consumer reserves ownership is valid; a stop while that consumer
is acquiring or live is forbidden. A later success can establish another cleanup need; it still
cannot stop a newer consumer. Sharing requires confirmation from a start with no stop dispatched since it;
a late reply from before a cleanup exchange cannot prove the stream survived that stop. Command metadata retained for a late reply lasts until that reply or session end,
as it does for other resource-creating commands. Session end clears the ownership state.

Stop claims the session synchronously before its exchange begins. New consumers may reserve and read metrics,
but cannot send start until that exchange finishes. The whole exchange, including writing to the transport and
waiting for confirmation, runs interruptibly under a fresh one-second browser-clock budget; it clears the
acquisition's protocol deadline. A canceled caller waiting behind stop needs no start cleanup. Cleanup is best
effort and does not retry a failed stop. A transport that ignores interruption can outlive the budget; bytes already
accepted by a transport can still reach the browser. Missing confirmation does not prove native release.
The built-in pipe and WebSocket transports preserve command order on their connection. Frame delivery and acknowledgements are coordinated across the session's consumers.

Rejected: issuing another start for every confirmed-stream consumer, which Chromium rejects; independent finalizers or unconditional late-success stops, which stop another consumer's stream;
counting abandoned acquisitions until their reply arrives, which can retain ownership forever; waiting a grace
interval for an unknown outcome, which adds a hidden delay without proving success or failure; serializing entire
start/reply exchanges, which blocks a newer acquisition behind an abandoned start; registering cleanup after
consuming a reply, which needs a separate interruption-safe ownership transfer; and timing only stop's reply
wait, which leaves a blocked write outside the cleanup budget. The acquisition's renderer readiness read and
deadline remain in force, with no retries, activation lease or public options added.


Video shares this session stream with user screencasts. A frame is acknowledged once after every current consumer
has taken it, or released its scope; a fast consumer cannot acknowledge for a slower one. The session retains its
latest image for a consumer joining an idle confirmed stream, without another acknowledgement. An acquired
consumer that stops reading holds back new frames until its scope closes. This bounds native frame production
without blocking the page's renderer. Rejected: acknowledging separately per consumer, which bypasses backpressure,
and restarting the native stream for an idle join, which disrupts existing consumers.

## Capabilities extend through explicit services; emulation stays separate

A capability is native or `Unsupported`: native support uses a browser channel Strider speaks, and the capability table records why unavailable support is refused. A backend gains support only through an optional service explicitly provided to its browser layer, with the table reflecting that service and the caller's capability handle unchanged; Chromium's optional `VideoWriter` is the existing precedent. An emulation must be a separate capability with documented fidelity limits. A fallback between native and emulated capabilities must be the caller's explicit choice, and its result must identify which one it acquired. Separate capabilities preserve the meaning of native support while optional services let callers supply backend extensions consistently. Rejected: silent emulation fallback, which hides a fidelity drop and violates nothing implicit; and refusing all layering, which leaves callers to build inconsistent extensions themselves. Emulated authenticator and fallback APIs remain unbuilt, with their shapes undecided. This rule adds no Firefox channel: virtual authenticator acquisition on launched and attached Firefox remains `Unsupported`.

## Video files use an optional writer service

`VideoWriter` consumes timestamped JPEG or PNG images and a destination with fixed dimensions, and completes with
the finished file. Chromium reads it optionally when connecting and advertises video only when one is provided;
Firefox never reads it. `layerFfmpeg({ path })` requires `ChildProcessSpawner`, installs nothing and never searches
PATH. The video consumer keeps source timestamps relative to recording start, prepends the first picture at zero when its normalized capture time is later, and sends the last picture once more at stop time so a still ending lasts until stop. The zero-time copy gives files a picture from recording start and avoids FFmpeg end-relative seeks adding a nonzero start offset. It belongs in the core so custom writers and polled WebKit receive the same timeline. An already-zero or cached first capture needs no additional copy. Both boundary copies reuse their image without another source acknowledgement. Shifting every capture timestamp to the first capture is rejected because it loses recording-relative trace alignment; changing only the ffmpeg writer leaves other writers with different timelines. Each native Chromium stream anchors its first timestamp to local monotonic receipt time and maps subsequent browser timestamp differences, capped at each frame’s local receipt time; a missing timestamp uses local receipt time without changing the anchor. The core holds backward times at the preceding frame time, including transitions from receipt fallback, until source time catches up. This preserves later timestamps without asking ffmpeg to repair decreasing input. Initial capture/transport latency cannot be measured from these events and is included in the first-frame alignment. Capping at receipt prevents a forward browser-clock jump from extending the recording past stop. Since the anchor includes the first delivery’s latency, ordinary decreasing delivery latency can also reach the cap and shorten source intervals. A backward clock jump can flatten frames until source time catches up; heuristic re-anchoring is rejected because the events do not distinguish clock corrections from delivery latency and no threshold is required by the recording contract. Mapping browser epoch time through the client epoch is rejected because connected browsers can have different host clocks. WebKit uses its sample completion time. `layerFfmpeg` streams Matroska images with millisecond timestamps and encodes VP8 with timestamp passthrough. Fixed 25fps pacing is rejected because idle copies spend CPU and file space and delay a paint by up to 40ms. Strider fixes
the initial output dimensions in `Destination`; the writer must output every frame at exactly those dimensions,
scaled to fit, centred and padded black. The writer owns pixel fitting because it has the codec; Strider owns
that policy, timestamps, acknowledgements and lifetimes. Reusable writer conformance checks decode changing and odd-sized
inputs to verify output dimensions and padding. Its file lives in the context's downloads directory on Chromium,
or the explicitly named output directory on WebKit. Scope closure
or normal source termination ends input and allows five seconds on the browser clock to finish a started writer,
even while the caller scope stays open. An empty recording fails promptly without starting a writer; source failures
retain their errors. A failed or unfinished writer fails
`file` with `BackendFailure`. Native traces select video when available. Rejected: adding the writer to the
capability's requirement channel, which would require Firefox callers to provide an unused service; naming the
whole file-writing service `VideoEncoder`, which clashes with the DOM's WebCodecs name; and baking ffmpeg into
the adapter, which would prevent later WebCodecs, key-frame and PNG/polled-source implementations from using
the same boundary. In-browser preparation is rejected: even an isolated world shares the page's renderer main
thread, so base64 transfers, decoding, canvas drawing and re-encoding at 25fps compete with the page under test;
navigation destroys the realm and JPEG re-encoding loses quality. Core fitting in Node would require an additional
codec dependency; no implicit external image tool is introduced.

WebKit reads it only with an explicit polling interval and output directory on its layer; a writer alone
leaves video unsupported. PNG polling has renderer cost and misses intermediate states, so it is never
inferred from writer availability. The interval is finite and positive with no hidden default, and an absolute writable directory owned by the caller keeps video independent of unsupported WebKit downloads. The first PNG is
immediate, subsequent serial captures wait the configured interval after completion and any backpressure, and
navigation target replacement does not end the page proxy recording. Actual page, context or connection end is
observed independently of writer reads. Rejected: enabling polling whenever a writer is supplied, claiming
polled output is a native capture, and enabling downloads merely to supply a video destination.

## Expectation observations

Expectation history contains observed values and diagnostic error entries, and `last` is its final entry.
For locator expectations, page values must reach Strider before the deadline; with neither a page value nor a
diagnostic error recorded, history is empty and `last` is absent. Late replies do not update a returned failure.
A page can evaluate a value without delivering it in time, so a strict deadline cannot guarantee a page value.
`Expect.that` on an effect records `{ error: "a check was still running at the deadline" }` for an unfinished check,
even if no check has returned a value. This diagnostic describes the unfinished check rather than a page value.
Rejected: inventing a page value Strider never received, and waiting past the deadline for a reply, which breaks
the caller’s budget. Changing how observations are collected is not required by this contract.



## Diagnostic evidence at failure

An error's diagnostics are a snapshot of what its operation and steps know when it is built. A write starts
uncertain even after an earlier write was confirmed; a successful adapter reply or explicit browser rejection
records acknowledgement of that call. Evaluations explicitly sent as writes use the same reply recording;
read-only evaluations cannot confirm an earlier write. Engine actions record their applied answer, and a guard's proof that
input did not reach the page remains `NotSent`. Adapter methods may send several protocol commands; their overall
reply is not a delivery ledger for those commands.

Cleanup reports evidence owned by the operation: completed or failed input recovery, and pending abandoned
creation cleanup. It preserves existing resource owners and cleanup budgets. A summary gives known failure
precedence over pending work, pending over completed, and completed over no cleanup; the first known failure
supplies the cause. A step contributes its cleanup before the enclosing operation builds its error.

Rejected: waiting past the deadline to obtain a final cleanup answer; transferring ownership to diagnostics;
letting future scope finalizers rewrite earlier errors; treating any adapter failure as a browser rejection;
and preserving an earlier acknowledgement across a later unanswered write. These would respectively change
timing, lifetime, snapshot semantics or the evidence available to decide whether repeating an action is safe.

Overlapping calls and steps retain uncertainty until each write has an acknowledgement. Ending a wait without a
reply, including interruption, leaves that outcome uncertain when another overlapping call replies later. If all
writes are acknowledged, any rejection takes precedence over successful replies. A later independent write starts
with fresh evidence. A step that succeeds after handling a known missing reply cannot infer confirmation from its
success; a manually marked send can still be confirmed by a successful step. Recovery releases are writes too, so
acknowledgement alone does not prove that the requested gesture was dispatched.

Rejected: counting only calls still running, which loses uncertainty when a wait ends before another reply;
and allowing one reply or a successful error-handling step to confirm the other writes in its operation. Dispatch
bookkeeping is acquired and released with interruption-safe finalizers; it adds no wait, deadline or resource owner.

Dispatch overlap follows writes, not the lifetime of every enclosing step. A read-only step can remain active
while several independent writes finish; it contributes no dispatch evidence and cannot retain a previous
acknowledgement or overwrite a later guard result when it finishes. Actual call lifetimes propagate through
enclosing operations as they start and end. Manual sends participate until their guard, confirmation or step
completion settles them. A tracked call takes over its caller's preparatory manual send annotation; confirming
or guarding a different manual send cannot erase a concurrent call's missing reply, even after that call's wait
has ended. Rejected: using every active step as an overlap member, which lets unrelated read waits hide later
evidence and keep already finished write groups alive.

A guard cancels only its source record's tentative send. In that record, it restores `NotSent` for the guarded
gesture. In enclosing records, an overlap consisting only of guarded child sends contributes no new delivery
evidence, so the evidence from before that overlap survives. A completed or unanswered unrelated write in the
overlap still takes precedence. Rejected: forwarding a child's cancellation as replacement of an enclosing
operation's prior evidence, which could claim safe retry after an earlier write had reached the browser.


Generic expectations classify observations from the exact library-produced `page.url` Watchable and `page.title`
effect by source identity, including each fresh title getter and library access guards. Both watching and polling
attach this metadata to the failure when it is created; it follows rethrows of that same object, and each trace
export applies its chosen diagnostics preset. Dedicated matchers retain their expected-value redaction; generic
condition descriptions remain user-authored text. User transformations, including `Watchable.map` and `Effect.map`,
and reconstructed failures do not inherit source classification, because arbitrary transformations can change both
type and meaning. Rejected: guessing from strings, retaining URL/title classification through arbitrary mappings,
and parsing generic descriptions as dedicated matcher syntax. This is source metadata, not general secret tracking.


Vitest failure tracing is opt-in on the browser layer, with recording state owned by each bound callback and its
captured test identity. The shared backend never owns a callback's recorder, so concurrent tests and retries keep
their own metadata and attachments. Adapter recordings default to per-action screenshots, DOM snapshots and
network capture, with screencast off; explicit settings can reduce capture, and disabling network requires
disabling snapshots. These defaults make failed-test traces useful without changing direct `Trace.record` calls.
Rejected: changing the general recording defaults, which adds capture cost outside tests, and owning recordings
in the memoized browser layer, which shares one callback's identity with later callbacks.

## Operation caller stacks

Capture six caller frames in the operation constructor before calling the formatting helper,
and defer formatting until a recording or failure rendering needs the frame. This keeps construction-time source
links for prebuilt operations while reducing work on every unrecorded successful call. When capture is enabled but
no user caller is available, retain the operation name without a location in failures, and omit unavailable source
locations. The informational name is an accepted trade-off for avoiding eager formatting: Effect's frame contract
cannot lazily omit a node. Reject eager caller resolution on every success and dependency changes to remove that
rare location-free line. Capture remains independent of recording so failures outside recordings and operations
built before recording retain their callers.

## Sent-header waits end with their owner

Sent-header waits end when a hop is evicted or loses its owning frame, worker, context, page or browser connection,
returning already-attributed sent headers or the immutable request snapshot. Removing a frame includes its
descendants and leaves unrelated owners alone. Owner loss does not imply a network failure. Waiting until the
deadline after the owner is gone was rejected because no further report is assured. Late attributable headers
may still update retained data without reopening settled waits or rewriting flushed recordings; guessing across
redirect hops was rejected because attribution must remain correct.

## Context proxy routing and authentication

Route a context through an HTTP proxy at its creation, leaving omitted proxy settings unchanged and keeping
loopback destinations direct. Use native per-context proxy settings on CDP/BiDi and isolated process environment
overrides for launched stock WebKit, whose command-line proxy setting does not apply in automation mode. Keep
proxy credentials separate from endpoint URLs and Redacted through protocol encoding. Answer only positively
identified proxy challenges, once per request, retaining website auth routes. Reject WebKit credentials and
configured credentials on attached Firefox. Firefox reserves each endpoint's credential pair (including none)
synchronously before creation and retains it for the connection lifetime after successful creation or an uncertain
outcome, because its native proxy auth cache crosses context boundaries and survives removal. Each pending creation
owns a share; confirmed pre-creation rejection or confirmed unused rollback releases only that share. Reject both
permanently pinning credentials on a definite unused failure and clearing another creation's pending or retained binding. Reject silently reusing another context's credentials, clearing a shared cache,
preemptively sending secrets, modifying the parent environment, and inserting an HTTP relay or browser-process
shim to disguise unsupported isolation. Bypass host matching stays native and is stated in the API; do not accept
unverified wildcard, CIDR, SOCKS or HTTPS-to-proxy configurations.

## Native passkey testing

Virtual authenticators use native Chromium WebAuthn and belong to one page's scope, with one live acquisition per page so cleanup cannot disable another caller's environment. Credentials may be explicitly exported and imported into a second page or popup; those copies keep separate signature counters. Chromium's native environment follows a frame tree rather than a browser context, so context-wide sharing is not offered. Replacing `navigator.credentials.create/get` with a shared JavaScript implementation was rejected because it would test our emulation instead of the browser's WebAuthn. Firefox's classic WebDriver commands are outside Strider's BiDi transport, and stock WebKit's declared Automation credential commands are not implemented; these backends refuse acquisition rather than substituting behavior.

## Shared snapshot and role-filter states

Snapshots and role filters use the same pressed, expanded and selected readers, with positive snapshot markers only for exactly true. Preserve the documented query defaults and ASCII case-insensitive keywords without trimming, rather than introducing browser-dependent accessibility error handling or new malformed-token defaults. Native option selection and details open state take precedence over ARIA; open ordinary details is a native exception to snapshot role gating, without admitting group expanded filters or adding summary semantics. Reject independent attribute-only snapshot parsing because it contradicts query results, and reject copying browser accessibility trees because their native/ARIA conflict resolution can differ from Strider's existing native-property query contract.

## Route declaration boundary

A route is in force for requests that start after its declaration returns. On Chromium, requests already underway without response interception may miss a later response route; existing response pauses select the current routes by precedence. This follows the browser's selection of interception stages at request start while keeping later handler selection current. Requiring retroactive response interception was rejected because it would require pausing responses from the start even without response routes.


## Pay for what you use

Optional browser features do work only when requested, within the owning context or operation. Contexts that
never request a feature gain no interception, injected instrumentation, per-action checks or retained request
state for it. Additions must include paired default-path benchmarks so review can assess their cost. Reject
always-on preparation for optional features: unused capabilities must not slow existing automation.

## Request failure observations

Request failure reads inspect the existing bounded hop index immediately, using the original request instance
and its live owner. Missing retention and owner loss are unavailable observations, never evidence of network
failure; returned data can be saved independently. This preserves bounded memory and avoids new work in unused
contexts. Waiting, automatic retention and replaying decoded snapshots were rejected for this read; scoped
retention belongs to operations that explicitly request it. Cancellation is known only from protocol evidence,
not inferred from error text, so BiDi leaves it unknown.

## Editability reads share editing rules

`isEditable` reads the same predicate as editing actions and `toBeEditable`: an enabled text or settable
input, textarea or contenteditable element that is not read-only. Unsupported kinds return false so callers
can branch on the predicate without handling a type error. Visibility and inertness remain separate checks.
Rejected: a broader read-only definition accepting selects, checkboxes or ARIA-only textboxes, because a true
read would then describe kinds Strider's editing actions do not accept. This preserves existing action
semantics rather than adopting Playwright's broader kinds and unsupported-kind exception.

## Explicit DOM event constructors

DOM event dispatch explicitly selects a native constructor, defaulting to Event independently of the event name.
Initialization crosses by value under the existing evaluation serialization contract, and the target document
constructs and dispatches the event. This keeps application events and native event fields explicit across
browsers. Reject name-to-constructor inference tables and emulation of missing constructors or touch dictionaries:
those hide browser differences and make the library define DOM behavior. Missing constructors are typed refusals.

Dispatch follows [Pay for what you use](#pay-for-what-you-use): its event function is sent only when invoked.

## Shared DOM roles

Role assertions, role locators and snapshots use one DOM role computation, retaining HTML-AAM `generic` roles for plain elements such as `div`. This keeps existing locator and snapshot meaning consistent even where Playwright omits generic roles. Presentation conflicts and required-child inheritance are resolved in that shared computation, including inherited-role exceptions on the child and cancellation on its parent. Tabindex focusability uses HTML integer parsing: skip ASCII whitespace, accept an optional sign and leading ASCII digits, and ignore trailing text. This agrees with native focus behavior for `0.5` and `2abc`; copying Playwright’s JavaScript number conversion would reject `2abc` and accept non-ASCII leading whitespace. Rejected: a matcher-specific role model that changes the meaning of the same element between querying, asserting and inspecting it, and copying upstream inheritance where it conflicts with ARIA's focusability or global-property exceptions.

## Retrying CSS assertion cardinality

CSS expectations retry missing and multiple matches until exactly one element matches, even under negation.
A transient duplicate during a render should settle under the same deadline as a transient wrong style; negating
the value comparison must not let an absent or ambiguous element satisfy it. This follows the existing
single-element expectation engine. Rejected: immediate multiple-match rejection as in Playwright, which treats
transient ambiguity differently from other unsettled expectation states, and negating cardinality together with
the value, which could pass without observing the requested element.

## Extra request header ownership

Extra request headers use the existing scoped override registry and native protocol header commands. Each
registration replaces the map within its scope; page headers merge over context headers, with page values
winning when names match. Removal restores the preceding map within the scope, and an empty page map retains
context headers. This matches BiDi's native header merging and Playwright's contract. Rejected: replacing the
whole inherited map, which BiDi cannot implement natively; interception solely to remove inherited headers,
which adds unnecessary request handling. Unset configuration adds no header commands or request state,
following [Pay for what you use](#pay-for-what-you-use).

## Bounded redirect evidence

Redirect neighbor access reads the existing bounded hop index through a scoped page or context handle. It
adds no request tracking or cache, following [Pay for what you use](#pay-for-what-you-use). Original snapshots
and model ownership establish which target can read a link. Observed links are authoritative, including canceled
successor attempts. An absent link is a boundary only with terminal evidence; a committed navigation naming the
exact hop can supply that evidence from the existing bounded event log. Insufficient proof is an explicit typed
unknown outcome, separately recoverable from retention, ownership and lifetime errors. Missing terminal navigation
evidence in disabled or incomplete history is an unavailable-evidence error, so unknown recovery cannot hide
retention loss. Completion alone cannot
settle a redirect on BiDi, which reports it before its successor and exposes no fetch redirect mode. Inferring a
boundary from status, Location or elapsed time was rejected because it can invent an end. Unlimited object links
were rejected for unbounded retention; another opt-in cache or injected fetch wrapper was rejected because it
would add tracking without supplying the missing native request identity or terminal signal.

## Context HTTP credentials

Context HTTP credentials supply one default pair with an optional origin restriction; auth routes select different
pairs for different origins. Keeping origin-specific selection in routes avoids a second routing table and keeps
page and context route precedence explicit. User auth routes run before the configured pair, and automatic
submission is bounded to one attempt across a native request and its whole redirect chain, including changes of origin,
so rejection cannot create an unbounded challenge loop.
The alternative of an ordered credential array is left to auth routes, which already express that selection.
Optional interception follows [Pay for what you use](#pay-for-what-you-use).

## Generated reference outputs and curated comparisons

API indexes and the capability matrix's browser statuses and current evidence hashes are ignored outputs,
regenerated during validation; package builds and packing recreate the indexes for publication. Matrix classifications,
requirements and provenance remain curated, with one stable-ID row per file, so unrelated features in the same
Playwright class can merge independently. Hashes describe current inputs, never an acknowledgement of semantic review;
source symbols, quotations, completeness, decisions, capabilities and built links are still checked on each PR.
Stored browser-status and adapter-capability snapshot drift gates are removed too: capability changes require
reviewing generated results rather than committed snapshot diffs. Generated code remains tracked with freshness checks.
Rejected: per-module index fragments, which keep redundant output; per-class matrix files, which still couple
concurrent Locator or Page features; and post-merge generation, which delays validation and needs privileged writes
unavailable to fork PRs.

## Existing-context storage replacement

Replacement requires creation-time tracking and preserves live pages. Native protocols cannot enumerate closed
origins across backends, so only opted-in contexts retain history, following [Pay for what you use](#pay-for-what-you-use).
Untracked contexts have only context-local dispatch checks. Replacement refuses live authenticator handles and
unreproducible histories, and clears origins before cookies. Running writers and open storage handles can cause typed partial failure;
pending deletions cannot be cancelled. Always-on history, context replacement, silent merging and atomic rollback
were rejected.

## Read-only event admission on the protocol reader

Optional event scopes may synchronously inspect adapter ownership state on the protocol reader to reject events
before queueing and parameter decoding. All adapter state changes and fact application remain in the worker, which checks
the scope again before decoding queued events. This keeps disabled contexts from paying for optional chunk
collection while preserving per-session isolation. Rejected: queueing every optional event for a worker-side check,
which charges disabled contexts, and a browser-wide enabled switch, which charges unrelated contexts.
