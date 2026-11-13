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

A private workspace package, never published: a harness that compares Strider with Playwright. It runs the same
scenarios with each library against the same pinned stock Chromium, or pinned stock Firefox versus Playwright-patched
Firefox, and prints each run’s report. The combined [RESULTS.md](RESULTS.md) is generated explicitly from preserved
measurements.

The report contains:

- **Scenarios:** API.md's call sites that both libraries can do, each written twice, once with each
  library (`src/scenarios.ts`), with their outcomes and wall times. Older preserved measurements can hold scenarios
  that have no Playwright twin, which the report shows with `–` in the Playwright columns;
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
Firefox omits Chromium's renderer CPU, Fetch interception and automation-tell diagnostics. It never substitutes different work to create a timing twin.

## Sites

- **The local site** (`src/site.ts`), a page per scenario and the pages the measurements load, served on
  `127.0.0.1` for the run.
- **A public demo site made for automation practice,** The Internet (`https://the-internet.herokuapp.com`, Sauce
  Labs' `the-internet`, Apache-2.0): its login and its dynamic controls. It's visited live once by
  `pnpm scenarios --record`, which records it with Strider's `Har.record`, and replayed by each library's own HAR
  replay from then on, every request answered from the recording, so a run sends nothing to anyone. Each
  program opens its own context and routes it to the recording: Strider with `Route.fromHar`, Playwright with
  `routeFromHAR`.

  The recording is kept in a private R2 bucket, which the repository's public copy can't hold: it has the site's own
  files, which the repository doesn't redistribute. `recordings.json` commits each recording's name, SHA-256 and size,
  and the bucket holds each under `sha256/<hash>`. A run copies any recording that is missing from `.data/scenarios/`
  (git-ignored) or differs from the manifest out of the bucket, checks it against the manifest, and fails naming the
  file when it doesn't match. The bucket is read with these variables, which `pnpm scenarios` passes into the
  integration environment:

  | Variable                               | Holds                                   |
  | -------------------------------------- | --------------------------------------- |
  | `STRIDER_RECORDINGS_ACCOUNT_ID`        | The Cloudflare account                  |
  | `STRIDER_RECORDINGS_BUCKET`            | The bucket's name, `strider-recordings` |
  | `STRIDER_RECORDINGS_ACCESS_KEY_ID`     | The bucket's R2 token's access key      |
  | `STRIDER_RECORDINGS_SECRET_ACCESS_KEY` | That token's secret                     |

  Without all four, the local-site scenarios run and each real-site scenario whose recording isn't already in
  `.data/scenarios/` is skipped: the output and the report's unsupported comparisons say so and why.

  The bucket, `strider-recordings`, was made by hand in Cloudflare's dashboard: private, with no public access or
  domain. Its one token reads and writes only that bucket. The four values are kept encrypted in
  `recordings.sops.env`, for the maintainer's age key and the benchmarks' CI key (`.sops.yaml`).
  `pnpm scenarios:recorded` decrypts them and runs `pnpm scenarios` with them, taking the same arguments, and
  `benchmarks.yml` decrypts them with the `benchmarks` environment's `SOPS_AGE_KEY`. Every recording's hash is
  committed, so a key that can write can delete or replace a recording, which makes runs fail naming it, but can't
  change one unnoticed.

## Refreshing recordings

Before starting any replay browser, the runner checks that each selected scenario's required page URLs have GET
requests in its HAR. A missing file, unreadable HAR or missing page stops the run with the file path and an explicit
refresh command. This checks page coverage, not the completeness of assets, response bodies or interactions.
Ordinary runs never fetch a missing request live. `--only controls` checks the dynamic-controls page without requiring
the login pages used by other scenarios.

`pnpm scenarios --record` visits the live sites, overwrites the ignored working recordings in `.data/scenarios/`,
uploads each to the bucket under its hash, and rewrites `recordings.json`: commit that file with the refresh. Uploading
needs the same four variables, which `pnpm scenarios:recorded --record` supplies; without them the recording is kept locally and the command fails
saying it wasn't uploaded. `pnpm scenarios --upload` does the upload and the manifest alone, for the recordings already in `.data/scenarios/`, without visiting any site: use it to pin the recordings an earlier run was measured on. Run it as `pnpm scenarios:recorded --upload`; it fails naming any recording file that is missing. Preserve the old files outside that directory first, using a new evidence directory for each refresh. For example,
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
