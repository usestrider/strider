# Scenarios: Strider and Playwright, side by side

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
- **Two public demo sites made for automation practice,** visited live once by `pnpm scenarios --record`, which
  records them with Strider's `Har.record`, and replayed by each library's own HAR replay from then on, every
  request answered from the recording, so a run sends nothing to anyone:
  - TodoMVC's demo for testing, `https://demo.playwright.dev/todomvc/` (TodoMVC is MIT-licensed);
  - The Internet's login, `https://the-internet.herokuapp.com/login` (Sauce Labs' `the-internet`, Apache-2.0).

  The recordings are kept in `.data/scenarios/`, which git ignores: they hold the sites' own files, which the
  repository doesn't redistribute.
