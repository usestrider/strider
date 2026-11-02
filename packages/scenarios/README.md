# Scenarios: Strider and Playwright, side by side

The [public upstream suites](upstream/README.md) port Vite, Astro and Playwright's regression tests to Strider, using
their original assertions and fixtures. Run `pnpm test:upstream` for correctness, or `pnpm benchmark:upstream` for
repeated per-case workflow timings and `pnpm benchmark:compare` to compare saved runs. These diagnostics report
failures directly; the validated Vite and Astro cases also run with browser integration.

For isolated operation timings, raw samples and an optional performance gate, run `pnpm bench`.
[The operation benchmarks](BENCHMARKS.md) use local fixtures only and need no recordings. Workflow timings include
navigation and assertions; operation timings help identify which individual action contributes to a change.

Project PROJ-2's attached document DOC-2 maps the performance investigations by shared mechanism. The
[investigation workflow](BENCHMARKS.md#investigating-an-area) covers benchmark coverage, architecture comparisons,
experiments and the human review required for public API or contract changes. Findings and progress stay on Clutch.

A private workspace package, never published. It runs the same scenarios with Strider
and with Playwright against the same stock Chromium, the one the integration environment pins, and writes what it
found to [RESULTS.md](RESULTS.md):

- **Scenarios:** API.md's call sites that both libraries can do, each written twice, as each library's own
  documentation would write it (`src/scenarios.ts`), with their outcomes and wall times. The documentation site's
  Scenarios section shows each Strider program, read from its `#region <name>/strider` markers, with its title and
  `description`;
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

`pnpm scenarios` enters the integration environment (`flake.nix`, `devShells.integration`), as
`pnpm test:integration` does, and fails anywhere else.

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
  replay from then on, every request answered from the recording, so a run sends nothing to anyone.

  The recording is kept in `.data/scenarios/`, which git ignores: it holds the site's own files, which the
  repository doesn't redistribute.
