# Performance against Playwright

`pnpm bench` compares Strider's public API with the pinned `playwright-core` on the same headless Chromium
executable. It uses only local fixtures and needs no recordings. Run it on an otherwise idle Linux machine;
the command enters the same Nix environment as the integration tests.

```sh
pnpm bench                                      # 20 measured pairs after 3 warmup pairs per case
pnpm bench --check                              # fail if any Strider median is > 1.10 × Playwright
pnpm bench --check --max-ratio 1                 # require parity or better for every selected case
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

| Case                 | Timed work                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| `launch`             | Start a fresh browser and establish its automation connection; shutdown excluded        |
| `page-lifecycle`     | Create and close an isolated context and page, including viewport configuration         |
| `navigate`           | Navigate to a local document through `load`, then read its title                        |
| `resources`          | Load a local document with 100 uncached images through `load`, then count loaded images |
| `evaluate`           | 20 sequential main-world evaluations returning small objects; time per batch            |
| `locator-read`       | 20 sequential role locator text reads; time per batch                                   |
| `locator-values`     | 20 sequential input value reads across distinct elements; time per batch                |
| `read-snapshot-100`  | One synchronous main-world query returning 100 inputs × four properties                 |
| `read-snapshot-1000` | The same query returning 1,000 inputs × four properties                                 |
| `click`              | Click with default actionability, then read the updated counter                         |
| `fill`               | Fill a labeled input with default actionability, then read its value                    |
| `visible`            | Wait for an already visible heading                                                     |
| `screenshot`         | Capture the viewport as PNG                                                             |

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
checked against the integration pin. Persistent browsers are used for all cases except launch. Every launch
gets a fresh profile; warmup reduces library and OS cache effects, so this is not a cold-machine startup test.
Module imports are outside timing. Both libraries retain their default launch flags, instrumentation and
actionability behavior: the comparison measures the cost of each library's supported public behavior.

The JSON report retains all measured samples, median, nearest-rank p95, minimum, per-case ratio, target outcome,
configuration, browser/library/Node versions, machine details, and a SHA-256 of the browser and scenario sources
plus lockfile. The hash includes uncommitted source edits. A Markdown summary is written beside it. Reports
default to `.data/benchmarks/latest.{json,md}` (gitignored); use `--output` to preserve multiple runs. An interrupted
report may still say `running`; only a completed report can establish a result.

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

### Query result attribution

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

Coordinate these commands and checks with other work on the machine; retain the browser lock for the entire run.
Flag overlap with an unlocked suite as contaminated. The profiler uses 20 alternating library pairs and three
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
