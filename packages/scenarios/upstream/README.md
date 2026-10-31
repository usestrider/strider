# Public Playwright suites ported to Strider

These tests run real upstream fixtures with Playwright and Strider on the same pinned Chromium. They test whether
Strider can express and pass existing browser tests whose expectations were chosen by other projects.

```sh
pnpm test:upstream                      # all four suites, both libraries
pnpm test:upstream Astro                # one project
pnpm test:upstream --reporter verbose   # each case and its result
pnpm benchmark:upstream --name baseline # warmup + five samples, sequentially; preserve this run
STRIDER_UPSTREAM_SAMPLES=3 pnpm test:upstream Fill --no-file-parallelism
```

`pnpm test:upstream` fails with a nonzero exit status if either library fails an assertion, including in benchmark
mode. The larger diagnostic suites currently expose differences and run explicitly; the nine previously validated
Vite and Astro cases also run in `pnpm test:integration`, including the existing nightly integration workflow. No
case is marked as an expected failure or retried. The suites need no live demo site, recording, upstream checkout
or extra dependency installation after the workspace's normal `pnpm install`.

## Sources and coverage

- **Vite:** all four cases from
  [`css-dynamic-import.spec.ts`](https://github.com/vitejs/vite/blob/90bc034a97e7eccd0f3cbc69904fffa625a4c34d/playground/css-dynamic-import/__tests__/css-dynamic-import.spec.ts).
  Dynamic imports must apply the expected green style and avoid duplicate stylesheet links. Both development and
  production servers run with relative and absolute bases. Port: [Vite.test.ts](../test/upstream/Vite.test.ts).
- **Astro:** all five cases from
  [`astro-component.test.ts`](https://github.com/withastro/astro/blob/10dae2f31486cc0a6a04d1f3d7f5ab7fa8889b30/packages/astro/e2e/astro-component.test.ts).
  Editing source files must update component styles, rerun processed and inline scripts, and update the text and
  styles of a linked Astro component. The script tests subscribe to console events before navigation and before
  editing. Port: [Astro.test.ts](../test/upstream/Astro.test.ts).
- **Playwright fill:** all 36 numbered cases, including all seven shadow-DOM input types, from
  [`page-fill.spec.ts`](https://github.com/microsoft/playwright/blob/deb7e86201e26cb4a8e25191fce5ef2f7a28aa87/tests/page/page-fill.spec.ts).
  The input-type loops are expanded so one failure cannot hide another: 53 cases covering text and specialized
  inputs, validation, contenteditable selections, beforeinput handlers, disabled/readonly/hidden/inert elements,
  modal dialogs, frame focus, navigation during input and event propagation.
  Port: [Fill.test.ts](../test/upstream/Fill.test.ts).
- **Playwright check:** all 17 numbered cases from
  [`page-check.spec.ts`](https://github.com/microsoft/playwright/blob/deb7e86201e26cb4a8e25191fce5ef2f7a28aa87/tests/page/page-check.spec.ts).
  Expanding the ARIA role loops gives 29 cases: native and ARIA checkboxes and radios, existing state, invalid
  targets, labels with explicit click positions, trial actions and switching checked state.
  Port: [Check.test.ts](../test/upstream/Check.test.ts).

That is 91 cases, each run independently with both libraries: 182 tests per run. These cover four complete selected
test files, not any project's full test suite. Playwright's own regression tests exercise the automation library;
Vite and Astro exercise its use in other projects. Authentication, downloads, visual snapshots, Firefox and WebKit
are outside this selection.

The fixture sources and original test files are pinned to the commits above. The runtime dependencies are published
Vite 8.3.4 and Astro 7.4.2, not builds of those commits; Playwright Core is 1.64.1. The Playwright source revision is
from its 1.65 development branch: some newer regressions fail on the pinned Playwright release too. They remain
visible in the results and are not treated as Strider-only failures. Chromium is pinned by
[`browsers.json`](../../browser/test/integration/browsers.json), and each library's launcher version is checked.

## Timing

Each test run writes `.data/upstream/results.json` with raw samples and errors, and `.data/upstream/results.md` with
Playwright and Strider side by side for every case. These two convenience files are replaced by the next run.

The benchmark command also preserves each run in `.data/upstream/runs/<name>/`. Without `--name`, it uses the UTC
timestamp and Git revision. Existing directories are never overwritten. `run.json` records the full Git revision,
branch, working-tree status, diff hash, benchmark sources hash, dependency lockfile and Nix environment hashes, and file filters.
`results.json` adds raw samples, errors, browser and dependency versions, CPU, OS, Node version, and viewport;
`results.md` is the timing table, and `exit.json` records the command's exit status. A dirty run is labeled: its
revision alone does not reproduce its local edits, and the hashes are identifiers, not source backups.

```sh
pnpm benchmark:upstream --name before
# Make a performance change, then repeat the same selection.
pnpm benchmark:upstream --name after
pnpm benchmark:compare before after

# A focused comparison with fewer samples:
pnpm benchmark:upstream --name check-before --samples 3 Check
pnpm benchmark:upstream --name check-after --samples 3 Check
pnpm benchmark:compare check-before check-after

# Keep results outside a disposable worktree:
pnpm benchmark:upstream --name baseline --output /absolute/path/to/benchmarks/baseline
pnpm benchmark:compare /absolute/path/to/benchmarks/baseline /absolute/path/to/benchmarks/next
```

Run names resolve in this checkout; the comparison command also accepts run directories or `results.json` paths.
Artifacts are local and Git-ignored, not uploaded or committed automatically. Copy run directories to preserve or
share them, or choose `--output` outside the checkout. The runner, tests, fixtures and reporting code are versioned.
All benchmark runs require Nix and the workspace's normal `pnpm install`; comparing saved results needs only Node
and pnpm. `--samples` accepts 2–20; the default is five. Trailing arguments are test-file filters.

Comparison shows each library's before/after median, min–max, and percentage change. Negative means less elapsed
time. Cases missing from either run remain visible, and failed or incomplete cases get no delta. The aggregate
uses only cases both libraries passed in both runs, averaging their per-case medians. Changes to benchmark sources,
lockfiles, browser, runtime, machine or timing method produce a warning. Parallel, interrupted or single-sample runs
cannot be compared. Run comparisons on the same otherwise idle machine; these reports do not establish statistical
significance. A run with known assertion failures still saves its results and exits nonzero, so run the next command
separately rather than chaining it with `&&`.

`pnpm benchmark:upstream` runs one discarded warmup and five measured samples per library, with one worker and no
test concurrency. Each sample alternates which library runs its suite first. Each test gets a fresh browser and
page with a 1280 × 720 viewport. Timing starts after the page has been acquired and stops when the browser workflow
returns or fails. It includes navigation, input, reads, assertions and fixture edits inside that workflow; it excludes launch, page
creation, fixture/server setup and cleanup. It measures the complete test workflow, not a single API call. Astro
navigation includes the development server's on-demand compilation.

The table shows median milliseconds and min–max, plus Strider divided by Playwright. A ratio below one means
Strider took less time in that run. A case with any failed sample, including warmup, is `FAIL` and receives no
ratio; its attempted duration and error remain in JSON. Missing or skipped samples are `incomplete`. One-sample
correctness runs also produce reports, but use the sequential benchmark command for comparisons. These are local
wall-clock observations, not a general speed claim. Negative deadline tests deliberately include their timeout,
and actionability tests include the upstream five-animation-frame observation window.

## What the ports change

The fixture HTML, JavaScript, CSS and Astro components are byte-for-byte copies, verified against their SHA-256
hashes. Vite and Astro tests work on temporary copies; HMR edits cannot change the committed originals or another
test's input. Their servers listen on loopback with dynamically assigned ports and close after each test, as do
browsers and temporary directories. The input suites share a read-only local fixture server that closes after the
suite; each inline HTML document has its own URL.
Astro's telemetry and update checks are disabled.

The test harness uses Vitest with `playwright-core`, keeping Playwright a dependency of this private package alone.
Astro's Playwright CSS assertions become `expect.poll` on computed styles. In Strider the equivalent is
`Expect.that(locator.evaluate(...), Condition.make(...))`; Strider has no dedicated CSS matcher. Vite's `getColor`
helper's named `green` becomes the equivalent computed `rgb(0, 128, 0)`. Its link checks read the same fields in one
evaluation instead of allocating element handles. The original link equality and deduplication assertions remain.

For Astro's linked-component tests, assertions wait for the expected DOM or style change instead of using
`networkidle`. The expected values and source edits are unchanged. The processed-script test checks the same
`Hoisted success` content; Strider uses its text matcher rather than Playwright's `innerText` read.

For the input suites, inline HTML from upstream `setContent` calls is served over local HTTP and loaded with
`goto` in both ports. Tests that read page globals use Strider's `evaluateInMainWorld`. DOM reads and mutations use
locator evaluation. Shadow-DOM event listeners are installed by the fixture script before either driver acts.
Strider's `check`/`uncheck` pair expresses Playwright's `setChecked`; the element-handle `isChecked` assertion is
covered by Strider's locator read because it has no element-handle API. Playwright's text and value matchers use
Vitest's `expect.poll`, while Strider uses `Expect`. Native `innerText` is retained where line breaks matter.
Invalid-call assertions check Strider's typed error family and reason instead of Playwright's error wording.
The inherited-contenteditable expectation has the same five-second timeout in both ports. Input-type and role
loops become independent cases; neither library stops at the first failing variant.

Astro's fixture is served with inline configuration: its unused Preact integration is omitted, the dev toolbar stays
disabled, and the upstream monorepo's workspace dependencies resolve to this package's locked dependencies. Its linked
library is still a real filesystem symlink outside the app root. The integration test project's environment clears
`VITEST` and sets `NODE_ENV=development`, because Astro otherwise disables its HTTP middleware and HMR when served
inside Vitest. No application source or library implementation is replaced with a mock.

## Provenance and updates

[`sources.json`](sources.json) records each repository, commit, upstream path, local path and SHA-256. Each project's
`tests.txt` preserves its original test file for comparison without adding upstream test-runner dependencies. Both
projects use the MIT license; their full copyright and permission notices are retained in [vite/LICENSE](vite/LICENSE)
and [astro/LICENSE](astro/LICENSE), covering the copied fixtures and adapted tests. The Playwright fixtures and
modified ports retain their Google and Microsoft attribution under [Apache-2.0](playwright/LICENSE), with the
original [NOTICE](playwright/NOTICE). Its original test files are `fill.txt` and `check.txt`.

To update a source, retrieve its listed files from one new commit, update the hashes and revision together, compare
the original assertions with both ports, and run `pnpm test:upstream`. Keep dependency-version changes explicit:
changing a fixture revision does not change the version of Vite or Astro used to serve it.
