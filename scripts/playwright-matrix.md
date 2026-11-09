# Updating the Playwright capability matrix

The matrix compares Playwright's JavaScript API with Strider's, row by row, to track what Strider lacks before 1.0.
It isn't published: the data is committed in `scripts/playwright-matrix/`, and the site doesn't render it.

- `upstream.json` inventories Playwright 1.64.0's JavaScript reference: 74 classes, 1,042 declared members and
  1,385 top-level options, with finite literal option values retained when the upstream parser exposes them. It contains names and provenance, not copied reference prose. Playwright's parser expands
  shared templates and selects the JavaScript language variants. Inherited members belong to their declaring class.
  The API, Test, reporter, Electron and Android reference directories are all included. Language-specific bindings
  excluded by the upstream JavaScript filter are not Strider capability gaps.
- `rows/<stable-id>.json` holds one curated comparison per file; `metadata.json` holds the pin, evidence paths, scope decisions and patch provenance. Each row owns upstream member IDs and, for an option row, its option
  name. IDs are permanent links: preserve them when changing descriptions or mappings. `has` needs public API
  evidence; `different` also needs an existing decision, a stable link to its specific paragraph and a verified quotation from that decision and its committed source revision; `missing` does not mean out of scope.
  A row compares the capability, not every overload, nested value or behavioral detail of two implementations.
  `valueCoverage` accounts for finite upstream option values. Unsupported subsets have explicit missing rows linked
  bidirectionally through `gaps`/`parent`; their `value` is included in search. Missing whole options already expose
  their absent values and do not need a separate row for each. Preserve existing row IDs when adding value gaps.
- `.data/playwright-matrix/browsers.json` records the current generated adapter tables. Each row's `capabilities` names requirements in these
  tables. `requirements` records explicit input/access constraints with source files and quotations; input can be
  native or WebDriver actions. Inspector-only navigation, focus, scrolling and selection are not refused merely
  because their operation names look like writes. The validator derives six browser/mode statuses, including limitations. `configuration` describes optional
  video services that make a default unsupported entry available. `browserOverrides` records specific API boundaries
  such as CDP-only connection and WebKit's lack of headless mode; these need review alongside adapter changes.
- `patchedBrowserNotes` keeps upstream build/protocol evidence separate from classifications. Feature-specific notes link to affected rows in both directions; general build notes do not imply that all of
  that browser's capabilities require patches. Each note has a pinned
  source line and an exact evidence string that the upstream validation checks. A protocol difference alone does not
  prove every feature of that browser requires patches.
- `metadata.json` lists the Strider declaration, decision and adapter source paths used in the mapping. The checker
  hashes their current contents into `.data/playwright-matrix/matrix.json`, alongside derived browser statuses.
  These computed hashes describe current inputs, not an acknowledgement of semantic review or evidence of semantic
  equivalence. Missing evidence files fail validation. Public API symbols name their declaring type when they are members. Link checks bind each qualified symbol to its
  exact source-derived reference anchor (or its type anchor for undocumented fields); the built check confirms the
  target was rendered. This detects a symbol/anchor mismatch, not whether two operations are semantically equivalent.

## Checking the current pin

From the repository root:

```sh
git clone --depth 1 --branch v1.64.0 https://github.com/microsoft/playwright.git /tmp/playwright-matrix
pnpm reference
pnpm matrix:check --upstream /tmp/playwright-matrix
pnpm website:check
pnpm website:build
pnpm matrix:check --upstream /tmp/playwright-matrix --built
```

The tag is a lightweight tag: both `v1.64.0` and `v1.64.0^{commit}` resolve to
`606ecd8b34bac100db32561b6278ffd76e5eb3cd`. The extractor checks HEAD, reference file hashes, names, options and source
locations. The built check verifies that every API reference page and anchor a row links to was rendered.
External links are pinned GitHub source locations checked against the checkout, not HTTP availability probes.
`pnpm all` includes the offline matrix and built-link check after building the site. Generate `pnpm reference` before
running the matrix check independently.

## Clean-checkout regressions

`pnpm test --run packages/browser/test/PlaywrightMatrix.test.ts` reads committed source and TypeScript declarations;
it needs neither `website/dist` nor `.data/api-reference`. It checks the reported mapping/evidence regressions and
negative symbol/anchor, decision-quotation and value-gap cases. The rendered reference anchors rows link to are additionally
checked by `pnpm matrix:check --built` after the website build; missing build output fails rather than skipping.

## Reviewing a Strider change

Review the affected mappings against public declarations and existing decisions; do not infer support from a
protocol command or a similarly named API. For browser support, inspect the adapter tables and the relevant public
operation. Preserve limitations, and distinguish a supported subset from the missing contract. Nested settings such
as proxy authentication and particular screenshot formats may need their own capability row rather than a broad
parent classification.

After reviewing source changes, generate current browser statuses and evidence hashes:

```sh
pnpm matrix:check
pnpm lint-fix
pnpm all
```

Generation does not classify new members or options. Inspect the curated row diff and the current evidence;
computed hashes do not record that anyone reviewed classifications. If a newly linked module is added, add its source
path to `metadata.json`'s `evidence` list. Browser-specific overrides, explicit access requirements and optional configuration requirements are curated
evidence, not inferred from operation names. Review each requirement's source quotation and applicable capability
or mode. Keep patch-note links in both directions, and audit alternative compositions for waiting, error,
no-match, strictness, identity and atomicity differences before changing a missing row to has. Decision citations pin the commit containing their anchors so preview links work before merging. If the decisions
file changes, commit that file first, then update each affected citation’s revision to the commit containing the
reviewed paragraph; the quotation still has to match the current source. Do not assign new deliberate differences
without an existing decision supporting them.

## Rolling Playwright

Resolve the new tag to a commit, review the upstream parser changes, then update the pin in
`scripts/playwright-reference.mjs`. Use an unmodified checkout at that commit. Regenerate the upstream inventory:

```sh
node --input-type=module - <<'JS'
import { writeFileSync } from "node:fs"
import { extract } from "./scripts/playwright-reference.mjs"
writeFileSync("scripts/playwright-matrix/upstream.json", JSON.stringify(extract("/tmp/playwright-matrix"), null, 2) + "\n")
JS
```

Review removed and added members, options and classes, and classify each new capability explicitly in `rows/<stable-id>.json`.
Do not generate a default supported classification. Preserve row IDs for surviving capabilities; remove ownership
of deleted upstream members, and record any replacement in the commit description. Recheck API links and decision
citations, update `upstreamVersion`, the guide's pin and counts here, then regenerate browser statuses/evidence and run
all checks above. Revalidate patch evidence against the new checkout. Have an independent reviewer audit mappings
and the rendered page; completeness checks cannot determine whether the stated semantics match.

Effect compositions cite the installed, version-pinned `effect` package source (currently Fiber.interrupt and Effect.sleep). The checker binds the module and export to that source URL, verifies the quotation, and hashes the installed source and package version. Review cancellation separately from deadlines: interruption is cooperative and cannot undo dispatched browser effects. Signal options inherit their implemented parent’s browser requirements; absent parents remain absent. Wait-state compositions use visibility/count expectations, with strictness, lazy identity and handle-return differences stated explicitly.

`scopeDecisions` records accepted 1.0 exclusions and their affected missing rows; `selectorDecisions` separately records planned XPath/test-id work and excluded selector/readiness forms. Scope metadata never changes implementation status. A mixed selector gap may include planned, excluded and undecided subsets; review its values rather than treating the whole row as excluded.

## Migrating feature branches

The former tracked `matrix.json` and `browsers.json` have been removed. Move each classification change into the
matching `rows/<stable-id>.json`, preserving its ID, status, notes, API evidence, requirements, overrides and provenance.
Do not copy the derived `browsers` field: the loader rejects it. Keep shared scope/selector decisions and patch notes
in `metadata.json`; its `evidence` is an array of paths, never stored hashes. The loader rejects old hash maps and
row files whose names differ from their IDs. To inspect the combined comparison, run `pnpm reference` followed by
`pnpm matrix:check` and read `.data/playwright-matrix/matrix.json`. Both derived files are ignored.

Browser and vitest `INDEX.md` files are also ignored. Resolve an old branch's generated-index conflict by removing
the tracked file; keep source changes and regenerate with `pnpm index`. `pnpm reference`, each package's build,
and each package's `prepack` generate the indexes. Published tarballs still include them. A source checkout needs
`pnpm index` before reading the local indexes; API.md links to source instead of an absent generated index.
Generated TypeScript barrels, protocol output and keyboard layouts remain tracked and retain their freshness checks.
`pnpm all` validates curated evidence and regenerates derived outputs on the PR itself, including fork PRs, without
bot commits or post-merge writes. It does not turn generation into a claim of human semantic review.
