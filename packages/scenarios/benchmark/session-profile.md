# Session workload attribution

Run the canonical `long-session`, `many-pages`, and `parallel-tests` workloads with optional in-memory
instrumentation. The loader changes no files in the browser package or Playwright installation. Serialize browser
runs: wait for other browser tests or benchmarks to finish, and prevent concurrent runs for each complete command.
Create `.data/scenarios/` first in a fresh worktree; these local fixtures need no HAR.

First collect loader-free baselines with `pnpm scenarios --browser chromium --only long-session --runs 30
--output /absolute/new-baseline`. Provision Firefox as described in `../README.md`, and repeat with `--browser
firefox --playwright-firefox /absolute/pinned/firefox`.

For a separate diagnostic generation, from the repository root:

```sh
nix develop .#integration --ignore-environment --keep TERM --command env \
  STRIDER_SESSION_PROFILE=/absolute/new-profile.jsonl \
  node --import ./packages/scenarios/benchmark/session-profile-loader.mjs \
  packages/scenarios/src/bin.ts --browser chromium --only long-session --runs 3 \
  --output /absolute/new-profile-run
```

Repeat with `--only many-pages` and `--only parallel-tests`, and both Firefox executable options. Capture stdout
and stderr externally, too. The JSONL path must not exist. Retain the ordinary scenario output alongside it: that
contains alternating library order, outcomes, warnings, versions, executable paths, source snapshots and environment
metadata. Copy and hash the loader and its two supporting files separately, because ordinary scenario snapshots do
not include benchmark tooling. Record the exact tooling revision for each generation; historical samples and
distortion estimates describe the instrumentation that collected them. Keep raw evidence outside the repository.

Each JSONL line is one scenario attempt, including initial verification and launch attempts. `expected` identifies
the workload; line order maps to the runner's fixed initial order followed by alternating timed pairs. Every event
uses the host's monotonic `performance.now()` clock. `start` and `end` bracket canonical fill, click and navigation
calls; Playwright page close is also bracketed. The whole attempt spans setup through verification and scoped
cleanup. Concurrent actions overlap: their summed durations are not elapsed critical-path time.

`send` records a Strider protocol command when its write effect starts, immediately before `transport.send`;
`receive` records envelope parsing. Playwright records its browser pipe write and parse boundaries. These are host
boundaries, not browser execution timestamps or physical IPC completion. Match replies using command IDs and
session IDs; use interval unions rather than sums for overlapping command waits. Engine evaluations, actionability
requests and dispatch commands can be classified from the retained method and arguments. Remaining host intervals
include scheduling, serialization, bookkeeping, API construction and instrumentation. They do not isolate Effect.
There are no renderer tracing or CPU attribution claims in this tool. The existing `click-profile.ts` separately
counts engine rendering registrations for Chromium.

The loader validates exact protocol anchors and expected action-probe counts, and prints the modules it patched on
exit. Treat missing modules, unmatched commands, missing action spans, unexpected results and early termination as
incomplete diagnostics. Synchronous JSON parsing, retained wire payloads, span allocation and final JSON writing can
distort latency and memory. Compare separate loader-free and instrumented repetitions, report their distribution
and order limitations, and never substitute diagnostic samples for the baseline. Strider wrappers start on effect
execution, after operation construction; Playwright wrappers include method invocation. This difference includes
caller capture and must not be presented as an exact isolated host-cost comparison.

Firefox compares stock BiDi with Playwright's patched Juggler build, so it measures whole stacks. Protocol command
counts and elapsed intervals across these different protocols are evidence about the exercised paths, not a
controlled experiment isolating library overhead.
