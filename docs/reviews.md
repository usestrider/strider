# Past design reviews

A change to the design starts as a review in `reviews/`, committed on its own, and is then built and recorded in
the README's Status. Once a review's last step is built, what it decided lives in the layer documents, the reasons
and the alternatives it rejected that they don't hold move to [decisions.md](decisions.md), and its file is
deleted. This is the index of the deleted ones, so that the "review 22" a document, a quirk or a code comment cites
still says what was decided and where. Each file's text stays in git:

```sh
git show <commit>:reviews/<file>
```

The reviews still in flight are in [reviews/](../reviews/).

### Review 1

**Draft 1** (`01-draft-1.md`), 2026-10-18; text in `a618200` (as `REVIEW.md`, moved to `reviews/` in `5f4b4dc`),
applied in `60b51e9`. The first native model stated guarantees before their limits were worked out. The review
separated interruption from a lifetime's failure and from a dispatch whose effect is uncertain, which became
operation records; observing a resource from owning its destruction; and asking for a close from a lifetime's end.
It replaced inferred navigation outcomes, the default realm's reset, override stacks and retries by tag with
contracts on evidence, and asked for one deadline per operation, capabilities bound to the instance, body capture by
intent and portable storage state. Now in CONCEPTS.md §1–§9, PROTOCOL.md's Ingestion pipeline and the README's
principles and One deadline per operation.

### Review 2

**Draft 2** (`02-draft-2.md`), 2026-10-18; text in `5f4b4dc`, applied in `5436c0e`. L1 mints every public id, with
backend ids as evidence only; settings and handlers have one precedence; errors are `TargetGone`, `Timeout` and
each verb's own; `goto` has a default projection; streams end normally on a normal close; `PromptBlocking` can be
waited on; a declaration whose timing can't be met fails with `Unsupported`; popups are owned with their openers, in
an ownership ledger; filters run before buffering. It added `Redacted` values, evaluation with user activation, page
time, long-lived connections and the README's Guarantees at a glance. Now in CONCEPTS.md §1–§10, the README's
Errors and Guarantees, and PROBES.md probes 19–21.

### Review 3

**Draft 3** (`03-draft-3.md`), 2026-10-18; text in `f93144b`, applied in `6cc0bc1`. Draft 4 split what draft 3's
policies merged: control scope from release policy and cleanup owner; diagnostic redaction from an explicit export
of storage state with its secrets; declarative prefilters from callers' predicates. Backend failures stayed typed,
init scripts became an ordered bundle, clock domains were defined so a paused clock never stalls actionability, the
persisted ledger yields reclamation candidates only, and redirect hops got their own identity. Now in CONCEPTS.md
§1–§3, §6, §7, §9 and §10, and the README's Errors and Diagnostics and secrets; its reasoning in
[decisions.md](decisions.md).

### Review 4

**Draft 4** (`04-draft-4.md`), 2026-10-18; text in `d7aaa43`, applied in `cc1f717`. It asked to stop growing the
prose and compile the acceptance scenarios, and revision 5 split the design into README, API, CONCEPTS, PROTOCOL and
PROBES. Its findings: pause-on-start granularity as a capability (probe 22); an `inspect` access level;
`NotPermitted` apart from `Unsupported`; one replayed page-time timeline per scope; init-script dependencies only on
equal or broader scope; diagnostics presets. Now in the README's Status, Errors and Diagnostics, PROTOCOL.md's
Pause-on-start granularity, CONCEPTS.md §3, §5 and §7, and API.md's Conventions and Page time; its reasoning in
[decisions.md](decisions.md).

### Review 5

**Draft 5** (`05-draft-5.md`), 2026-10-19; text in `d5b7c82`, applied in `37cc9b1` (revision 5.21). Every feature
Strider shares with Playwright was checked against one question: would our principles produce this if Playwright
didn't exist? The agent toolkit was rebuilt from the CLI's model (every tool names its page; waits are tools; a
digest bounded by calls replaced `ActionReport.observed`); snapshots carry their page's access and `evaluate` is
always the isolated world; names became `UserContext`, `PageClock`, `FileInput`, `Condition` and Effect's `Headers`;
the clock took `TestClock`'s verbs; `Expect.soft` and `poll` went; navigations resolve at commit, with no idle
predicates. Now in API.md's Conventions, Pages, Expectations, Page time and Agents, CONCEPTS.md §4 and §8, and
CLI.md; the reasons in [decisions.md](decisions.md).

### Review 6

**Draft 5, against Effect's own modules** (`06-draft-5-effect.md`), 2026-10-19; text in `624d5c7`, applied in
`73e429c` (revision 5.22) and `e158df0` (5.23). Revision 5.21 checked against Effect's `main` at `93abf0208`: routes
use `effect/http`'s `HttpServerResponse` and `HttpClientRequest`, captured responses are `HttpIncomingMessage`s,
preset-dependent values implement `Redactable`, secrets come from `Config.Redacted` with `layerConfig` for launches,
archives use `encoding/Zip`, spans go to `observability` and `devtools`, tool failures go back to the model, the CLI
is built from `effect/cli`, `rpc` and `socket`, and internal mechanisms name their Effect primitives. Now in
[conventions.md](conventions.md) (Effect's modules first), the README's Diagnostics and Observability, API.md,
CONCEPTS.md §9 and §10, and CLI.md.

### Review 7

**Effect core team conventions** (`07-effect-conventions.md`), 2026-10-19; text in `e3b66de`, the decision in
`8f2d195`, applied in `18be229` and `702feb4` (revision 5.25). Revision 5.24 checked against the Effect team's
guidance and shipped modules; all twelve conventions it proposed were adopted, with a thirteenth, the generated API
reference, and four refined (access levels keep full names, brands live in their owning modules, shared reasons go in
`Reason`, every export states its stability). Its record is [conventions.md](conventions.md), which API.md's
Conventions section applies.

### Review 8

**Finishing L0: the backend adapter and its boundary with L1** (`08-l0-adapters.md`), 2026-10-20; text in
`f4940f5`, applied for CDP in `27f38f2`, `a475f2d`, `08fe02c` and `17639e5`, for BiDi in `aaddc37` and `8bbf81b`, for
Playwright's WebKit build (since replaced, review 23) in `01d2257`, `b56d1d1` and `e3cc3be`, and what was left in
`86fd642`. Probes on Chromium 155 settled what the specs leave open: the adapter folds the protocol into neutral facts
in ids it mints; one adapter contract covers what L1 needs; initialization is a sync, as a resync is, and pausing
follows ownership; realms are keyed by `uniqueId`; outcomes come only from evidence; one conformance suite runs on
every backend. Now in PROTOCOL.md's Backend adapters and Pause-on-start granularity, PROBES.md's Results and
CONCEPTS.md §1 and §4; the CDP evidence table and the gate's rules in [decisions.md](decisions.md).

### Review 9

**Who served a response** (`09-served-by.md`), 2026-10-20; text in `1191bb7`, applied in `431b983`. `servedBy`
moved from the request to the response, set from that response's own evidence: `network`, `cache`,
`serviceWorker`, `cacheOrServiceWorker` (Firefox can't tell the two apart) or `route`, and `unknown` for WebKit.
`network.servedBy` says how precise each backend is. Now in CONCEPTS.md §2, API.md's Top data models, PROTOCOL.md's
"Built after review 09", PROBES.md probe 7 and QUIRKS.md Q43–Q44; the alternatives in
[decisions.md](decisions.md).

### Review 10

**A launch names its browser, and nothing is downloaded** (`10-named-browsers.md`), 2026-10-20; text in `5a757a8`,
applied in `9ffa624`. The library never downloads or installs a browser, so Chrome for Testing stopped being the
launch default and there is no default; a launch named an `executablePath` or a channel, which review 11 replaced
the same day. Now in API.md's Modules and backends and PROTOCOL.md's "Built after review 10"; the reasons in
[decisions.md](decisions.md).

### Review 11

**A launch takes an executable path, and a command finds them** (`11-executable-paths.md`), 2026-10-20; text in
`4567c5a`, applied in `36278c1`. Channels went from every backend, since a fixed table of install paths is wrong on
NixOS, Snap, Flatpak and for the open-source Chromium, and Firefox's channels share install paths. A launch takes a
required, absolute `executablePath`; `strider browsers`, the first CLI command, lists what it finds. Now in API.md's
Modules and backends, CLI.md and PROTOCOL.md's "Built after review 11"; the reasons in
[decisions.md](decisions.md).

### Review 12

**L1 against the built adapter contract, for a first slice** (`12-l1-first-slice.md`), 2026-10-20; text in
`16b19d2`, applied in `a93ddec` and `f968ca7` (2026-10-22). CONCEPTS.md was checked against the adapter contract
(the adapter mints ids, no backend confirms suspension, `loading` isn't observed, frames left the precedence). L1
became a per-connection fold of the adapter's facts with one query engine of ours in the utility world, actions
check in the page at each animation frame and dispatch once, a member not built fails as the defect `NotBuilt`, and
the README's program ran on all three backends. Now in CONCEPTS.md §1, §2, §4, §5, §7–§9, API.md and PROTOCOL.md's
"Built after review 12".

### Review 13

**Events, for a second slice** (`13-events-slice.md`), 2026-10-23; text in `fc81a4d`, applied in `660ef9f`. One
subscription mechanism in L1: the fold publishes to a log and a channel per kind and target, which offers each event
to a bounded `Queue` per subscription, registration being the revision boundary. `Popup` is reported when it
appears; a `Dialog` event is data, decided through a handler's `Pending`, the page's latest handler first and the
context's policy as the fallback, reported as an `AutoResolution`. Now in CONCEPTS.md §3, §5 and §9, API.md's State
and events and Dialogs, and PROTOCOL.md's "Built after review 13".

### Review 14

**The other event modules** (`14-event-modules.md`), 2026-10-23; text in `14bfa16`, applied in `ebe4b16`. The nine
remaining event modules on review 13's mechanism: every event attributed to a page and its context, delivery that
can take an effect, `history` checking its filter as `next` does, and a filter the backend can't serve failing with
`Unsupported`. Owned contexts download to a directory of their own; file choosers became data and a `Pending`;
workers became handles that evaluate by value. Now in API.md's State and events and Network, CONCEPTS.md §2, §5, §6
and §9, PROTOCOL.md's "Built after review 14" and QUIRKS.md Q25–Q42.

### Review 15

**`next` returns an Effect** (`15-next-returns-an-effect.md`), 2026-10-23; text in `25db228`, applied in `d1d1b4a`.
`next` hands out the wait as an `Effect`, not a `ReadonlyDeferred`; the package's `Deferred` module and its type
test went, and the upstream proposal was withdrawn and kept. Now in API.md's Conventions and State and events,
CONCEPTS.md §9 and `upstream/effect-readonly-deferred.md`; the reasons in [conventions.md](conventions.md).

### Review 16

**Interacting and asserting** (`16-interaction-and-assertions.md`), 2026-10-23; text in `30adb80`, applied in
`e59eacd`. L1 keeps each page's input state and builds every gesture from it, with modifiers held as keys and each
Chromium page a window of its own; keys are UI Events `key` values from our table; each action's sends and checks
are defined; reads are strict and immediate; an expectation waits in the page, re-checking on mutations, input and
frames. Now in CONCEPTS.md §5, §8 and §9, API.md's Locators, Keyboard and Expectations, PROTOCOL.md's "Built after
review 16" and QUIRKS.md Q69–Q88.

### Review 17

**Declarations** (`17-declarations.md`), 2026-10-23; text in `37af6c9`, applied in `e7821c1` (Q46's hash in
`e418b97`). Routes became handler registrations over paused requests at one phase, page first and latest first,
with the default `continue` published as an `AutoResolution` and decisions typed by phase; `Intercepted.fetch` went.
Init scripts keep one order on every backend; an `emulate` call is one registration whose fields are capabilities;
grants are recomputed on removal; the page clock is a main-world shim of ours. Now in API.md's Pages, Network and
Page time, CONCEPTS.md §6 and §7, PROTOCOL.md's "Built after review 17" and QUIRKS.md Q46, Q89–Q109.

### Review 18

**Evaluation, frames, captures and storage** (`18-evaluation-frames-captures.md`), 2026-10-23; text in `d12627b`,
applied in `7c25851`. Evaluation runs in the caller's isolated world with scoped handles, the main world a member of
its own; a frame is entered through its iframe and resolved by its own document's engine; snapshots are the
engine's accessibility tree with refs, diffs, `toMatchAria`, `nearest` and `suggestions`; captures map onto each
backend; storage state holds cookies, origin storage and IndexedDB, restored before the context's first page. Now in
CONCEPTS.md §7 and §8, API.md, PROTOCOL.md's "Built after review 18" and QUIRKS.md Q110–Q135.

### Review 19

**Attaching and access** (`19-attaching-and-access.md`), 2026-10-24; text in `ceb3cd9`, applied in `1f9c474`.
`Chromium.layerConnect`, `Firefox.layerConnect` and `Bidi.layerConnect`; a BiDi session the connection started ends
with it; pages the connection didn't create are observed, and `inspect` and `control` acquire scoped grants, whose
release fails later use with `AccessReleased` and removes their declarations; `Browser.pages`, the default context
and popups of observed pages. Now in CONCEPTS.md §3, the README's Access, ownership and cleanup, API.md's Modules
and backends, PROTOCOL.md's "Built after review 19" and QUIRKS.md Q136–Q148.

### Review 20

**Tooling** (`20-tooling.md`), 2026-10-24; text in `11a90ea`, applied in three steps, `dd67392`, `a064195` and
`7c28926`. The rest of the API surface (launch profiles as values, diagnostics presets, `FileInput.bytes`, `goto`'s
`accept`, `close`'s `runBeforeUnload`, the span helper), the `AxTree` and `Screencast` capabilities and the test
layers; recordings, as HAR 1.2 with the library's timings and Playwright's trace format; `BrowserToolkit` and the
`strider` CLI, a daemon per session. Now in API.md, the README's Diagnostics and Observability, CLI.md, PROTOCOL.md's
three "Built after review 20" sections and QUIRKS.md Q150–Q176.

### Review 21

**The quirks** (`21-quirks.md`), 2026-10-25; text in `17ef620`, applied in `a7ee8dc`, `38ce8ff`, `fa0a3a9`,
`c790129` and `ab80395`, with QUIRKS.md's markers in `cd03979`, `80a1884`, `fe8c410` and `1b8a6c0`. All 176 quirks
then listed got an outcome: fix, change the API, report, keep or watch. The fixes came in four steps (lifetimes and
flakes; pages that render in the background; Chromium's headers and bodies; the API before a release) and the
upstream drafts in a fifth. Now in QUIRKS.md's markers, PROTOCOL.md's four "Built after review 21" sections,
API.md's LaunchProfile, `focus` and AutoResolution, and `upstream/`.

### Review 22

**Everything deferred** (`22-everything-deferred.md`), 2026-10-26; text in `6d0293e`, the maintainer's answers in
`d0f5d4e`; applied in `a332fd8` (`@usestrider/vitest` split out) and six steps, `6ff530c`, `f223b83`, `64f94a7`,
`d8ee372`, `4b7b77a` and `97a4ee2`. "I want to flesh out the full design instead of deferring": traces with a DOM
capture of our own and Firefox's video; `strider mcp`, `find` and page-provided tools (WebMCP, designed only); CLI
sessions that take over tabs, keep pages, download and filter history, and the ledger; headers as sent, request
bodies, HAR replay, `URLPattern` intercepts and response-phase headers; frame navigations, init scripts in workers,
iframes in the accessibility tree, keyboard layouts, synthetic drag and handle groups; attaching to stock WebKit;
and the open quirks' checks. Now in PROTOCOL.md's six "Built after review 22" sections, API.md, CONCEPTS.md §3,
CLI.md and QUIRKS.md; the reasons in [decisions.md](decisions.md).

### Review 23

**WebKit without Playwright's build** (`23-webkit-without-playwright.md`), 2026-10-26; text in `61efa6e`, the
maintainer's answers in `1e8490d`; applied in four steps, `251796e`, `1548837`, `508e013` and `9c8280c`. Playwright's
patched WebKit went: stock WebKitGTK's MiniBrowser is launched in automation mode and driven through WebKit's
Automation protocol, with our own GVariant codec and inspector-socket client, and the inspector for the rest; each
context is a browser process, and a dialog is `Dialog.Unknown`; the comparison scripts run on stock Chrome only. Now
in PROTOCOL.md's Transports, Code generation, four "Built after review 23" sections, Backends and order and
Capability snapshot, API.md's Launching, CLI.md and QUIRKS.md Q204–Q234; the reasons and probe facts in
[decisions.md](decisions.md).

### Review 24

**Storage partitions by origin** (`24-storage-partitions-by-origin.md`), 2026-10-26; text in `8ea3b9a`, applied in
`8431901`. A storage state records, for a partitioned origin, the origin of the top-level document it was read
under, an optional `topLevelOrigin`, and restore writes it from a page at that origin, so stock WebKit, which keys
partitions by origin with its port, finds it. Now in PROTOCOL.md's "Built after review 24", CONCEPTS.md's Storage
and QUIRKS.md Q232; the alternatives in [decisions.md](decisions.md).
