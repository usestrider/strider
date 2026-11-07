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
and with Playwright against the same stock Chromium, the one the integration environment pins, and writes what it
found to [RESULTS.md](RESULTS.md). The captured full run at `c732173` (2026-11-05) records failures for both
libraries on The Internet's dynamic controls: the preserved `the-internet.har` lacks the
`https://the-internet.herokuapp.com/dynamic_controls` URL, so replay aborts that navigation. Each library failed its
initial attempt and all ten timed repetitions. These are stale-recording failures, not established library or browser
defects. The separate local HAR recording/replay scenario passed in that run; this does not resolve its earlier
intermittent failure.

The report contains:

- **Scenarios:** API.md's call sites that both libraries can do, each written twice, as each library's own
  documentation would write it (`src/scenarios.ts`), with their outcomes and wall times. The documentation site's
  Scenarios section shows each Strider program, read from its `#region <name>/strider` markers, with its title and
  `description`. A scenario that only shows Strider, such as the video one, has no Playwright twin, and its
  Playwright columns are `–`;
- **Two costs Strider chose** (QUIRKS.md): Q82, an expectation that evaluates at every animation frame while it
  waits, as the renderers' CPU time; and Q103, Chromium's request interceptor always installed, as page loads;
- **The automation tells:** what a page's own script can read about the library driving it (`/tells` in
  `src/site.ts`), and the arguments each launches Chromium with.

```sh
pnpm scenarios --record     # once: visits the public demo sites live and records them in .data/scenarios/
pnpm scenarios              # everything, 10 timed runs each, writing RESULTS.md
pnpm scenarios --runs 3     # fewer runs
pnpm scenarios --only login # one scenario, and no measurements, printed: RESULTS.md keeps the full run
```

The video scenario encodes Chromium's screencast with ffmpeg, which the integration environment provides, and
writes `dynamic-controls.webm` where it runs, which for the runner is `.data/scenarios/`. Its Firefox counterpart runs on the environment's Firefox, which
writes the video itself (`Capability.Video`), copied to `dynamic-controls-firefox.webm` beside it. The
documentation site shows a copy of one run of each, in `website/public/videos/`.

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

This failure handling covers scenario attempts only. A failure in the later waiting-expectation, interceptor or page
probe measurements can still abort the command before report publication.

## Playwright

`playwright-core`, pinned, is this package's dependency and nothing else's: the library never depends on it.
`playwright-core` installs no browser, and Playwright launches the pinned Chromium by its `executablePath`, so no
Playwright build is downloaded or run.

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
