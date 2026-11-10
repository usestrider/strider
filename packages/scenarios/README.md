# Scenarios: Strider and Playwright, side by side

The [public upstream suites](upstream/README.md) port Vite, Astro and Playwright's regression tests to Strider, using
their original assertions and fixtures. Run `pnpm test:upstream` for correctness, or `pnpm benchmark:upstream` for
repeated per-case workflow timings and `pnpm benchmark:compare` to compare saved runs. These diagnostics report
failures directly; the validated Vite and Astro cases also run with browser integration.

For isolated operation timings, raw samples and an optional performance gate, run `pnpm bench`.
[The operation benchmarks](BENCHMARKS.md) use local fixtures only and need no recordings. Workflow timings include
navigation and assertions; operation timings help identify which individual action contributes to a change.

The [investigation workflow](BENCHMARKS.md#investigating-an-area) covers benchmark coverage, architecture comparisons,
experiments and the human review required for public API or contract changes. Findings and progress stay in issues.

A private workspace package, never published. It runs the same scenarios with Strider
and with Playwright against the same pinned stock Chromium, or pinned stock Firefox versus Playwright-patched Firefox, and prints each run’s report. The combined [RESULTS.md](RESULTS.md) is generated explicitly from preserved measurements. A prior full run at `c732173` (2026-11-05) recorded failures for both
libraries on The Internet's dynamic controls: the preserved `the-internet.har` lacks the
`https://the-internet.herokuapp.com/dynamic_controls` URL, so replay aborts that navigation. In that prior run, each library failed its
initial attempt and all ten timed repetitions. These are stale-recording failures, not established library or browser
defects. The separate local HAR recording/replay scenario passed in that run; this does not resolve its earlier
intermittent failure.

The report contains:

- **Scenarios:** API.md's call sites that both libraries can do, each written twice, as each library's own
  documentation would write it (`src/scenarios.ts`), with their outcomes and wall times. A scenario that only shows
  Strider, such as the video one, has no Playwright twin, and its Playwright columns are `–`;
- **Chromium-only controls:** waiting-expectation renderer CPU (Q82) and retained Fetch interception (Q103).
  The public page layer pauses document requests to handle authentication challenges even without a user route;
  the historical description of a no-match-only interceptor is stale for this workload. These grouped sequential
  diagnostics do not establish a performance fix or a Firefox comparison;
- **The automation tells:** what a page's own script can read about the library driving it (`/tells` in
  `src/site.ts`), and the arguments each launches Chromium with.

```sh
pnpm scenarios --record     # once: visits the public demo sites live and records them in .data/scenarios/
pnpm scenarios              # Chromium scenarios and diagnostics, 10 timed pairs each, printed
pnpm scenarios --runs 3     # fewer runs
pnpm scenarios --only login # one scenario, and no measurements, printed: RESULTS.md keeps the full run
```

The video scenario encodes Chromium's screencast with ffmpeg, which the integration environment provides, and
writes `dynamic-controls.webm` where it runs, which for the runner is `.data/scenarios/`. Its Firefox counterpart runs on the environment's Firefox, which
writes the video itself (`Capability.Video`), copied to `dynamic-controls-firefox.webm` beside it.

`pnpm scenarios` enters the integration environment (`flake.nix`, `devShells.integration`), as
`pnpm test:integration` does, and fails anywhere else.

## Scenario failures

Each library makes one initial attempt and the scheduled timed repetitions, even when an earlier attempt fails.
A rejection or unexpected returned text counts as a failure. The runner logs initial failures with the scenario,
library and `initial outcome: failed:`; timed failures name the scenario, library and repetition number. It continues
the remaining repetitions and later scenarios without extra attempts.

The report retains initial outcomes separately, lists each timed failure and shows successful/attempted timing counts.
Failed attempts contribute no timing sample; zero successful samples show no timing statistics. If any scenario attempt
fails, the command returns a nonzero status after writing the report (or printing it for `--only`).

Launch uses the same failure handling as the other scenarios. Later diagnostic failures are logged and retained;
the command publishes its report and returns a nonzero status.

## Playwright

`playwright-core`, pinned, is this package's dependency and nothing else's: the library never depends on it.
Chromium uses the same pinned stock executable for both libraries. Firefox needs Juggler for Playwright and
WebDriver BiDi for Strider, so it compares stock Firefox 158.0 with Playwright 1.64.1's patched Firefox 157.0,
revision 1555. This measures the complete stacks, including different browser versions and patches, rather than
isolating library overhead. The `scenario-firefox` Nix package downloads the fixed Debian 12 x86-64 archive,
checks its unpacked SHA-256, and patches ELF paths using the pinned nixpkgs Firefox dependencies. It is currently
x86-64 Linux only. Provision it before measurement. Run browser measurements with exclusive access to the machine’s
browsers: wait for other browser tests or benchmarks to finish, and prevent concurrent runs for the duration of each
complete command. This also applies to recording refreshes and focused checks:

```sh
nix build .#scenario-firefox --out-link /absolute/evidence/playwright-firefox
pnpm scenarios --browser chromium --output /absolute/evidence/chromium
pnpm scenarios --browser firefox --playwright-firefox /absolute/evidence/playwright-firefox/firefox/firefox --output /absolute/evidence/firefox
```

## Regenerating the combined report

`pnpm scenarios:report` reads saved measurements without launching browsers or entering Nix. It generates the
summary, provenance, failure limitations, and both detailed reports directly from those inputs. No separate
artifact-local script or saved Markdown report is required. From the repository root:

```sh
pnpm scenarios:report --output packages/scenarios/RESULTS.md --context packages/scenarios/report-context.json /absolute/evidence/chromium/measurements.json /absolute/evidence/firefox/measurements.json
```

`report-context.json` preserves the reviewed correctness observations for the source commit named in that file.
The command rejects context from a different commit. For new measurements, omit `--context` until observations
for those measurements have been reviewed, or provide a new context file with its own source commit and observations.
Do not attach the existing observations to new measurements.

To verify regeneration, write a second copy and compare it byte for byte:

```sh
pnpm scenarios:report --output /absolute/evidence/regenerated.md --context packages/scenarios/report-context.json /absolute/evidence/chromium/measurements.json /absolute/evidence/firefox/measurements.json
cmp packages/scenarios/RESULTS.md /absolute/evidence/regenerated.md
```

Single-browser runs print their report and save files only when `--output` explicitly names an artifact directory.
They leave the checked-in combined report unchanged. Only the explicit `scenarios:report --output` command above
replaces it.

## Preserving measurements

Each output directory must be new, absolute and outside the worktree. It preserves raw ordered attempts (including
failed durations), complete measurements, launch results, recording validation, environment details, source snapshots,
source and recording hashes, full commit, browser versions, executable paths and launch arguments. Keep the command's
stdout/stderr in a sibling log too: early provisioning or startup failures may precede the final JSON report. The
command never replaces an existing evidence directory. Reports with failures retain successful samples but withhold
comparison gaps. Diagnostic failures are retained and return a failing status after publication.

Every timed scenario, including launch, has one untimed verification/warmup followed by alternating Strider-first and
Playwright-first pairs. Launch includes a fresh browser, one context and page, fixture navigation, verified text, and
shutdown equally for both libraries. There is no filesystem-cache reset. The larger workloads are fixed at 20 pages
kept open in one context (one click per page), 300 actions in one page (150 fill/click pairs), and four concurrent
contexts sharing a browser (25 fill/click pairs per context, 200 actions total). Both implementations verify all final
counters and input values. Context/page setup, verification and teardown are in the scenario timing. The two stacks
retain their own default launch settings, waits and schedulers; this run changes no production behavior.

The report gives p50 and p90 gaps as `(Strider / Playwright - 1) × 100`; positive is slower. Statistics use the
existing upper median and sorted sample at `floor(0.9 × n)`, without interpolation. Ten repetitions provide only a
small p90 sample, and the desktop's other work can affect timings. Raw samples allow independent recalculation.
Firefox omits video scenarios because they have no equivalent Playwright twin, and omits Chromium's renderer CPU,
Fetch interception and automation-tell diagnostics. It never substitutes different work to create a timing twin.

## Sites

- **The local site** (`src/site.ts`), a page per scenario and the pages the measurements load, served on
  `127.0.0.1` for the run.
- **A public demo site made for automation practice,** The Internet (`https://the-internet.herokuapp.com`, Sauce
  Labs' `the-internet`, Apache-2.0): its login and its dynamic controls. It's visited live once by
  `pnpm scenarios --record`, which records it with Strider's `Har.record`, and replayed by each library's own HAR
  replay from then on, every request answered from the recording, so a run sends nothing to anyone. A Strider
  program visits the site live, as a reader copying it from the documentation would, and the runner replays the
  recording under it (`src/replay.ts`): every context its browser makes routes its requests to the recording. A
  Playwright twin routes its context itself, with `routeFromHAR`.

  The recording is kept in `.data/scenarios/`, which git ignores: it holds the site's own files, which the
  repository doesn't redistribute.

## Refreshing recordings

Before starting any replay browser, the runner checks that each selected scenario's required page URLs have GET
requests in its HAR. A missing file, unreadable HAR or missing page stops the run with the file path and an explicit
refresh command. This checks page coverage, not the completeness of assets, response bodies or interactions.
Ordinary runs never fetch a missing request live. `--only controls` checks the dynamic-controls page without requiring
the login pages used by other scenarios.

`pnpm scenarios --record` visits the live sites and overwrites the ignored working recordings in `.data/scenarios/`.
Preserve the old files outside that directory first, using a new evidence directory for each refresh. For example,
from the repository root (choose an absolute `evidence` path that does not already exist):

```sh
evidence=/absolute/path/to/recording-refresh
mkdir -p "$evidence/before" "$evidence/after"
cp -p .data/scenarios/*.har "$evidence/before/"
sha256sum "$evidence"/before/*.har > "$evidence/before.sha256"
pnpm scenarios --record > "$evidence/record.log" 2>&1
cp -p .data/scenarios/*.har "$evidence/after/"
sha256sum "$evidence"/after/*.har > "$evidence/after.sha256"
sha256sum --check "$evidence/before.sha256"
pnpm scenarios --only controls --runs 3 > "$evidence/controls.log" 2>&1
```

Keep previously retained evidence unchanged. Compare both checksum manifests and retain the refresh log even if the
live recording fails. The filtered validation prints its report and leaves the full `RESULTS.md` intact.
