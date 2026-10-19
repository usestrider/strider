# Design review — draft 5

*2026-10-19. Review of commit `3343b0a3d6badab260ca4e8e7be65e70255f424f`: README.md, API.md, CONCEPTS.md, PROTOCOL.md, PROBES.md and CLI.md after revisions 5.1–5.20. This commit records the review only; it does not revise the documents.*

The lens for this review comes from the positioning added in `3343b0a`: the project is not a better Playwright, and prior art is evidence, never a reason on its own. So every feature we share with Playwright was checked against the question "would our principles produce this if Playwright didn't exist?" The review also serves as the consistency pass over 5.1–5.20 that the README's "Next" called for.

The answer is mostly yes. The core of the design follows from the principles, even where it lands where Playwright did. The problems are at the edges: the agent toolkit, which predates the CLI; places where we copied an API surface along with its overlaps; type signatures that inherit Playwright's unsoundness; and names that break our own naming rule.

## Shared with Playwright, and kept for our own reasons

| Feature | The principle that produces it |
|---|---|
| Lazy locators, re-resolved on each attempt | correctness under change (2, 3): a held element goes stale, a query doesn't |
| Strictness: an action needs exactly one match | rule 23: ambiguity fails immediately instead of picking one |
| Actionability waiting | rule 23, applied: the checks are named, adjustable per call and reported in errors, rather than hidden |
| Retrying expectations (`Expect.to*`) | rule 23: waiting is asked for in code, and retries have a name (18) |
| Contexts and storage state | isolation per user context, a spec concept (1); export is deliberate (11) |
| `route` and its decisions | obligations get exactly one decision (6) |
| Init scripts | declarations with stated timing (9) |
| Accessibility snapshot text with refs | ergonomics for agents, which already read this format; ours is one rendering of a structured, evidence-tagged tree |
| Download files deleted with their context | seeing an event acquires nothing (5.19); the context owns its directory |
| `browser.newPage` | a convenience at the dominant call site, documented as its expansion (22) |
| Launch flags | made into a visible `LaunchProfile` value (23), where Playwright adds them silently |

Where we already go beyond Playwright, and should keep doing so: typed access levels, scoped lifetimes, typed end reasons, dispatch evidence and hints on every error, no settling windows, event modules with `next`/`stream`/`history`, evidence-tagged inference in snapshots, and a CLI with no default session and no current page.

## Findings

### 1. High — The agent toolkit predates the CLI and contradicts it

**Where:** API.md, Agents (`BrowserToolkit`, `ActionReport`); CLI.md, Commands ("Commands are the toolkit's tools").

CLI.md derives its commands from the toolkit's tools, but the toolkit was sketched before the CLI settled its rules, and it now breaks them:

- **`tabs` implies a current tab.** The CLI has none: every page command names its page. `BrowserToolkit.make({ page })` also binds a single page.
- **`wait` is unspecified.** Rule 23 allows no unnamed waiting. The CLI has `next`/`await` and `Expect`.
- **`click(ref)` has no page.** Refs belong to one page's snapshot.
- **`ActionReport.observed` needs an attribution window.** To report which navigations, popups, downloads and DOM changes an action caused, something must decide how long to keep watching after the action. That is the settling that Playwright's MCP server does with 500 ms, and Chrome DevTools MCP with a navigation wait plus a DOM-quiet window. Rule 23 forbids it. `dom: Changed | Unchanged | NotObserved` needs exactly the `DomQuiet(T)` window flagged in finding 7.
- **Two mechanisms report the same thing.** The CLI's since-last digest reads `history` between calls, with no window. `observed` would be a second, different answer to "what happened?" (principle 22).

**Recommendation:** rewrite the toolkit from the CLI's model.
- Every page tool takes a page handle, and there is no tab selection.
- Waiting tools are `next`/`await` and `expect`.
- Replace `ActionReport.observed` with the digest. Its boundaries are calls, not time windows, and it already says what it saw without claiming causation.
- Drop `dom`. A caller who wants to know whether the DOM changed takes a snapshot and diffs it explicitly.

**Acceptance case:** a model drives two pages through the toolkit. Each tool call names its page, and no call waits for a window that isn't named in its arguments.

### 2. High — `Snapshot.ref` hands out actions on pages you may only inspect

**Where:** API.md, Top data models (`Snapshot.ref(id): Locator`); Conventions, "Access is typed".

`ReadonlyPage.snapshot` returns a `Snapshot`, and `snapshot.ref(id)` returns a `Locator`, which has `click`. So a page held with `inspect` access yields an action through its snapshot. Typed access is one of the design's central guarantees ("calling an action on a page you may only inspect is a compile error"), and this is a hole in it.

**Recommendation:** the snapshot carries the access of the page it came from. Either make `Snapshot` generic in its locator type (`Snapshot<L extends ReadonlyLocator>`, with `ReadonlyPage` returning `Snapshot<ReadonlyLocator>`), or move resolution onto the page (`page.ref(snapshot, id)`). The first keeps today's call sites.

### 3. High — `evaluate` changes worlds depending on the static type

**Where:** API.md, Pages (`ReadonlyPage.evaluate`, isolated world; `Page.evaluate`, main world).

`Page extends ReadonlyPage` and overrides `evaluate` with main-world semantics. A helper that takes a `ReadonlyPage` and calls `evaluate` expects the isolated world, where page globals are invisible. Given a `Page`, which the subtyping explicitly allows, the same call runs in the main world and can see and change page globals. Behavior changes with no change at the call site, which is exactly what rule 23 forbids, and the subtype relation (`ReadonlyArray` ⊂ `Array`) promises the opposite.

**Recommendation:** one name per world. `evaluate` is the isolated world everywhere. The main world gets its own member, available only on `Page` because it needs control: for example `evaluateInPage`.

### 4. Medium — `evaluate`'s types claim more than serialization delivers

**Where:** API.md, Pages (`evaluate<Args, A>` returns `Effect<A, …>`; `evaluateAs(schema, fn: (...args: any) => unknown, ...args: ReadonlyArray<unknown>)`).

The result crosses a serialization boundary, but the signature returns the function's own return type `A`. Class instances arrive as plain objects, functions and symbols vanish, and DOM nodes can't arrive at all. Playwright and Puppeteer carry the same lie. "Better TypeScript" means the type says what arrives. Separately, `evaluateAs` types its function and arguments as `any`/`unknown`, so the arguments lose the checking that `evaluate` has.

**Recommendation:**
- `evaluate` returns `Serialized<A>`: a mapped type defined once, alongside the L1 serializer. It drops functions and symbols, flattens class instances to their data, keeps the built-ins the serializer supports, and makes DOM nodes a compile error with a hint pointing to `evaluateHandle`.
- `evaluateAs` keeps the same typed `fn` and `args` as `evaluate`. Only the result type comes from the schema.

### 5. Medium — Names that break our own naming rule

**Where:** API.md (`Clock`, `File`, `Headers`, `Observable`, `Cond`).

Revision 5.19 set a rule: the most specific accurate name, prefixed only where a bare name would clash. Several older names clash:

| Name | Clashes with | Recommendation |
|---|---|---|
| `Clock` (page time) | Effect's `Clock`, which tests use next to it | `PageClock` |
| `File` (`File.local`, …) | the DOM `File` global, also a global in Node 20+ | `FileInput`: the type already has that name |
| `Headers` | the fetch `Headers` global and Effect's `Headers` | use Effect's `Headers` from `effect/http`, which already redacts sensitive values (`Headers.redact`, `CurrentRedactedNames`) |
| `Observable<A>` in `Expect.that` | the TC39/RxJS concept and our removed `Observation`; it is also never defined | define it as what `Expect` accepts, and name it after that role |
| `Cond` | Effect spells module names out (`Predicate`, `Option`) | `Condition`, matching its type |

Reusing Effect's `Headers` is the strongest of these: it is the integration "better TypeScript with Effect" promises, and it brings redaction we would otherwise write ourselves.

### 6. Medium — The page clock copies Playwright's API, overlaps included

**Where:** API.md, Page time; CONCEPTS.md §7, Page time.

`install` has `fixed`, `offset` and `controlled` modes, and the clock also has `setFixedTime`, `pauseAt`, `runFor`, `fastForward` and `resume`. That is Playwright's clock surface. `setFixedTime` overlaps `install({ mode: "fixed" })`, and `pauseAt` overlaps `controlled` with `at` (principle 22). The section also justifies the replay log with "which is how Playwright's clock works", when the real reason is ours: page time must survive navigation.

Effect users already know a vocabulary for this, `TestClock.adjust` and `TestClock.setTime`.

**Recommendation:**
- `PageClock.install(mode)` keeps the modes as data.
- Two advancing verbs in Effect's words: `adjust(duration)` fires due timers in order, like `TestClock.adjust`; `setTime(at)` jumps, firing due timers at most once, which models a machine waking from sleep.
- `resume` returns to real time.
- Remove `setFixedTime` and `pauseAt`; they are `install` modes.
- Justify the replay log by navigation, not by Playwright.

### 7. Medium — The default wait in `goto` is unstated, and two readiness predicates are time windows

**Where:** API.md, Pages (`waitUntil?: LoadState`); CONCEPTS.md §8 (`NetworkIdle(N, T)`, `DomQuiet(T)`).

`LoadState` is never defined, and neither is the default for `waitUntil`. The most common call in the library therefore has an unstated wait, which rule 23 rules out. `NetworkIdle` and `DomQuiet` are, by definition, waits for T ms of silence: heuristic windows. Playwright keeps `networkidle` and discourages it; we carry both without a call site that needs them.

**Recommendation:**
- Define `LoadState` as `"commit" | "domContentLoaded" | "load"`, state the default, and show the state actually waited for in the span.
- Remove `NetworkIdle` and `DomQuiet` from L1 until a scenario needs them. If one returns, it should be an explicit `Expect` condition with a required T and no default.

### 8. Medium — `Expect` has three mechanisms where Effect has one

**Where:** API.md, Expectations (`Expect.soft`, `Expect.poll`, `Expect.that`).

- `Expect.soft` reimplements Playwright's soft assertions with its own `SoftExpectations` service. Effect already accumulates failures: `Effect.validate`, or `Effect.all(…, { mode: "result" })`. A second accumulation mechanism is exactly what principle 22 forbids.
- `Expect.poll(effect, condition)` and `Expect.that(subject, condition)` do one job, retrying a condition until the deadline, for two kinds of subject.

**Recommendation:** drop `Expect.soft` and `SoftExpectations`. Merge `poll` into `that`, which accepts a `Watchable`, a locator, or an `Effect` that it re-runs at the interval.

### 9. Medium — HAR replay is a second mocking system, for tests we said would be reworked

**Where:** API.md, Recordings (`Har.replay`, `Har.replayWith`).

Replay has its own matching rules, ambiguity modes, redirect handling and miss policy. It is a second way to mock the network beside `route` (principle 22), and it exists for tests, which the user expects to rework once etest ships. Recording is different: HAR is a standard format, and a recording serves debugging and agents as much as tests.

**Recommendation:** keep `Har.record`; defer `Har.replay`, and keep mocking in `route`. In the same pass, trim the Testing section to what "good enough until etest" needs: the Vitest layer and `BrowserTest.page`. `restart` policies and the `trace` option can wait for a real need.

### 10. Low — Traces: spans are the record; Playwright's zip is one export

**Where:** API.md, Recordings (`Trace.record`, "Traces open in Playwright's trace viewer").

The section reads as if Playwright's trace format were our trace. In fact every operation is already an `Effect.fn` span, and that is the Effect-native record: it exports to any OpenTelemetry backend. Screenshots and DOM snapshots are attachments to spans. The Playwright zip, pinned to version 9 of an internal format, is valuable because it opens in an existing viewer, but it is one exporter.

**Recommendation:** reword so `Trace.record` collects spans and their attachments, and list the exporters: OpenTelemetry, and the Playwright zip for the viewer.

### 11. Low — `toMatchAriaSnapshot` adopts Playwright's template language

**Where:** API.md, Expectations.

The matcher takes Playwright's YAML template, a string DSL with its own partial-matching and regex rules that we would have to specify and parse. Our snapshots are structured, evidence-tagged data. A typed pattern built from functions would match that model and get type checking. On the other hand, the text form is readable, and agents already write it.

**Question for the user:** a typed pattern, the text template, or the text template parsed into the typed pattern?

### 12. Low — `BrowserContext` versus the spec's user context

**Where:** API.md, throughout; README principle 1.

Principle 1 says the model uses spec identities, and L1 does: `UserContextModel`, `UserContextId`. L2 uses `BrowserContext`, the Playwright and Puppeteer name. `UserContext` would match the spec and BiDi, and it avoids the clash with Effect's `Context` just as well. Revision 5.1 chose `BrowserContext` deliberately, so this is raised only because principle 1 points the other way.

### 13. Low — Consistency after 5.1–5.20

- **API.md's header** still says "Revision 5.2".
- **"Snapshots are named `read*`"** (API.md, Conventions) means one-shot reads, but since 5.12 `Snapshot` is a type and `page.snapshot` is a noun. Reword it as "one-shot reads are named `read*`, `is*` or nouns".
- **"Locators are values, resolved again on every attempt"** needs an exception now that `snapshot.ref(id)` returns a `Locator` that is never rebound.
- **CONCEPTS.md §6** says body collection is acquired "before the trigger". Since 5.19 that means before `next` or `stream` returns.
- **`ObservationReleased`** in `CloseReason` was the end reason for resources owned by an observation. Since 5.19 nothing is owned that way; remove it, or redefine it as the end of a `Pending` whose scope closed.
- **`CurrentSession.page(name: string)`** accepts generated handles like `p2` as plain strings, which principle 14 forbids for tokens. Accept only names chosen with `--name`, or brand the handles.
- **API.md is 8.5k words,** against 5.9k for CONCEPTS.md and 2.9k for PROTOCOL.md. Findings 6, 8 and 9 remove most of the excess.

## Summary

| # | Severity | Finding | Principles |
|---|---|---|---|
| 1 | High | toolkit contradicts the CLI; `observed` needs a settling window | 22, 23 |
| 2 | High | `Snapshot.ref` leaks actions past typed access | access typing |
| 3 | High | `evaluate` changes worlds by static type | 23 |
| 4 | Medium | `evaluate`'s result type ignores serialization | better TypeScript |
| 5 | Medium | names that clash (`Clock`, `File`, `Headers`, `Observable`, `Cond`) | 18, 5.19 naming |
| 6 | Medium | page clock copies Playwright's overlapping API | 22, Effect vocabulary |
| 7 | Medium | unstated default wait; time-window predicates | 23 |
| 8 | Medium | `Expect.soft` and `poll` duplicate Effect and `that` | 22 |
| 9 | Medium | HAR replay is a second mocking system; testing trim | 22, testing scope |
| 10 | Low | traces framed as Playwright's format | Effect-native |
| 11 | Low | aria template language (question) | better TypeScript |
| 12 | Low | `BrowserContext` vs the spec's user context | 1 |
| 13 | Low | consistency nits and API.md size | — |
