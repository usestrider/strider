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

| Case                  | Timed work                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `launch-first-page`   | Fresh launch and first isolated configured page, retaining both phases and their combined time from one browser |
| `launch`              | Start a fresh browser and establish its automation connection; shutdown excluded                                |
| `first-page`          | Acquire the first isolated context/page after each fresh launch; launch and cleanup excluded                    |
| `shutdown`            | Release each library’s freshly launched browser after availability; launch excluded                             |
| `repeated-lifecycle`  | Five sequential isolated context/page acquisitions and releases on a persistent browser; checks excluded        |
| `page-lifecycle`      | Create and close an isolated context and page, including viewport configuration                                 |
| `navigate`            | Navigate to a local document through `load`, then read its title                                                |
| `resources`           | Load a local document with 100 uncached images through `load`, then count loaded images                         |
| `evaluate`            | 20 sequential main-world evaluations returning small objects; time per batch                                    |
| `locator-read`        | 20 sequential role locator text reads; time per batch                                                           |
| `locator-values`      | 20 sequential input value reads across distinct elements; time per batch                                        |
| `read-snapshot-100`   | One synchronous main-world query returning 100 inputs × four properties                                         |
| `read-snapshot-1000`  | The same query returning 1,000 inputs × four properties                                                         |
| `click`               | Click with default actionability, then read the updated counter                                                 |
| `fill`                | Fill a labeled input with default actionability, then read its value                                            |
| `visible`             | Wait for an already visible heading                                                                             |
| `screenshot`          | Capture the viewport as PNG                                                                                     |
| `screenshot-repeated` | Five sequential viewport PNG captures on one page; time per batch                                               |
| `screenshot-dense`    | Capture a seeded dense 1280 × 2880 canvas full page; setup excluded                                             |
| `screenshot-large`    | Capture a 1280 × 2880 full page; fixture setup excluded                                                         |
| `screenshot-element`  | Capture a visible 320 × 180 element; fixture setup excluded                                                     |

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
Currently only pinned stock Chromium is supported. Different `flake.lock` pins are rejected so the browser
and system environment remain common. Dependencies and builds are separate for each ref. The dispatched
branch supplies the measurement driver, overlaid onto both checkouts, so a base predating this driver works.
The libraries and their dependency lockfiles come from the respective refs; driver files are saved separately.

The scheduler rotates base Strider, head Strider, head Playwright and base Playwright through all four positions.
It grants one individual sample at a time, including benchmark warmups. Scenario initial correctness checks and
browser setup precede each case's readiness barrier; operation setup, assertions and cleanup retain their existing
boundaries. Browser processes for both refs stay resident while waiting, which differs from standalone runs.
The extra base Playwright samples retain a control for dependency changes.

Artifacts contain incremental raw samples (including warmups), worker logs, original lockfiles and browser pins,
resolved commits, driver sources, browser binary SHA-256, machine metadata and each worker's original report.
The summary reports geometric means of paired head/base and head/Playwright ratios with two-sided 95% Student t
intervals on log ratios (conservative degrees-of-freedom table). These describe uncertainty across repetitions,
not systematic machine bias; cases have separate intervals with no multiple-comparison correction. Ratios below
one favor head. A failed or incomplete run retains evidence and publishes no valid comparison in its summary;
partial per-case estimates in JSON must not be used as a successful comparison.

Hosted variance has not yet been measured. Before relying on small differences, repeat main against main at least
three times, record the observed spread, and use it to judge practical resolution. No performance gate is enabled.
