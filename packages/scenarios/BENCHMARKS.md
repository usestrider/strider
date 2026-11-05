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

| Case                 | Timed work                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `launch`             | Start a fresh browser and establish its automation connection; shutdown excluded                         |
| `first-page`         | Acquire the first isolated context/page after each fresh launch; launch and cleanup excluded             |
| `shutdown`           | Release each library’s freshly launched browser after availability; launch excluded                      |
| `repeated-lifecycle` | Five sequential isolated context/page acquisitions and releases on a persistent browser; checks excluded |
| `page-lifecycle`     | Create and close an isolated context and page, including viewport configuration                          |
| `navigate`           | Navigate to a local document through `load`, then read its title                                         |
| `resources`          | Load a local document with 100 uncached images through `load`, then count loaded images                  |
| `evaluate`           | 20 sequential main-world evaluations returning small objects; time per batch                             |
| `locator-read`       | 20 sequential role locator text reads; time per batch                                                    |
| `click`              | Click with default actionability, then read the updated counter                                          |
| `fill`               | Fill a labeled input with default actionability, then read its value                                     |
| `visible`            | Wait for an already visible heading                                                                      |
| `screenshot`         | Capture the viewport as PNG                                                                              |

For operation cases, each sample gets a fresh context and page loaded with the same fixture. Page creation,
initial navigation and cleanup are outside timing. Results are checked after the timer stops, including
each evaluation/read in a batch, image load counts, and screenshot format and dimensions. Warmups are checked
too. Cases stop on the first failure; the report marks an incomplete run as an error.

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
launch flags or resource ownership. Run it under the browser lock in the pinned integration environment:

```sh
clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node \
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
Spawn marks end when the process handle returns; they do not isolate shell execution or browser startup,
which can continue during the first-reply wait.
These instrumented samples are for attribution, not speed claims; use `pnpm bench` for uninstrumented comparisons.
Protocol waits may overlap, so their individual durations cannot be summed as elapsed launch time. Exclude runs
that overlap other suites, checks or builds even when those commands did not acquire the browser lock.

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
