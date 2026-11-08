# Updating the Playwright capability matrix

The guide at `/docs/playwright-matrix` renders the committed data in
`website/src/features/playwright/`. Its JSON download at `/docs/playwright-matrix.json` includes the same data.

- `upstream.json` inventories Playwright 1.64.0's JavaScript reference: 74 classes, 1,042 declared members and
  1,385 top-level options. It contains names and provenance, not copied reference prose. Playwright's parser expands
  shared templates and selects the JavaScript language variants. Inherited members belong to their declaring class.
  The API, Test, reporter, Electron and Android reference directories are all included. Language-specific bindings
  excluded by the upstream JavaScript filter are not Strider capability gaps.
- `matrix.json` is the curated comparison. Each row owns upstream member IDs and, for an option row, its option
  name. IDs are permanent links: preserve them when changing descriptions or mappings. `has` needs public API
  evidence; `different` also needs an existing decision and an explanation; `missing` does not mean out of scope.
  A row compares the capability, not every overload, nested value or behavioral detail of two implementations.
- `browsers.json` snapshots the generated adapter tables. Each row's `capabilities` names requirements in these
  tables. The validator derives six browser/mode statuses, including limitations. `configuration` describes optional
  video services that make a default unsupported entry available. `browserOverrides` records specific API boundaries
  such as CDP-only connection and WebKit's lack of headless mode; these need review alongside adapter changes.
- `patchedBrowserNotes` keeps upstream build/protocol evidence separate from classifications. Each note has a pinned
  source line and an exact evidence string that the upstream validation checks. A protocol difference alone does not
  prove every feature of that browser requires patches.
- `evidence` hashes the Strider declarations, decisions and adapter sources used in the mapping. A changed file fails
  validation until the affected classifications have been reviewed. These hashes detect review needs, not semantic
  equivalence. Public API links point to the declaration that contains the corresponding symbol.

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
locations. The built check verifies local documentation routes and fragments, all row anchors, and the JSON download.
External links are pinned GitHub source locations checked against the checkout, not HTTP availability probes.
`pnpm all` includes the offline matrix and built-link check after building the site. Generate `pnpm reference` before
running the matrix check independently.

## Reviewing a Strider change

Review the affected mappings against public declarations and existing decisions; do not infer support from a
protocol command or a similarly named API. For browser support, inspect the adapter tables and the relevant public
operation. Preserve limitations, and distinguish a supported subset from the missing contract. Nested settings such
as proxy authentication and particular screenshot formats may need their own capability row rather than a broad
parent classification.

After reviewing source changes, refresh derived browser statuses and the evidence hashes:

```sh
pnpm matrix:check --refresh-browsers --refresh-evidence
pnpm lint-fix
pnpm all
```

Refreshes do not classify new members or options. Inspect the diff: refreshing hashes acknowledges a human review,
not proof that classifications are still correct. If a newly linked module is added, add its source path and SHA-256
hash to `evidence`. Browser-specific overrides and optional configuration requirements are curated evidence, not
inferred from names. Do not assign new deliberate differences without an existing decision supporting them.

## Rolling Playwright

Resolve the new tag to a commit, review the upstream parser changes, then update the pin in
`scripts/playwright-reference.mjs`. Use an unmodified checkout at that commit. Regenerate the upstream inventory:

```sh
node --input-type=module - <<'JS'
import { writeFileSync } from "node:fs"
import { extract } from "./scripts/playwright-reference.mjs"
writeFileSync("website/src/features/playwright/upstream.json", JSON.stringify(extract("/tmp/playwright-matrix"), null, 2) + "\n")
JS
```

Review removed and added members, options and classes, and classify each new capability explicitly in `matrix.json`.
Do not generate a default supported classification. Preserve row IDs for surviving capabilities; remove ownership
of deleted upstream members, and record any replacement in the commit description. Recheck API links and decision
citations, update `upstreamVersion`, the guide's pin and counts here, then refresh browser statuses/evidence and run
all checks above. Revalidate patch evidence against the new checkout. Have an independent reviewer audit mappings
and the rendered page; completeness checks cannot determine whether the stated semantics match.
