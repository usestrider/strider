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

## The browser model (L1)

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
