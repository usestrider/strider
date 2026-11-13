# Performance against Playwright

`pnpm bench` compares Strider's public API with the pinned `playwright-core` on the same headless Chromium
executable. It uses only local fixtures and needs no recordings. Run it on an otherwise idle Linux machine;
the command enters the same Nix environment as the integration tests.

```sh
pnpm bench                                      # 20 measured pairs after 3 warmup pairs per case
pnpm bench --check                              # fail if any Strider median is > 1.10 × Playwright
pnpm bench --check --max-ratio 1                 # require parity or better for every selected case
pnpm bench --only lifecycle                      # launch, first page, shutdown and persistent lifecycle cases
pnpm bench --only click --runs 50 --check         # investigate one operation
pnpm bench --runs 2 --warmup 1                    # smoke check, not a performance gate
pnpm bench --output .data/benchmarks/before.json  # preserve a report before changing code
pnpm bench --help
```

The ratio is Strider's median divided by Playwright's: below 1 means Strider is faster. The default target
allows 10% overhead, a configurable working definition of “similar.” It is a target, not a claim that the
current implementation meets it. `--check` exits with code 1 if **any** selected case exceeds it; no aggregate
score can hide a slow operation. A failed operation or wrong result always exits with code 1, even without
`--check`. Gating requires at least 20 measured pairs and 3 warmup pairs.

## Cases and timing boundaries

The `launch-first-page` case records launch availability, first isolated page acquisition, and their combined
wall time from the same browser in `lifecyclePhases`. Entries are in measured pair order for each library;
warmups are checked and discarded. Page evaluation, viewport/DPR checks, observed default/total page counts,
process argument capture and cleanup are outside timing. The ordinary Strider launch is checked for one
default page; explicitly passing `--strider-arg=--no-startup-window` requires zero. Playwright creates one
isolated context and page, with the same viewport and DPR. The combined case does not wait for Strider's
unrelated startup-page gate or add its cost to the first-page phase.

| Case                     | Timed work                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `launch-first-page`      | Fresh launch and first isolated configured page, retaining both phases and their combined time from one browser |
| `launch`                 | Start a fresh browser and establish its automation connection; shutdown excluded                                |
| `first-page`             | Acquire the first isolated context/page after each fresh launch; launch and cleanup excluded                    |
| `shutdown`               | Release each library’s freshly launched browser after availability; launch excluded                             |
| `repeated-lifecycle`     | Five sequential isolated context/page acquisitions and releases on a persistent browser; checks excluded        |
| `page-lifecycle`         | Create and close an isolated context and page, including viewport configuration                                 |
| `navigate`               | Navigate to a local document through `load`, then read its title                                                |
| `navigate-title-locator` | Navigate through load, read the title, then resolve and read a heading; both results are verified               |
| `resources`              | Load a local document with 100 uncached images through `load`, then count loaded images                         |
| `evaluate`               | 20 sequential main-world evaluations returning small objects; time per batch                                    |
| `locator-read`           | 20 sequential role locator text reads; time per batch                                                           |
| `locator-values`         | 20 sequential input value reads across distinct elements; time per batch                                        |
| `read-snapshot-100`      | One synchronous main-world query returning 100 inputs × four properties                                         |
| `read-snapshot-1000`     | The same query returning 1,000 inputs × four properties                                                         |
| `click`                  | Click with default actionability, then read the updated counter                                                 |
| `fill`                   | Fill a labeled input with default actionability, then read its value                                            |
| `visible`                | Wait for an already visible heading                                                                             |
| `screenshot`             | Capture the viewport as PNG                                                                                     |
| `screenshot-repeated`    | Five sequential viewport PNG captures on one page; time per batch                                               |
| `screenshot-dense`       | Capture a seeded dense 1280 × 2880 canvas full page; setup excluded                                             |
| `screenshot-large`       | Capture a 1280 × 2880 full page; fixture setup excluded                                                         |
| `screenshot-element`     | Capture a visible 320 × 180 element; fixture setup excluded                                                     |

For operation cases, each sample gets a fresh context and page loaded with the same fixture. Page creation,
initial navigation and cleanup are outside timing. Results are checked after the timer stops, including
each evaluation/read in a batch, image load counts, and screenshot format and dimensions. Warmups are checked
too. Cases stop on the first failure; the report marks an incomplete run as an error.

The query/read controls retain `evaluate` (small objects) and `locator-read` (one repeated role query).
`locator-values` reads distinct inputs independently and sequentially: each operation can observe a later moment.
It compares Strider `readValue` with Playwright `inputValue`, including each library's normal locator resolution.
The snapshot cases instead use Strider `evaluateInMainWorld` and Playwright `page.evaluate` with the identical
synchronous `querySelectorAll`/mapping function. Playwright's page-side bulk API avoids a per-element host loop;
these snapshots are a different consistency contract from independent reads, not a faster equivalent of them.
Each snapshot returns ordered records containing id, current value, disabled state and nullable aria-label.
The two fixture sizes grow both document and result size, so their difference alone cannot separate query cost
from serialization/decoding cost. All records are checked, including Unicode strings, booleans and nulls.
Fixture navigation and parsing are outside timing; query execution, property access, transport,
serialization and host decoding are inside it. Deferred browser rendering can still overlap the measured operation. These static success workloads do not establish exception,
mutation/replacement freshness, navigation, cancellation or deadline correctness. Use the integration contents,
locator and adapter suites for those boundaries before changing shared read machinery; do not infer them from
passing timing samples. No browser work is shared across independent reads by the harness.

The runner awaits one sample at a time and alternates which library goes first in each pair. Both use a
1280 × 720 viewport at device scale 1, the same server, and the same browser binary, whose reported version is
checked against the integration pin. Persistent browsers are used except for `launch`, `first-page` and `shutdown`. Every launch
gets a fresh profile; warmup reduces library and OS cache effects, so this is not a cold-machine startup test.
`first-page` checks that the acquired page evaluates `document.URL` as `about:blank`. It includes context
creation and the same viewport configuration as `page-lifecycle`. Both `first-page` and `shutdown` start
immediately after Browser availability. Strider has an initial observed `about:blank` page whose setup gate
can still be running; Playwright's nonpersistent launch has no initial targets or owned contexts. First-page
acquisition can overlap Strider's initial-page setup, and shutdown can interrupt it. The shutdown case creates
no additional context or page. Strider disposes its scope, signals the process and removes its temporary profile;
Playwright uses its supported `browser.close()` path. Shutdown costs and first-page comparisons describe these
supported defaults with different initial resources, readiness and release paths, rather than equal work.
`repeated-lifecycle` reports the sum of acquisition and release times for five sequential isolated context/page
cycles, not a per-cycle average. Between timers, it checks `about:blank`, one additional live page and return
to the initial page count after every release. Strider also awaits each context's acknowledged terminal state;
Playwright checks context/page counts return to their initial values. Strider's public browser has no context
registry, so this checks page counts and context termination rather than an independent wire-level context census.
Checks, including the page evaluation, are excluded; their browser work can affect subsequent cycles. These
checks establish ordinary successful release, not interruption or partial-initialization correctness. No case
here characterizes simultaneous scale, page reuse within one context, remote attach, or memory/OS resource leaks.

Module imports are outside timing. Both libraries retain their default launch flags, instrumentation and
actionability behavior: the comparison measures the cost of each library's supported public behavior.

The JSON report retains all measured samples, median, nearest-rank p95, minimum, per-case ratio, target outcome,
configuration, browser/library/Node versions, machine details, and a SHA-256 of the browser and scenario sources
plus lockfile. The hash includes uncommitted source edits. A Markdown summary is written beside it. Reports
default to `.data/benchmarks/latest.{json,md}` (gitignored); use `--output` to preserve multiple runs. An interrupted
report may still say `running`; only a completed report can establish a result.

## Launch diagnostics

Use the diagnostic loader and runner to timestamp fresh launch through browser availability without changing
launch flags or resource ownership. Run it in the pinned integration environment without overlapping
other browser runs, suites, checks or builds:

```sh
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/launch-profile-hooks.mjs \
  packages/scenarios/benchmark/launch-profile.ts /absolute/path/launch-profile.json 20
```

The numeric argument selects measured pairs after three warmup pairs. Append `persistent` to compare with
Playwright’s persistent launch with its initial page and native viewport; this is a distinct resource/readiness
contract, not an equivalent replacement for the nonpersistent launch benchmark. The JSON retains phase marks, protocol
traffic, actual process arguments, initial resource counts and source/instrumentation hashes. Samples alternate
library order. Events after `launch.available` are verification, observation of the initial target gate finishing, and cleanup,
outside launch timing. Browser availability can precede completion of that gate; the diagnostic wait sends no
extra protocol command. Loader
transforms assert their source sites and add timestamps; they do not change command arguments or ordering.
The loader depends on the pinned Playwright bundle and must be updated if those source sites change.
The runner rejects incomplete samples: required phase marks and protocol send/reply pairs must be present
before their readiness boundary. Missing instrumentation, missing replies or a failed initial-target gate
make the report an error; retained partial samples are evidence of failure, not timing results. Accept only
`status: "completed"` reports with all requested pairs, excluding the three warmup pairs from statistics.
Spawn marks end when the process handle returns; they do not isolate shell execution or browser startup,
which can continue during the first-reply wait.
These instrumented samples are for attribution, not speed claims; use `pnpm bench` for uninstrumented comparisons.
Protocol waits may overlap, so their individual durations cannot be summed as elapsed launch time. Exclude runs
that overlap other browser runs, suites, checks or builds.

The diagnostic's instrumentation-rejection regressions launch real browsers; run them without overlapping
other browser runs. The ordinary unit suite discovers
`LaunchProfile.test.ts` but skips these cases outside the integration environment; the integration configuration
does not discover this file. Run it explicitly with the ordinary configuration inside the pinned environment:

```sh
nix develop .#integration --ignore-environment --keep TERM --command \
  pnpm exec vitest --run --config vitest.config.ts packages/scenarios/test/LaunchProfile.test.ts
```

## Interpreting a result

These are wall-time latency measurements. They do not measure CPU usage, memory, throughput under concurrency,
or other browsers. The p95 describes the sample distribution and is not gated. Twenty observations are a starting
point, not a statistical significance claim. Repeat borderline results on an idle machine with more runs before
attributing a difference to code. Nix pins software and browser settings, not CPU frequency or host contention.

The **Benchmarks** GitHub Actions workflow runs on demand and preserves reports and logs, including on failure.
Its `check` input enables the same per-case gate; it defaults to reporting while targets are being established
on hosted runners. It does not add a required pull request check. Existing `pnpm scenarios` remains the broader
end-to-end comparison with storage, routing, popups and recorded public sites.

Add operation cases in `src/benchmarks/cases.ts`: give both libraries equivalent work, describe exactly what is
timed, and verify a concrete expected result. Add any local fixture to `src/site.ts`. Keep Playwright inside this
private package. Harness tests run with `pnpm test --run packages/scenarios/test/Benchmarks.test.ts` and in the
ordinary unit suite; type checks include the benchmark sources.

## Investigating an area

Group the work by shared mechanism: resource lifecycle, queries and reads, actions, observation and waiting, network
and bulk data, and shared execution machinery. Current coverage, measurements, open questions and outcomes belong in
issues, so reuse an existing investigation rather than filing another issue for the same cost.

Work through one bounded investigation at a time:

1. **Check coverage.** Choose a normal workload, a repeated or larger workload, and a materially different path
   where relevant. State the results and guarantees both libraries must provide, the timing boundaries, and what
   is excluded. Extend the existing suites when they do not cover the selected mechanism. A representative case
   can cover several methods that use the same machinery; an area does not need every combination of options.
2. **Establish the baseline.** Use `pnpm bench` to isolate operation costs and the
   [saved workflow runner](upstream/README.md#timing) to preserve comparable generations. Existing `pnpm scenarios`
   workloads remain useful for broader behavior. Keep source and environment metadata, raw samples, failures,
   median and tail timings. Record the chosen target: the operation gate's default 1.10 tolerance does not by
   itself establish exact parity. Host contention and timing variability limit the conclusions.
3. **Attribute the cost.** Profile browser rendering and execution, protocol dependencies, page-side queries,
   serialization and host orchestration. Identify the critical path; overlapping command durations cannot simply
   be added together. Use instrumented runs for diagnosis and uninstrumented runs for speed comparisons. Add CPU,
   memory, transfer size, concurrency or remote latency measurements when the hypothesis requires them.
4. **Compare designs.** Examine Strider's implementation, the pinned Playwright implementation and plausible
   alternatives. Distinguish browser requirements, implementation choices and costs imposed by a public contract.
   Compare sensible implementations on both sides, including existing bulk APIs. A claim that compatibility
   prevents Playwright from adopting an approach needs evidence of the limiting contract. Sound techniques may
   be shared; an alternative earns its place through demonstrated benefit and maintainability.
5. **Test one hypothesis.** Record the expected benefit, preserved guarantees, regression cases and stopping
   condition before the experiment. Prototype, test the changed boundaries, and compare paired before/after runs
   on identical workloads. Do not weaken checks or add a benchmark-only fast path. Confirm borderline results
   under suitable conditions; keep a failed sample visible rather than using its duration as a successful timing.
6. **Apply the decision rule below.** Implement and validate an internal improvement, or prepare a concrete public
   contract proposal for human review. A case already at parity can still justify an experiment when the profile
   identifies substantial avoidable work; lack of a supported opportunity is also a valid result.
7. **Record the outcome and move on.** Use the issue record below, including rejected hypotheses. Distinguish a
   validated improvement, no change justified, a deferred investigation with linked work, and a proposal awaiting
   API review. Name the coverage actually established. Run the checks required by `AGENTS.md`, including affected
   backend conformance and type tests. An unexplained failure remains unresolved even if isolated reruns pass.

Use the repository's Effect conventions and existing shared mechanisms throughout. Internal refactoring should
serve the measured problem. If an experiment settles an architectural decision, update the relevant layer document
and `docs/decisions.md` with its reasons and rejected alternatives. Findings and unfinished work stay in issues.
Artificial CPU-load reproduction requires prior maintainer approval, as `AGENTS.md` specifies.

### Internal changes and public API review

An improvement that preserves the public contract may proceed through implementation, regression testing and
benchmarking without another permission request within the authorized investigation. Preserve the result,
ordering, error and requirement channels, defaults, freshness, deadlines, cancellation, cleanup and ownership
guarantees. Generated protocol definitions are changed only through their source and code generation workflow.

A proposal that changes the public surface or any of those caller-visible guarantees needs maintainer discussion
before applying it to the public surface, even if its TypeScript signatures stay the same. First prepare the
proposed types and signatures, realistic before/after user examples, experimental performance evidence,
compatibility and ergonomic tradeoffs, and alternatives that preserve the existing contract. The maintainer
reviews that concrete proposal. Independent internal investigations can continue while the proposal waits.

### Investigation record

Keep this record in the area's issue or an experiment comment, updating the map when the area's status
changes. Do not create a separate Markdown backlog of findings.

- **Scope and phase:** selected mechanism, representative workflows, current stage and explicit exclusions.
- **Coverage:** existing cases, cases added, expected results, equivalent guarantees and timing boundaries.
- **Baseline:** commands, run names or artifact locations, revision/source hash, pins, configuration, raw samples,
  median/tails, target and environmental limitations.
- **Attribution:** measured critical-path cost, supporting trace/profile, confidence and unresolved causes.
- **Alternatives:** current Strider, pinned Playwright and other plausible designs, with evidence and tradeoffs.
- **Hypothesis:** one proposed change, expected benefit, invariants, regression cases and stopping condition.
- **API impact:** internal only with preserved guarantees, or a linked concrete proposal awaiting human review.
- **Outcome:** implementation and reason, before/after measurements and controls, checks run and failed or unrun
  checks, rejected hypotheses, retained artifact locations, linked follow-ups and the next ready investigation.

Saved runs under `.data/` are local and ignored by Git. Preserve review evidence outside disposable worktrees with
the workflow runner's `--output`, or copy complete named run directories. Keep a readable result and environment
summary on the issue; a Git revision or source hash alone does not preserve uncommitted experimental code.

## Observation workloads

`visible` remains the immediate visibility control. `visible-delayed` and `visible-many` arm the same
100 ms page timer, which appends one visible `#ready`, then await respectively one and twenty independent
visibility waits. Both libraries must complete every wait; the reported time is per batch. Timing includes
arming the timer and the intentional delay, protocol traffic and delivery of every result. Page/context
creation, initial navigation, result verification and page cleanup remain excluded. The timer is not a
subscription-readiness barrier: these public locator waits have no ready acknowledgment, so a sufficiently
slow host may start some checks after insertion. These cases characterize ordinary delayed conditions,
not transient-event capture or a proven count of simultaneously installed page observers.

`console-many` registers twenty one-shot subscriptions before evaluating one `console.log`, then checks
that all twenty return the exact text `observation-ready`. Strider awaits each `ConsoleMessage.next`
registration; Playwright's `waitForEvent` installs its listener synchronously before returning its promise.
The event can arrive before the returned waits are awaited. Timing includes registration, evaluation,
event delivery, consuming all results and subscription release (the Strider scope closes before return;
Playwright removes its one-shot listeners on resolution). No console history replay is used. Fresh pages
isolate samples. This is fan-out of one event, not twenty events, sustained throughput or callback latency.

Correctness boundaries are exercised separately in the shared browser slice tests:
`starts fresh observations after timeout, interruption and document replacement` checks a missing visibility
condition fails as `ExpectationFailed` at its deadline, an interrupted waiter can be joined, a replaced DOM
node is read afresh, and twenty new assertions read the new document after navigation. It does not assert
that a locator wait spanning navigation succeeds. `keeps ready console subscriptions across document
replacement and releases their scope` checks an event wait expires as `Deadline.Timeout`, interruption is
joinable, and twenty subscriptions acquired before navigation capture a console event in the replacement
document's inline script. The event deadline is set at registration, rather than on the returned wait.
Interrupting a consumer does not end the scope-owned subscription; closing its scope interrupts the
still-pending returned wait. A new subscription still works after the earlier scope is closed. Scope ownership
is Strider's cancellation boundary; Playwright promises have no equivalent general interruption primitive.
The comparative timing cases exercise successful completion only. These checks establish observable
outcomes and continued usability; they do not count retained observers/listeners or prove absence of residual
browser work after cancellation. Reconnect semantics, pending locator navigation, target closure, nested
frames, very short transients and renderer CPU/wakeups remain outside these measurements.

### Large-page visibility controls

Use the existing scenario entry point for Q82's 3,000-span fixture without demo recordings:

```sh
clutch lock browser -- pnpm scenarios --q82 --output /absolute/path/control.json
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/observation-profile-hooks.mjs \
  packages/scenarios/benchmark/observation-profile.ts /absolute/path/profile.json heavy
```

`heavy-control` (the default `--mode`) keeps ten measured pairs after one warmup for static and animated
pages, with zero, one and twenty independent waits for the same missing `#ready` element. The page inserts
it after a host-armed three-second timer. Animation changes 200 of the 3,000 spans per frame, as in the original
fixture. Library order and waiter-count order reverse each repetition; static precedes animated. `heavy`
keeps three instrumented repetitions; `heavy-smoke` keeps one. Use instrumented runs for attribution only.
Every batch must complete, the inserted text must be `Ready`, and the grid must retain 3,000 children.

Raw JSON retains per-renderer PID, arguments and cumulative Linux CPU counters before/after each window,
wall duration, completion count, and the page's insertion/readback timestamps. Sum matched PID deltas and
normalize by wall duration to obtain renderer milliseconds per second. Reject process turnover rather than
silently subtracting unrelated process totals. Counters resolve to 10 ms, approximately 3.3 ms/s over a
three-second sample. Both browsers stay open but only the measured page exists during each window.
Idle windows last 150 ms longer to verify timer completion without a waiting locator. Normalize their CPU
by actual wall duration; idle latency is not wait latency. Wait latency includes scheduling the insertion
and the entire successful batch, excludes setup/verification/cleanup, and is not pure detection latency.
Page readback minus insertion time includes the verification round trip and only bounds detection overhead.
Keep source snapshots, hashes, the lockfile, pins, command logs and machine metadata beside the raw JSON
outside the worktree. The profiler records hashes, runtime versions and host details in each report.

For the distinct, non-layout attribute workload, retain the visibility reports and run two generations:

```sh
clutch lock browser -- pnpm scenarios --q82 --workload attribute --order forward --output /absolute/path/attribute-forward.json
clutch lock browser -- pnpm scenarios --q82 --workload attribute --order reverse --output /absolute/path/attribute-reverse.json
```

Each uses ten measured pairs per cell after warmup. The reverse generation runs animated before static and
reverses each repetition's library/count order. The visibility mode remains the default. Twenty pre-existing
spans get `data-ready="Ready"` in one timer callback; one/twenty Strider attribute expectations use distinct
`#cell-N` locators. Playwright uses `#cell-N[data-ready="Ready"]` with `waitFor({ state: "attached" })`:
this is the same success condition for the fixed unique elements, without layout polling, but is not a
comparison of the libraries' assertion retry implementations. Every measured attribute is read back afterward;
idle verifies the first attribute. Raw samples record workload and order along with the prior CPU/latency fields.
The timer's twenty mutations are identical in idle/one/twenty controls. New IDs leave visibility behavior intact.

Run the bounded correctness probes separately:

```sh
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node \
  packages/scenarios/benchmark/observation-profile.ts /absolute/path/probes.json probes
```

These install diagnostic copies of the actual engine in disposable Chromium pages: current scheduling,
skip a frame after an intervening recheck, and suppress frame checks. A manual frame queue and round-cap
callback make ordering deterministic; real DOM mutation delivery and CSSOM/layout/selector evaluation remain
in Chromium. Cases put property-only checked changes, CSSOM visibility changes, attribute expectations through
checked/role locators, and shadow-root attribute mutations after an unrelated mutation callback but before the
next frame. Repeated probes reset the silent condition before each unrelated mutation, so a persistent change
cannot be rescued by the next mutation callback. Positive light-DOM attribute and unchanged-state controls
separate lost observations from genuinely identical consecutive results. Logs retain callback checkpoints and
recheck results. These probes establish possible interleavings, not their frequency on ordinary pages, native
frame timing, a speedup, or general scheduler correctness. Production scheduling is never patched.

### Bounded observation diagnostics

After preserving an uninstrumented baseline, run the opt-in observation profiler under the browser lock:

```sh
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/observation-profile-hooks.mjs \
  packages/scenarios/benchmark/observation-profile.ts /absolute/path/profile.json
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node \
  packages/scenarios/benchmark/observation-profile.ts /absolute/path/control.json control
```

Append `smoke` after the instrumented output path to check the hooks after an engine change: one measured
pair after one warmup pair at 100 ms for one/twenty waits, plus the two cancellation probes. This mode checks
tooling compatibility only; it does not refresh the performance baseline.

The fixed stopping bound is five alternating library pairs after one warmup pair at each combination of
35/100/160/240 ms insertion delay and one/twenty independent visibility waits. Every wait must succeed and
the resulting text is checked. These smaller diagnostic cells are not a performance gate. The separate control
uses the same workload without the page counters or Playwright loader; the four existing `pnpm bench` cases
remain the current uninstrumented baseline with twenty pairs and three warmups. Cell order is fixed, not
randomized, and separate runs cannot isolate drift from instrumentation overhead.

The instrumented run counts Strider expectation rounds, evaluations, observer creations, active observers,
mutation callbacks and animation callbacks, and measures time inside evaluation with the page clock. It
adds counters to the installed engine in memory, not to the library sources. Snapshots read that isolated
world through additional protocol commands after timing. Callback counts include the final already-scheduled
animation callback even if it does no check. Evaluation time excludes observer allocation, dispatch, host
orchestration and other callback overhead; page-clock resolution and the added clock reads limit precision.
The pinned Playwright loader records protocol traffic and host selector-attempt starts, without changing
retry intervals or command arguments. A host attempt is not a count of every internal page evaluation.
Both protocols retain timestamps and full payloads so overlapping command durations can be examined without
adding them as elapsed time. These are instrumented diagnoses, not speedup measurements or renderer CPU profiles.

Two additional Strider probes start one/twenty missing-condition waits with a one-second deadline. They
poll page counters for at most 250 ms to confirm all observers are active before interrupting the consumer
fiber, then snapshot immediately and after 100/700 ms. They fail if that acknowledgment is absent. The reads
and waiting perturb timing; retained work describes only this bounded page expectation path, and does not
by itself establish a public-contract violation. No browser restart, reconnect, navigation, nested frame or
transient condition is covered. JSON preserves source and pinned-bundle hashes, raw protocol events,
counters, warmup-independent measured cells and failures; preserve the exact tooling source beside the report.

## Capture diagnostics

Screenshot diagnostics use `pnpm profile:screenshot /absolute/path/diagnostic.json` in the same browser lock.
This separate, instrumented Strider run records command intervals, response sizes, extra JSON parsing cost and
replayed Effect/Buffer/adapter-helper base64 decoding cost for 20 samples of each screenshot workload. It does not measure an isolated renderer or network duration:
`Page.captureScreenshot` combines renderer synchronization, capture/encoding and response transfer. Time after
its response includes protocol decoding, base64 decoding and operation completion. Do not use diagnostic times
as uninstrumented performance results. The dense case reconstructs every PNG row and checks every seeded pixel.
Solid large and element cases check dimensions and the first pixel's color. The cross-browser capture integration
tests retain the broader scale, clip, transparency and invalidation checks.

### Screenshot surface experiment

`--screenshot-surface on` or `off` adds an explicit Strider-only Chromium feature switch for
`CDPScreenshotNewSurface`; `default` adds nothing. The off variant retains the automation profile's existing disabled-feature list in the
replacement switch, so other feature defaults stay fixed. Playwright keeps its pinned defaults. This is benchmark
configuration, not a production launch-profile change. `--strider-arg=--enable-features=Other` appends a raw
argument after the experiment switch; it can be repeated to investigate Chromium's own override behavior.

Reports include actual Linux `/proc` browser arguments (including generated profile directories) and renderer
arguments observed after launch, outside operation timing. Schema version 2 also retains each measured sample's
pair index, sequence index including warmups, library, pair order, position, preceding library/position/pair index,
and duration. Preceding positions include warmup samples; tracking restarts for each case. The duration arrays
remain in pair-index order. Alternation couples pair position to preceding-library identity; those fields are
strata, not independent causal variables. Compare distributions and tails within them. Aggregate median ratios
can mix distinct modes and do not establish a stable overhead.

Viewport and repeated captures check three opaque 64 × 64 color markers across the viewport after capture.
Preparation and PNG reconstruction remain outside timing; repeated capture still times five screenshot calls,
with no settling waits or extra commands between them. The dense case retains every-pixel verification.

`--strider-profile automation|concurrent` selects the named Strider preset for a benchmark; automation remains
the default. The selected profile and exact launch arguments are recorded. This does not change production presets
or Playwright defaults.

## Query result attribution

`benchmark/query-profile.ts` is a diagnostic counterpart to the ordinary query cases. Run it inside the pinned
integration shell, supplying an absolute JSON report path. The opt-in Node loader applies checked in-memory
transforms; it does not edit browser sources or installed Playwright files:

```sh
nix develop .#integration --ignore-environment --keep TERM --command node \
  packages/scenarios/benchmark/query-profile.ts /absolute/path/plain.json plain
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/query-profile-loader.mjs \
  packages/scenarios/benchmark/query-profile.ts /absolute/path/instrumented.json instrumented
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/query-profile-loader.mjs \
  packages/scenarios/benchmark/query-profile.ts /absolute/path/trace.json trace
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/query-profile-loader.mjs \
  packages/scenarios/benchmark/query-replay.ts /absolute/path/instrumented.json /absolute/path/replay.json
```

Run these commands and checks separately from other browser runs, suites and builds on the machine.
Treat any overlapping run as contaminated. The profiler uses 20 alternating library pairs and three
warmups (trace mode uses three pairs and one warmup); a fourth argument overrides the measured count for smoke
checks. Modes are exactly `plain`, `instrumented`, `trace`, `boundary`, `boundary-trace`, `evaluation` and
`evaluation-instrumented`; measured counts must be positive safe integers. Invalid arguments are rejected before collection. Instrumented modes require the loader
and all required in-memory transformations; completion also requires the expected sample count and actual stage/
wire captures. Completion checks require both send and receive wire rows and the named host stages in every instrumented sample; these checks do not prove that every diagnostic hook is complete or measure its overhead. Repeat plain/instrumented generations in reverse order to expose instrumentation overhead and drift.
Neither generation is a performance gate or an optimized runtime. Preserve the scripts, source hashes, raw replies,
spans and browser events alongside the reports outside disposable worktrees.

Controls retain the small-evaluation batch and the 100/1,000-record snapshots, then return only 100 records from
1,000 inputs and generate the equivalent 1,000 records without a large DOM. Page timers measure query and property
work; retrieving those timers is outside the operation timer. The profiler's snapshot function adds a slice and
page timers, so compare its plain timings with the canonical uninstrumented cases too. Host hooks bracket parsing,
result validation (or identify its configured skip), CDP-to-remote conversion and final value decoding. Raw command
send/receive timestamps describe dependency intervals, including transport, browser scheduling and browser work;
they are not pure browser duration. Nested/overlapping intervals must not be added. Browser trace mode is separate
because tracing has its own overhead; a clock-sync marker brackets the host/browser clock alignment; a trace that lacks a serializer event cannot establish serialization cost
by subtracting host wall timers.

Offline replay measures captured host work without browser waits. Its direct decoder accepts only the plain-value
trees in these fixtures, verifies equality, and estimates a lower bound for an alternative without an intermediate
tree. It deliberately refuses other kinds. It is not a production decoder: any proposed runtime alternative still
has to preserve all supported values, omissions, depth/error paths, world selection, freshness, deadlines,
cancellation and ownership. Replay savings alone do not establish end-to-end savings.

The same diagnostic runner accepts `boundary` (ordinary wall timings) and `boundary-trace` (separate renderer
verification, with the loader). These modes test setup timing only. They retain the canonical evaluation and
100/1,000-record functions, plus the fixed-100-result/1,000-input control. Every index pairs fresh identical pages
across three variants, rotating variant order and alternating library order:

- `original`: start the operation timer after navigation through `load`.
- `warm`: first complete one main-world no-op evaluation, outside timing, to initialize Playwright's utility and
  exercise either library's evaluation path.
- `prepared`: complete that same no-op evaluation, then capture the viewport as PNG and await its bytes outside
  timing. Successful PNG readback is the setup completion signal; it adds real setup cost and does not promise
  that animation frames, display presentation, or arbitrary future rendering have completed.

The snapshot function, fixture, viewport and full result checks stay identical within each comparison. These are
different measurement boundaries, never library speedups. Compare `warm` with `prepared` to isolate the added
screenshot step, and `original` with each later boundary to study the first-evaluation wait. The original rendering
hypothesis's less-than-5-ms/within-spread stopping rule applies to `original` versus `prepared`; it must not be
reinterpreted as a rule about `warm` versus `prepared`. A small screenshot increment does not refute rendering
when the warm variant has already moved rendering outside the timer. Initialization, caching, scheduling and
rendering may all move into setup, so no contrast alone establishes a millisecond-exact causal split.

A no-op evaluation is not a reliable rendering barrier. Trace observations apply to the traced samples, while
ordinary sample tails must remain visible: report p95, spread and slow-sample counts rather than only medians.
Fresh pages, discarded warmups and rotated paired order reduce reusable-cache and ordering effects; they do not
guarantee that every sample observes the same rendering boundary. Keep the small-evaluation comparison separate:
a repeated deficit after utility initialization is excluded remains unattributed until its own cost is split.
Rejecting decoder fusion or finding no added screenshot benefit does not settle that gap or justify closing an
entire query/read investigation.

The prepared setup invokes each library's supported screenshot defaults, which need not perform identical work.
In particular, pinned Playwright hides the caret by default and restores styles after capture, while Strider has no
equivalent step here. That restoration is a plausible, unconfirmed explanation for later style/paint events on the
input-heavy fixture. Without a controlled test, do not assign those events to caret restoration or generalize them
to PNG readback, screenshots, or Playwright as a whole. Record setup cost and setup-plus-query latency too.

`boundary-trace` collects each browser's renderer events independently, with clock-sync brackets and recorded
setup/timing windows. Both now use the same category list from `query-profile-config.ts`, also recorded in reports.
Historical boundary traces through commit `c66ef71` used `v8`, `devtools.timeline`,
`disabled-by-default-devtools.timeline`, `disabled-by-default-v8.runtime_stats` and `blink.console` for Strider,
but only `devtools.timeline` and `disabled-by-default-devtools.timeline` for Playwright. Keep those artifacts and
measurements unchanged; their different tracing overhead limits cross-library duration comparisons.

Map local document requests to renderer processes, then check setup and operation windows for layout, pre-paint
and paint. Keep traces separate from ordinary wall-time comparisons. Report whether rendering overlapped timing
in those samples, with clock-alignment uncertainty; do not turn a few absent events into a general completion
guarantee. Original/prepared reductions can support pending-rendering overlap without identifying its entire
causal cost. Serialization, scheduling and pre-first-byte IPC remain unallocated by subtraction.

Small-evaluation attribution can use private modes `evaluation` and `evaluation-instrumented`.
They call the canonical twenty-evaluation case on fresh pages at original and one-no-op warmed boundaries,
alternating libraries and rotating boundary order. Existing modes and defaults are unchanged.
The warmed boundary excludes first-call initialization; it is not a rendering barrier.
Wire send/reply intervals include scheduling, transport and browser work and cannot identify serialization time.
Reply-to-next-send intervals include host continuation work, observers and scheduling; their residual is not an Effect cost.
No renderer traces are required for this host/wire partition. Current trace runs share categories but still use
different recording options: only Strider requests `record-as-much-as-possible`. They do not validate
`dataLossOccurred` or reject missing events. Align the recording options and add checks that reject data loss
and missing events before relying on new traces.

In these captures Strider's send observer precedes transport enqueueing; Playwright's checked send
observer precedes its pipe write. Send-to-reply comparisons therefore include different host transport
boundaries, including Strider's outbox/writer scheduling. Receive observers mark complete framed
messages before protocol parsing; Strider UTF-8 decoding/framing precedes that observer. Per-call
observers in evaluation-instrumented mode bracket public invocation through completion and add
their own proxy/finalizer/promise work. Treat their plain/instrumented differences as distortion
estimates with drift, never an exact correction or an attribution to the runtime.

The opt-in loader also observes the pipe write boundary for evaluation attribution. It registers
the launched child's fd 3 in the installed Effect platform spawner and records bytes immediately
before the installed NodeSink calls that stream's `Writable.write`; this is after pulling from the
outbox, not a dequeue marker. A separate marker immediately before queue offer follows UTF-8
encoding. Playwright records its body and terminating-NUL write calls after argument serialization.
These are Node write invocations, not kernel completion or browser receipt signals; Node buffering
and backpressure remain inside the subsequent wait.

Write hooks retain byte references or immutable strings and timestamps only. After collection,
reassemble NUL-delimited frames (including fragmented UTF-8, split delimiters and batched commands),
match command/session IDs and payloads, and require send/enqueue/write/reply ordering before an
instrumented evaluation report can complete. Byte encoding for the report happens outside timing.
Compare both first-write and frame-completing-write boundaries when framing spans multiple writes.
Retain plain/instrumented controls: the extra observers can distort both queue and subsequent wait
intervals. Measured enqueue-to-write time is not promised savings from removing a queue.

## Response-body transfer

`pnpm bench --only network` selects navigate, resources and both transfer cases.
Reports retain mean and sample standard deviation, plus signed Strider-minus-Playwright differences for
each measured pair and their median/mean/SD/range/p95; these describe spread, not a significance test.

`response-body-small` and `response-body-large` fetch 4 KiB and 4 MiB of deterministic binary data from
`/benchmark/body`. Every byte is checked after timing, including warmups. The server precomputes bodies,
sends `application/octet-stream` with `Cache-Control: no-store`, and does not compress. Each sample has a
fresh context/page and no user route or service worker. Strider's default interception remains enabled;
Playwright's default network observation remains enabled. Neither installs an artificial matching route.

Timing starts before response subscription registration. Strider awaits body-collection acknowledgement
before starting the fetch; Playwright installs `waitForResponse` before starting it. Timing includes registration,
fetch dispatch, server/network completion, protocol body retrieval, decoding and delivery of bytes to the caller.
The page also consumes the fetch body on both sides. Initial navigation, byte verification and context cleanup
are excluded. Strider closes the collection scope before returning. These are end-to-end collection cases,
not isolated decoder measurements or streaming/throughput/memory tests. The 4 MiB case stays below Strider's
default 10 MiB collection limit; Playwright has no equivalent collection-limit contract here.

For separate critical-path diagnostics (never a speed comparison), use the exact-site loader without overlapping
other browser runs:

```sh
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/body-profile-hooks.mjs \
  packages/scenarios/src/benchmarks/bin.ts --only response-body-large --runs 20 --warmup 3 \
  --output /absolute/path/body-diagnostic.json
```

The adjacent `.phases.json` records sample boundaries, collection acknowledgement, adapter/body-reply,
decode and public decoder phases plus body character counts and source/loader hashes. It timestamps
Playwright's body command/reply too. The protocol interval includes scheduling, transport, browser work and
reply parsing; it does not isolate wire latency. Instrumentation and distinct public result paths can bias both
libraries differently. Warmups remain in phase logs; discard the first three samples of each library when
summarizing. Pair order follows the uninstrumented runner. Phase durations partition one sample only where
boundaries are nested; never add overlapping waits or interpret a host interval as removable savings.

## Route-free Fetch diagnostic

The opt-in `benchmark/fetch-cost-hooks.mjs` loader splits the Chromium Fetch cost on the resources case.
It changes loaded code only and is not a supported configuration or production activation proposal.
Run in the pinned integration environment without overlapping browser runs, checks or builds:

```sh
nix develop .#integration --ignore-environment --keep TERM --command node \
  --import ./packages/scenarios/benchmark/fetch-cost-hooks.mjs packages/scenarios/src/benchmarks/bin.ts \
  --only resources --runs 20 --warmup 3 --output /absolute/path/resources.json
```

Each measured group contains six Strider arms, each paired with a fresh pinned Playwright default control:

- `disabled`: Fetch disabled, including default document-auth handling.
- `document-auth`: explicit wildcard Document Request pattern with auth handling enabled.
- `current`: unchanged current configuration. On owned route-free contexts this is identical to `document-auth`.
- `route`: a real public route matching the fixture origin and continuing requests; current auth handling remains.
- `document-no-auth`: the same Document pattern with auth handling disabled.
- `unmatched`: only the nonempty unmatched Request pattern, with auth handling disabled.

The six arm/control blocks rotate each group, with the entire sequence reversed on alternate groups. All arms use
fresh pages, existing uncached fixtures and the same timing boundary and exact loaded-image count check (`100`).
The real route must also receive at least the document plus all 100 images. Setup, route acquisition, result/hit
checks and cleanup are outside timing. At least three warmup groups and twenty measured groups are required.
The adjacent `.arms.json` records all observations, exact verified results, route hits, order, loader hash and
original transformed-source hashes. The ordinary report contains only `current` and its adjacent Playwright
control; require final `passed` or `over-limit` status and complete arm counts before analyzing the split.

Capture actual wire configurations separately, never as timing evidence. Set `STRIDER_FETCH_CONFIG_WIRE` to an
absolute NDJSON path in a separate run (one group, zero warmups is sufficient with this variable). Only that run
loads command observers for both libraries; its `.arms.json` is marked `wire-diagnostic`. The log records encoded
Fetch enable/disable and cache-disable commands, including setup and cleanup, with the active arm label. Verify
that `current` and `document-auth` really are identical before interpreting their identity control. Non-current
configurations deliberately change authentication or add routing work; none is an approved implementation.

Report each arm's median/spread/p95, paired differences and adjacent-control drift. Compare Document/no-auth and
unmatched controls before assigning cost to auth configuration rather than generic proxy work. A finite sample
does not validate route activation, factory acknowledgement, authentication, or release safety. Opting out of
default challenge handling alone still leaves the unmatched interceptor installed in production today.

## Paired CI comparisons

Run performance comparisons on CI. The shared desktop is in constant use and cannot supply reliable timings.
Dispatch the workflow from a branch containing the comparison driver:

```sh
gh workflow run benchmarks.yml --ref <driver-branch> -f base=main -f head=<change-branch> -f workload=bench -f only=click -f browser=chromium -f runs=20
gh run watch <run-id>
```

For a scenario use `-f workload=scenarios -f only=login`. Scenarios requiring demo HAR recordings fail clearly
when recordings are absent; this workflow never records from live sites or silently replaces recordings.
Currently only pinned stock Chromium is supported. Different `flake.lock`, `flake.nix` or browser version pins
in the driver, base or head are rejected so the browser and system environment remain common. Before workers start, the driver records its executable path, SHA-256 and
version output and checks the version against its pins. Dependencies and builds are separate for each ref.
The dispatched branch supplies the measurement driver, overlaid onto both checkouts, so a base predating this driver works.
Both refs use the dispatched driver’s workload definitions (`cases.ts` / `scenarios.ts` and supporting runner files),
including when head names a different branch. Changes to head’s own workloads are therefore not measured; dispatch
from the branch containing the workload definitions to measure. The libraries and their dependency lockfiles come
from the respective refs; driver files are saved separately.

The scheduler uses a four-round Williams square for base Strider, head Strider, head Playwright and base Playwright.
Each role occupies each position once and follows every other role once within rounds. Measured run counts must
be multiples of four from 4 through 1000. This balances immediate carryover within rounds; transitions across round
boundaries, warmup boundaries, longer history and persistent browser state are not balanced or eliminated.
It grants one individual sample at a time, including benchmark warmups. Scenario initial correctness checks and
browser setup precede each case's readiness barrier; operation setup, assertions and cleanup retain their existing
boundaries. Browser processes for both refs stay resident while waiting, which differs from standalone runs.
The extra base Playwright samples retain a control for dependency changes.

Artifacts contain incremental raw samples (including warmups), worker logs, original driver/base/head lockfiles
and browser pins, resolved commits, driver sources, browser binary SHA-256, machine metadata and each worker's original report.
The summary reports geometric means of paired head/base and head/Playwright ratios with two-sided 95% Student t
intervals on log ratios (conservative degrees-of-freedom table). These describe uncertainty across repetitions,
not systematic machine bias; cases have separate intervals with no multiple-comparison correction. Ratios below
one favor head. A failed or incomplete run retains evidence and publishes no valid comparison in its summary;
partial per-case estimates in JSON must not be used as a successful comparison. Failed scenario attempts are
retained in `<base|head>/run/attempts.jsonl` and the worker log. They are not successful timing samples and are
absent from the parent’s `samples.ndjson`. Setup errors also write a failed JSON report and summary.

### Hosted repeatability, 2026-11-09

Three serial `ubuntu-24.04` jobs compared the same main commit
`8a1ae263b06042204a515a244bc1b416aec1a601` against itself, using driver
`24290b90cb4ff2b7a7913f6c2337ca98254b6468`, Chromium 155.0.8059.79, all 26 bench cases and 20 measured
rounds after three warmup rounds. The jobs were:

- [Job 1](https://github.com/usestrider/strider/actions/runs/42546368886): AMD EPYC 7763, 17m51s.
- [Job 2](https://github.com/usestrider/strider/actions/runs/42547963037): AMD EPYC 7763, 17m14s.
- [Job 3](https://github.com/usestrider/strider/actions/runs/42549611823): Intel Xeon Platinum 8370C, 16m46s.

Each completed successfully with matching driver/base/head environment pins and resolved commits, 2,080 measured
samples and 312 warmup samples. All 7,176 raw samples were downloaded and their paired intervals independently
recomputed. Each job retained raw samples, lockfiles, source hashes, worker reports and full workflow logs in its
artifact. The recorded browser executable SHA-256 was identical across the three jobs:
`c821d8cccbf653b255a6950911846cc17b9b1eae7bb143e49143cd5e0d693653`.

The [local-fixture scenario smoke](https://github.com/usestrider/strider/actions/runs/42546185441) also passed:
base was the same main commit, head and driver were `24290b90`, and launch/login each completed four rounds.
The [bench smoke](https://github.com/usestrider/strider/actions/runs/42545323538) passed earlier on the unchanged
bench path. Neither smoke contributes to the repeatability figures. The earlier
[failed scenario run](https://github.com/usestrider/strider/actions/runs/42545552573) exposed a missing working
directory, retained incomplete evidence and is excluded; that setup defect was fixed before the successful smoke.
None of the three repeatability jobs is incomplete.

Head/base estimates reached a **14.9% absolute deviation from 1 on identical source**. `read-snapshot-100`
ranged from 0.851 to 1.137, a spread of 0.287 (28.7 percentage points); `click` ranged from 0.899 to 1.079.
By contrast, `screenshot-dense` ranged from 0.998 to 1.004. Of 78 head/base intervals, two excluded 1:
job 1’s `locator-read` and job 3’s `launch-first-page`. These intervals are per case without a multiple-testing
correction; exclusion of 1 alone is not sufficient evidence of a change.

This hosted setup does not establish reliable detection of a 10% change across every case. Keep the performance
gate disabled. Use the workflow for exploratory comparisons, repeat same-source controls for the affected cases,
and inspect both intervals and across-job spread before interpreting a change. If a repeatable 10% gate or
smaller-change measurements are required, evaluate a dedicated self-hosted runner on separate hardware rather
than the shared desktop. These three jobs do not establish a universal noise bound: CPU models differ, host load
is uncontrolled, rounds may be correlated, carryover across round boundaries remains, and the measurement covers
only one source revision and Chromium on Linux. More repetitions alone do not remove systematic bias.

The tables show each paired geometric mean ratio with its 95% interval. Estimate ranges are the minimum and
maximum of the three job estimates; maximum deviation is `100 × max(abs(ratio − 1))`, computed before rounding.
They are observed ranges, not confidence or prediction intervals for future jobs.

| Case                |      Job 1 head/base |      Job 2 head/base |      Job 3 head/base | Estimate range | Max deviation from 1 |
| ------------------- | -------------------: | -------------------: | -------------------: | -------------: | -------------------: |
| launch-first-page   | 0.983 [0.953, 1.014] | 0.996 [0.976, 1.017] | 0.960 [0.928, 0.993] |    0.960–0.996 |                 4.0% |
| launch              | 1.016 [0.993, 1.040] | 1.008 [0.982, 1.034] | 0.982 [0.952, 1.013] |    0.982–1.016 |                 1.8% |
| first-page          | 0.989 [0.945, 1.035] | 1.030 [0.985, 1.077] | 1.032 [0.994, 1.073] |    0.989–1.032 |                 3.2% |
| shutdown            | 0.974 [0.897, 1.059] | 1.029 [0.931, 1.136] | 0.946 [0.822, 1.087] |    0.946–1.029 |                 5.4% |
| page-lifecycle      | 0.998 [0.955, 1.042] | 1.035 [0.990, 1.081] | 1.043 [0.986, 1.104] |    0.998–1.043 |                 4.3% |
| repeated-lifecycle  | 1.012 [0.989, 1.037] | 1.002 [0.986, 1.019] | 1.002 [0.978, 1.028] |    1.002–1.012 |                 1.2% |
| response-body-small | 0.984 [0.867, 1.117] | 0.995 [0.885, 1.118] | 1.062 [0.950, 1.186] |    0.984–1.062 |                 6.2% |
| response-body-large | 0.990 [0.920, 1.067] | 1.043 [0.972, 1.119] | 1.026 [0.919, 1.146] |    0.990–1.043 |                 4.3% |
| navigate            | 0.944 [0.864, 1.031] | 0.998 [0.952, 1.047] | 0.973 [0.921, 1.028] |    0.944–0.998 |                 5.6% |
| resources           | 1.022 [0.990, 1.055] | 0.989 [0.946, 1.033] | 0.989 [0.945, 1.036] |    0.989–1.022 |                 2.2% |
| evaluate            | 1.051 [0.971, 1.137] | 1.025 [0.938, 1.120] | 1.113 [0.953, 1.300] |    1.025–1.113 |                11.3% |
| locator-read        | 0.926 [0.862, 0.994] | 1.050 [0.982, 1.122] | 0.970 [0.888, 1.060] |    0.926–1.050 |                 7.4% |
| locator-values      | 0.994 [0.919, 1.075] | 1.073 [0.986, 1.167] | 1.071 [0.980, 1.171] |    0.994–1.073 |                 7.3% |
| read-snapshot-100   | 1.137 [0.963, 1.343] | 0.851 [0.678, 1.067] | 0.948 [0.801, 1.123] |    0.851–1.137 |                14.9% |
| read-snapshot-1000  | 0.941 [0.814, 1.089] | 1.021 [0.902, 1.157] | 0.974 [0.863, 1.098] |    0.941–1.021 |                 5.9% |
| click               | 0.899 [0.790, 1.023] | 1.079 [0.942, 1.236] | 0.927 [0.786, 1.092] |    0.899–1.079 |                10.1% |
| fill                | 0.952 [0.829, 1.093] | 0.931 [0.841, 1.030] | 0.929 [0.831, 1.039] |    0.929–0.952 |                 7.1% |
| visible             | 1.026 [0.937, 1.125] | 1.034 [0.963, 1.110] | 1.053 [0.919, 1.208] |    1.026–1.053 |                 5.3% |
| visible-delayed     | 0.999 [0.976, 1.022] | 0.993 [0.977, 1.009] | 1.008 [0.994, 1.021] |    0.993–1.008 |                 0.8% |
| visible-many        | 0.992 [0.971, 1.013] | 0.992 [0.978, 1.006] | 0.976 [0.951, 1.002] |    0.976–0.992 |                 2.4% |
| console-many        | 1.061 [0.926, 1.216] | 0.954 [0.804, 1.134] | 1.029 [0.808, 1.310] |    0.954–1.061 |                 6.1% |
| screenshot          | 1.026 [0.897, 1.173] | 1.065 [0.979, 1.158] | 0.955 [0.849, 1.075] |    0.955–1.065 |                 6.5% |
| screenshot-dense    | 0.999 [0.987, 1.012] | 0.998 [0.986, 1.011] | 1.004 [0.993, 1.015] |    0.998–1.004 |                 0.4% |
| screenshot-repeated | 1.026 [0.970, 1.086] | 1.006 [0.942, 1.075] | 0.970 [0.911, 1.033] |    0.970–1.026 |                 3.0% |
| screenshot-large    | 0.991 [0.942, 1.042] | 0.987 [0.937, 1.039] | 1.035 [0.935, 1.147] |    0.987–1.035 |                 3.5% |
| screenshot-element  | 1.017 [0.928, 1.115] | 1.045 [0.983, 1.110] | 1.032 [0.910, 1.169] |    1.017–1.045 |                 4.5% |

| Case                | Job 1 head/Playwright | Job 2 head/Playwright | Job 3 head/Playwright |
| ------------------- | --------------------: | --------------------: | --------------------: |
| launch-first-page   |  1.671 [1.638, 1.705] |  1.684 [1.646, 1.723] |  1.682 [1.634, 1.732] |
| launch              |  1.870 [1.819, 1.923] |  1.822 [1.774, 1.872] |  1.889 [1.833, 1.947] |
| first-page          |  1.402 [1.362, 1.444] |  1.458 [1.368, 1.553] |  1.496 [1.409, 1.588] |
| shutdown            |  0.992 [0.932, 1.056] |  1.043 [0.958, 1.136] |  1.030 [0.909, 1.167] |
| page-lifecycle      |  1.334 [1.299, 1.371] |  1.339 [1.280, 1.400] |  1.377 [1.303, 1.456] |
| repeated-lifecycle  |  1.209 [1.190, 1.228] |  1.196 [1.178, 1.214] |  1.257 [1.233, 1.282] |
| response-body-small |  0.981 [0.879, 1.094] |  1.090 [0.959, 1.240] |  1.015 [0.892, 1.155] |
| response-body-large |  0.869 [0.821, 0.919] |  0.843 [0.795, 0.893] |  0.798 [0.732, 0.871] |
| navigate            |  1.092 [0.995, 1.198] |  1.281 [1.210, 1.356] |  1.153 [1.080, 1.231] |
| resources           |  1.323 [1.278, 1.371] |  1.381 [1.331, 1.432] |  1.293 [1.243, 1.345] |
| evaluate            |  0.832 [0.746, 0.927] |  0.889 [0.793, 0.997] |  0.814 [0.713, 0.929] |
| locator-read        |  0.665 [0.614, 0.721] |  0.698 [0.649, 0.749] |  0.640 [0.584, 0.702] |
| locator-values      |  0.666 [0.628, 0.707] |  0.722 [0.670, 0.778] |  0.683 [0.646, 0.723] |
| read-snapshot-100   |  0.521 [0.442, 0.614] |  0.460 [0.399, 0.530] |  0.498 [0.410, 0.605] |
| read-snapshot-1000  |  0.717 [0.634, 0.811] |  0.750 [0.685, 0.821] |  0.677 [0.598, 0.766] |
| click               |  0.595 [0.531, 0.666] |  0.662 [0.582, 0.754] |  0.609 [0.541, 0.685] |
| fill                |  0.755 [0.676, 0.845] |  0.715 [0.655, 0.781] |  0.721 [0.683, 0.762] |
| visible             |  0.578 [0.529, 0.632] |  0.607 [0.565, 0.651] |  0.566 [0.526, 0.609] |
| visible-delayed     |  0.801 [0.780, 0.822] |  0.847 [0.829, 0.865] |  0.847 [0.829, 0.864] |
| visible-many        |  0.654 [0.639, 0.669] |  0.677 [0.660, 0.696] |  0.667 [0.649, 0.686] |
| console-many        |  0.725 [0.608, 0.865] |  0.649 [0.541, 0.779] |  0.685 [0.561, 0.835] |
| screenshot          |  0.789 [0.701, 0.889] |  0.761 [0.678, 0.853] |  0.720 [0.649, 0.799] |
| screenshot-dense    |  1.016 [1.001, 1.031] |  1.009 [0.999, 1.020] |  1.012 [0.999, 1.025] |
| screenshot-repeated |  0.866 [0.823, 0.911] |  0.945 [0.868, 1.029] |  0.880 [0.816, 0.949] |
| screenshot-large    |  0.683 [0.647, 0.722] |  0.706 [0.675, 0.739] |  0.739 [0.679, 0.804] |
| screenshot-element  |  0.425 [0.390, 0.464] |  0.437 [0.405, 0.472] |  0.437 [0.405, 0.473] |

Head/Playwright figures retain the existing library defaults and timing boundaries described above. In particular,
lifecycle cases compare different readiness/release paths and resources; their ratios are not isolated protocol
costs. Ratios from these controls describe this source revision and these runners, not a general parity claim.

The `unused-handlers-never`, `unused-handlers-other` and `unused-handlers-removed` controls create a locator and
its effect before setup, then time fill, a waiting visibility assertion and a value read. Extra pages in the same
context and another context remain open during timing. Setup, activation and cleanup are excluded. The `other`
control registers handlers only on those extra pages; `removed` registers and removes one on the measured page.
The identical driver harness is overlaid onto both refs. A ref without the registration API omits that optional
setup, so these controls compare the measured ordinary path against its pre-feature behavior; they do not measure
registration or callback performance. Playwright receives the same extra-page and handler setup. The ordinary
click, fill, visible, visible-delayed, evaluate and locator-read controls remain separate.

The `role-presentation` workload counts 100 headings with `role="none" tabindex="0.5"` twenty times per sample.
Preparation is outside the timer. It exercises role traversal and the presentation-conflict tabindex predicate
without using `Expect.toHaveRole`; Strider and Playwright must each return 100 every time. Ordinary `locator-read`,
`click` and `visible` exercise the role engine on their default fixture, but do not directly stress presentation
conflicts. `read-snapshot-100` and `read-snapshot-1000` evaluate a main-world input-property function; they measure
DOM evaluation and value transfer, not ARIA role traversal or the accessibility snapshot API.

For shared role-engine diagnosis, dispatch `benchmarks.yml` with `workload=bench`, `only=role-engine-diagnostic`, `base` naming the original
engine and `head` the reviewed engine. The driver supplies the optimized engine; when its engine is unchanged,
the harness labels the combined candidate explicitly. Six serialized engine variants run interleaved on one
page (use 24 measured rounds to balance its rotations) over focusable/non-focusable presentation headings and list/table inheritance. Every `engine.run` count
query clears its caches. Original list/table outputs are recorded as incorrect and are excluded from
old-versus-current speed ratios; every candidate must equal the reviewed engine. Raw batches, engine source
hashes, fixture definitions and partial failures are retained. Same-page pairing reduces some sources of noise,
but does not eliminate JIT, GC, scheduling, order or thermal effects.

### Hosted upload and response phase diagnostic

Dispatch `benchmarks.yml` from the tooling branch with `workload=bench`, `only=phase-diagnostic`,
`browser=chromium`, and pinned base/head commits. This diagnostic profiles head and Playwright, with three
warmups and the requested alternating pairs. `phase-diagnostic/report.json` and `phases.md` split the upload
and response scenarios at timing marks; `phase-summary.md` also includes separate traced `setInputFiles` and
close timelines. `phase-diagnostic/trace/input.md` reports commands, serial round trips, wire bytes, and
per-command timing for the upload call. The trace pass uses separate samples and protocol hooks that add overhead;
its timings do not replace the untraced phase samples or the paired scenario comparison.

The upload fixture exercises an all-Bytes selection totaling at most 64 KiB: Strider constructs and assigns it
in one evaluation call using the engine utility world. Its trace includes locator work and node resolution as
well as assignment; command count is not the number of upload evaluation calls. It does not measure the collector
path used for larger Bytes selections or any attached Local file. A remaining phase difference does not by itself
identify removable locator or transport work.

### Hosted launch phase diagnostics

Dispatch `benchmarks.yml` from the tooling branch with `workload=bench`, `only=launch-diagnostic`,
`browser=chromium`, `runs=20`, and base/head pinned to the same commit. This entry profiles head only;
base is retained for provenance, not measured as a comparison role. The driver overlays its profiler,
hooks and regression tests onto head, retaining the exact tooling and original source/dependency provenance.
It first runs ordinary/persistent missing-instrumentation, complete-report, calibration and native-trace
regressions. It then collects one native baseline block with the requested alternating Strider/Playwright
pairs after three warmup pairs. No argument control is run. This private probe changes no supported defaults
or workflow. The initial window, sandbox and core-limit wrapper remain intact.

The retained `launch-diagnostic/` directory contains each block's report, raw phases, wire messages, spawn
arguments, resource counts, regression child output, rejected reports and logs, including on failure.
Native blocks also retain full Chromium JSON startup traces outside temporary browser profiles. Before
browser disposal, the profiler waits for parseable trace output, verifies the Linux monotonic clock domain,
checks buffer-loss counters, and requires a native first-command handler plus host send/reply evidence.
After availability and Strider's initial gate, three root `Browser.getVersion` probes run before retention,
outside launch timing. Each command has a two-second wait bound; rejection or timeout stops further probes.
The probes use each library's existing root command client, preserving normal reply matching and cleanup.
Reports explicitly require all three calibration sends, replies and native handler entries inside the trace;
an expired trace window fails rather than silently falling back to wider bounds. Causal send/handler-entry/reply
intervals bound clock offset. Reports retain both the intersection excluding calibration and the tightened
intersection from the same sample, with their uncertainty and the original first-command evidence. Original trace bytes survive failed validation.
Strider's initial page must still evaluate to `about:blank` after trace retention.

`launch-summary.md` labels the output diagnostic only. Launch availability remains the boundary; initial-page
gate observation, liveness checks, trace flushing and cleanup are outside timing. Different default initial
resources and sandbox settings remain. Native tracing and phase/protocol instrumentation perturb startup; this baseline calibration run does not
measure their overhead or a production speedup. Do not sum overlapping spans or treat these timings as parity evidence. A failed or partial report
establishes no valid timing result. Uninstrumented paired lifecycle and same-source controls remain necessary
before proposing an optimization.

### Hosted twenty-page phase diagnostic

Dispatch `benchmarks.yml` from the tooling branch with `workload=scenarios`,
`only=many-pages-diagnostic`, `browser=chromium`, `runs=32`, and identical pinned base/head commits.
Base runs the unchanged callback; head timestamps context acquisition, each indexed creation/navigation/click,
each final counter read, and scoped context release. The four-cell Williams schedule balances both libraries
and instrumentation roles. Launch remains a separate, uninstrumented case.

The driver transforms only the two callback regions and the head measurement runner; original library source,
operation order, defaults, deadlines, output checks and cleanup remain unchanged. Source-boundary assertions reject
a changed callback. Exact overlaid sources are retained under `driver/base` and `driver/head`.
`head/phases.ndjson` contains the initial Strider/Playwright checks followed by head callbacks in scheduler order.
Failed callbacks retain partial phases and are excluded from reconciliation. Missing/reordered/overlapping phases
reject a successful diagnostic. File output occurs after the runner timer stops, before the sample acknowledgment.

Each successful callback reports disjoint phase sum, callback elapsed and residual. Subtract callback elapsed
from the corresponding runner sample to expose normalization, verification and diagnostic bookkeeping overhead.
Release starts when the original callback body returns (or Playwright enters context.close) and ends after the
scoped callback resolves; it includes return/finalizer/promise overhead, not just wire acknowledgment latency.
Timestamp calls, record allocation, generator resumption and added promise bookkeeping perturb timings; paired
head/base totals bound the observed instrumentation effect, not an independent universal correction. Supported
navigation defaults still differ. These measurements attribute this workload, and establish no optimization.

### Hosted navigation phase diagnostic

Dispatch `benchmarks.yml` from the diagnostic tooling branch with `workload=bench`,
`only=navigation-diagnostic`, `browser=chromium`, `runs=40`, and identical pinned base/head library commits.
Head alone is profiled; base is retained for provenance. Run the unchanged `only=navigate` control separately
with the same pins. This diagnostic does not replace its parity result.

Each fresh isolated page loads the ordinary benchmark fixture outside timing, then records goto through load,
first title read and second title read on the same destination. Both titles must be `Shop`. Viewport/DPR,
30-second deadlines and scoped/context cleanup retain the ordinary benchmark's boundaries. Three warmup pairs
precede balanced alternating measured pairs. Four additional pairs capture protocol sends/replies and Strider
realm-acquisition/engine-installation marks; their timings are excluded from phase distributions.

`navigation-diagnostic/` retains phase samples, bounded protocol traces, tooling hashes and failures. Long wire
strings retain length, SHA-256 and prefix instead of full engine source. Source hooks assert pinned replacement
counts and alter only instrumentation; they still add overhead even with capture disabled. Trace validation
requires realm creation, engine installation and title execution, matching successful replies and ordered phase
marks. Missing instrumentation fails the run. Setup and cleanup are outside phase timing; separate browser
processes remain resident. These observations isolate dependencies, not browser CPU versus IPC versus host
scheduling. A faster repeated read alone does not attribute the first-read excess to engine installation.

The `navigate-title-locator` case retains the original `navigate` load/title work, then reads the local
`Shop` heading through each library's role locator. It verifies both results as `Shop`. This combined timer
checks whether a cheaper title read merely defers initialization to the next locator. Setup, verification and
cleanup remain outside timing, as for `navigate`.

### Viewport and locator-handler default-path controls

`viewport-ready` warms the locator engine with a heading read outside timing, then runs a real
`Expect.toBeInViewport()` assertion on that intersecting heading. `viewport-retry` uses the same warmup,
then arms a 100 ms transition moving a fixed 100 × 100 target from `top: 2000px` to `top: 0px` and asserts
positive intersection. Timer setup and the intentional delay are included; preparation and cleanup are not.
As with delayed visibility, the timer is not an observer-readiness barrier: a sufficiently delayed host may
begin checking after the transition. This measures a delayed viewport condition, not a guaranteed retry count.
No handler is registered, no deadline is shortened, and normal operation tracing remains enabled.

The Playwright control uses its ordinary locator evaluation with a native `IntersectionObserver`, resolving
only for a strictly positive ratio, disconnecting on success or its 30-second timeout. `playwright-core` does
not supply Playwright Test's assertion package, so this is a native intersection control, not its `expect`
implementation. The paired head/base Strider comparison uses the same real Strider assertion on both refs.

`cold-locator-read` measures the first heading read in each fresh document, including lazy engine installation.
It performs no locator preparation. Page/context creation and initial navigation remain outside timing on
both sides; it isolates installation from browser launch rather than claiming cold-machine startup coverage.

`--only viewport-install` selects these three cases. `--only handler-default-path` adds the never-registered,
other-page/context-active and removed-handler controls, plus `click` and `visible` (eight cases total).
The paired driver overlays the same case definitions, fixture server and runner on both refs, and retains their
source hashes. Use exact refs and 200 pairs for both an identical-code control and the changed-code comparison;
run them sequentially through `benchmarks.yml` and retain every interval, including slowdown signals.

For correctness-only local validation, without collecting benchmark timings:

```sh
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node packages/scenarios/benchmark/validate-viewport.ts
```

This runs each of the three case bodies once for each library, checks the pinned Chromium version, and verifies
its output. It does not call the measurement runner or write performance samples.

### Hosted twenty-page protocol trace

`only=many-pages-trace` (`workload=scenarios`, `browser=chromium`, `runs=8`, identical pinned base/head commits)
runs the unchanged scenarios in both roles with the session-profile loader, which writes every protocol message of
each attempt, with its host `performance.now()` time at send and at receive, to `<role>/protocol-trace.jsonl`.
Page creation and context release can then be read off as sequences of commands and replies, per library. The
timestamps are host-side, not the browser's, and the loader's per-message work perturbs timings, so a trace
attributes where time goes and is never a baseline or speedup figure. The first attempts of each role include
startup, and the repetitions are same-source replicates, not a distribution estimate.

### Emulated-focus variant

`many-pages-emulated` is the twenty-page scenario with Strider's context created with `focus: "emulated"`, which on
Chromium opens pages as tabs; the Playwright twin is the same callback as `many-pages`. It is Chromium-only: Firefox
rejects focus emulation, so a Firefox run leaves it out and lists it as excluded in the report. `--only` takes
several comma-separated names, so one paired dispatch (`only=many-pages,many-pages-emulated`) measures both.

Evidence for the placement change (hosted Chromium 155.0.8059.79): a trace of the default path showed
`Target.createTarget` with `newWindow: true` answering in about 46–50 ms against 13–17 ms for a tab, and closing
twenty windows taking about 22 ms each, serially inside the browser, so that closing them concurrently saved nothing
(release 430.5 ms against 427.3 ms). The default path measured 1.578× Playwright [1.560, 1.597] and the emulated
variant 0.907× [0.898, 0.916], head against base main (32 rounds, one job).
