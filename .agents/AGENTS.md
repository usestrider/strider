# Strider

This repository is Strider (`@usestrider/browser` on npm): Effect-native browser automation that speaks CDP, WebDriver
BiDi and the WebKit inspector protocol directly. It is pre-release. All three layers are built, on Chromium, Firefox
and stock WebKit, and every member the API declares is built. One declared before it is built fails as the defect
`NotBuilt`, naming itself (`src/internal/notBuilt.ts`), never as a no-op. Use `pnpm` from the repository root.

## Layout

- Design documents are at the root: `docs/design.md` (goals, principles, status), `API.md` (L2, the public API),
  `CONCEPTS.md` (L1, the native model), `PROTOCOL.md` (L0), `CLI.md` and `PROBES.md`. `QUIRKS.md` and `ISSUES.md`
  are closed records: their entries stay citable (`QUIRKS.md, Q12`, `ISSUES.md, I3`), but nothing is added to them.
  New findings are issues (Issues, below).
- `docs/decisions.md` holds the principles and architectural decisions, with their reasons and the alternatives
  rejected; `docs/conventions.md` holds the Effect conventions. `research/` holds prior-art notes, a record of its
  time: don't rewrite it. `upstream/` holds drafts of proposals for other projects, which the maintainer posts.
- `packages/browser` is the published package:
  - `src/`: one module per file, exported as namespaces. `src/index.ts` and each subpath's `index.ts` are generated.
    `src/internal/` is implementation that no subpath exports, such as the protocol client, each backend's wire,
    launcher and adapter, L1's model (`model.ts`), the query engine that runs in the page (`engine.ts`), the
    event mechanism every event module shares (`events.ts`), the span helper every operation opens its span through
    (`spans.ts`), and the `strider` client and daemon (`cli/`).
  - `scenarios/`: the acceptance scenarios from API.md, type-checked as ordinary code.
  - `typetest/`: Tstyche tests of access rules, requirement channels and what crosses by value.
  - `test/`: runtime tests with `@effect/vitest`, which run anywhere (`pnpm test --run`), except
    `test/integration/`: the browser integration tests, which run only in the Nix environment that fixes the
    machine they see. `pnpm test:integration` enters it (`flake.nix`, `devShells.integration`, Linux) with nothing
    of the host's environment, and runs them: the pinned browsers (`test/integration/browsers.json`: Chromium
    155.0.8059.79, Firefox 158.0 and WebKitGTK 2.54.1's MiniBrowser for stock WebKit), fixed fonts, UTC, `C.UTF-8`, an empty home that is deleted after, no sound card, and no
    display: the MiniBrowser, which needs one, gets an Xvfb of its own (`test/integration/stockWebKit.ts`). Run anywhere else, they fail and
    say so; a browser of another version fails them too. Extra arguments go to Vitest
    (`pnpm test:integration packages/browser/test/integration/StockWebKitLaunched.test.ts`).
    `test/integration/adapter/` is the adapter conformance suite, written once and run against each backend, with
    the engine's tests; `test/integration/slice/` runs the public API through each backend's layer. WebKit's are
    stock WebKit's, the MiniBrowser launched. Where a case depends on what a backend can do, it reads the backend's
    capability table rather than its name (`slice/capabilities.ts`), checking the refusal where it can't. With
    `STRIDER_RECORD` naming an absolute directory, the integration tests record each browser's traffic for the
    drift test (`test/integration/record.ts`): `pnpm test:integration --no-file-parallelism`, into
    `test/fixtures/traffic/`, when a browser rolls.
  - `INDEX.md`: every declaration and member, generated.
  - `THIRD_PARTY_NOTICES.md`: the notices of what its generated code comes from, published with it. Both packages,
    like the repository, are under the MIT license (`LICENSE`), which `pnpm pack` copies into each.
- `packages/scenarios`: private, never published: Strider and Playwright side by side on the integration
  environment's Chromium. `pnpm scenarios` writes its `RESULTS.md`; `pnpm scenarios --record` visits
  the public demo sites once, live, into `.data/scenarios/`. Playwright (`playwright-core`) is this package's
  dependency alone: never import it elsewhere.
  `test/upstream/` ports selected public Playwright suites using pinned fixtures and notices in `upstream/`.
  `pnpm test:upstream` runs their Playwright baselines and Strider ports; `pnpm benchmark:upstream` records repeated
  per-case timings in `.data/upstream/runs/`; `pnpm benchmark:compare <before> <after>` compares saved generations.
  `--output` keeps a run outside the worktree. The larger diagnostic suites expose known failures; only the validated Vite
  and Astro cases also run in `pnpm test:integration`. Keep failures visible, and track findings as issues.
- `packages/tools/docs`: the JSDoc checker (vendored from Effect; don't edit it), the example check, which checks
  the guides' TypeScript too, `INDEX.md` and the API reference dataset, with what TypeScript reads in every example
  and guide block (`code.json`).
- `packages/tools/utils`: barrel codegen; `clean`, which `pnpm build` runs first, so no earlier build's output is
  published; and `pack-check`, which checks what the published packages would be: each one packed, installed in a
  project of its own with only its peers, imported under Node and type-checked under `nodenext`, with its MIT
  `LICENSE`.
- `packages/tools/codegen`: protocol code generation. `protocols/<backend>/` holds the vendored spec (`source/`),
  corrections (`patches/`), our annotations (`overlay/`), and the generated `model.json` and `coverage.json`. Its
  output is `packages/browser/src/cdp/`, `packages/browser/src/bidi-protocol/`,
  `packages/browser/src/webkit-stock-protocol/` (stock WebKit's inspector, from WebKitGTK's source) and
  `packages/browser/src/webkit-automation-protocol/` (stock WebKit's Automation domain). Never edit generated files:
  change a correction or an annotation and run `pnpm codegen:protocol`. A correction says what the spec states,
  what the wire does, and the evidence. On a roll, `pnpm codegen:audit` lists the corrections the new spec has
  absorbed. `keyboards/source/` holds Unicode CLDR's keyboard layouts, which `pnpm codegen:keyboards` turns into
  `packages/browser/src/internal/keyboardLayouts.ts`. Each `source/` keeps its license beside it; a new source
  whose output is published adds its notice to `packages/browser/THIRD_PARTY_NOTICES.md`, and a roll updates it.
- `.github/workflows/`: CI. `checks.yml` runs `pnpm all`, `pnpm build` and `pnpm pack-check` on every pull
  request and every push to `main`, in the Nix environment's default shell; `integration.yml` runs the integration tests nightly when
  `main` has changed, and on demand, keeping the log of a failed run.
- `website/`: the documentation site, built as effect.website is: Astro, MDX, Expressive Code, remark and Tailwind, in
  the design `website/README.md` describes. Guides are MDX in `website/src/content/docs/`, and their TypeScript is
  type-checked as the JSDoc examples are. The API reference is rendered from the dataset `pnpm api-reference` writes,
  which isn't committed, so run `pnpm reference` before `pnpm website` (the dev server) or `pnpm website:build`.
  `website/README.md` says how it fits together.
- `.repos/`: read-only references cloned by `scripts/worktree-setup.sh`, such as Effect's sources and its
  `.agents/skills`. Never import from them.
- `.agents/skills/`: the repository's skills, which `pnpm install` links at `.claude/skills`. `review-guides`
  reviews the guides and fixes what it finds.

## Validation

Use the narrowest check that covers the change:

| Change                                | Run                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source, scenarios or configuration    | `pnpm check`, `pnpm lint-fix`                                                                                                            |
| A new, renamed or removed module      | `pnpm codegen`, then `pnpm check`                                                                                                        |
| Protocol corrections or annotations   | `pnpm codegen:protocol`, then `pnpm check` and `pnpm test --run packages/browser/test/Drift.test.ts`                                     |
| Keyboard layouts                      | `pnpm codegen:keyboards`, then `pnpm test --run packages/browser/test/Keys.test.ts`                                                      |
| Runtime behavior                      | `pnpm test --run <file>`                                                                                                                 |
| The protocol client or transports     | `pnpm test --run packages/browser/test/CdpConnection.test.ts packages/browser/test/ProtocolClient.test.ts`, then `pnpm test:integration` |
| A backend adapter or launcher         | `pnpm test:integration`                                                                                                                  |
| The model, engine, locators or pages  | `pnpm test:integration packages/browser/test/integration/adapter packages/browser/test/integration/slice`                                |
| The `strider` command                 | `pnpm test --run packages/browser/test/Browsers.test.ts`, `pnpm test:integration packages/browser/test/integration/Cli.test.ts`          |
| Access rules or other type behavior   | `pnpm test-types`                                                                                                                        |
| JSDoc text, categories or links       | `pnpm jsdocs`                                                                                                                            |
| JSDoc examples                        | `pnpm lint-fix`, which formats them, then `pnpm jsdocs` and `pnpm examples`                                                              |
| A guide's code                        | `pnpm lint-fix`, which formats its blocks, then `pnpm examples`, then `pnpm api-reference` to link it                                    |
| The website or the reference's tools  | `pnpm reference`, then `pnpm website:check` and `pnpm website:build`                                                                     |
| The packages' exports, files or peers | `pnpm build`, then `pnpm pack-check`                                                                                                     |
| Before a commit that touches `src/`   | `pnpm all`, and `pnpm test:integration` if it touches what drives a browser                                                              |

Never run bare `pnpm test`: it starts watch mode. Report any check you couldn't run.

## Conventions

Strider follows the Effect core team's conventions; `docs/conventions.md` records them, and API.md's Conventions
section applies them. Effect's skills in `.repos/effect/.agents/skills` are the reference.

- Modules are namespaces with short names inside (`UserContext.Options`); access levels keep full names
  (`Page.ReadonlyPage`).
- A member with nothing to configure is a value; settings are a trailing `options?: … | undefined`. A `*With`
  member takes a function, never options.
- Data that crosses a boundary is a Schema. Each module has one error, a `Schema.TaggedError` whose `reason` is a
  union of `Schema.Error` classes; reasons several modules share live in `Reason`.
- Library code uses `Effect.fnUntraced`; examples use `Effect.fn("name")`. A function that returns `Effect.gen` is a
  compile error.
- An operation runs through `src/internal/operation.ts` (`Operation.named(name, { attributes })` or
  `Operation.fn`), never `Effect.withSpan` or `Effect.fn`: it gets a record, from which its `Timeout` takes its
  phase, and its span, opened through `src/internal/spans.ts` so `SpanNameGenerator`, `TracerDisabledWhen` and the
  diagnostics preset apply to it; name its target with `browser.page.id`, `browser.context.id` or `browser.realm.id`.
  Work it leaves running, such as a handler's or a recording's, starts through `Operation.apart` or
  `Operation.detached`, never under the operation's deadline. An operation run inside another is a step of it, and a
  `Timeout` that leaves an operation is its own, so never catch a step's `Timeout` to rename it. The public
  `src/Operation.ts` gives users the same over the internal module; the library reads `Operation.Current` only
  optionally, through `Operation.record` and `Operation.current`.
- A deadline, and any wait on the browser, reads the browser's clock (`src/internal/browserClock.ts`), never the
  fiber's `Clock`, which `TestClock` replaces: a real browser's is the live clock, `Browser.layerTest`'s Effect's.
- L1 calls the adapter through `model.adapter`, which `src/internal/boundedAdapter.ts` bounds by the operation a
  call runs in, so an operation's error type includes `Deadline.Timeout`; map adapter failures with
  `Operation.fromAdapter`, which passes it through. A new adapter method is classified there as a read, a write, a
  creation or a release. Cleanup an operation runs, such as a rollback, runs through `Operation.detached`.
- Nothing implicit (principle 23): every default is stated with `@default`, and nothing hidden waits or retries.
- Generated files (sections marked `// @barrel:`, `INDEX.md`, `src/cdp/`, the protocol models) are regenerated, never edited.
- A declaration that isn't built is erased at run time, so a module must not use one as it loads, or re-export one
  under another name; `test/Modules.test.ts` loads every entry point in Node to catch it.

Every public declaration carries Effect's JSDoc contract: one paragraph that starts with what it does; then
optional **When to use** (starting "Use to", "Use when", "Use as" or "Use with"), **Details** and **Gotchas**;
then `**Example** (Title)` sections, each one `` ```ts import.meta.vitest `` fence importing from
`"@usestrider/browser"`; then `@see`, `@stability`, `@category` and `@since`, in that order. Until 1.0, `@stability`
is `unstable`, or `experimental` for what rests on an upstream proposal or an in-flight module, and `@since` is
`0.1.0`.

JSDoc is what the API reference and editors show, so write it for someone using Strider, who has none of the design
documents. Say what a declaration does and what happens, in plain words; cite no review, principle, rule, quirk
number or section of a design document, and leave out how the API got here. A summary must read right the first
time: "The files a page downloads", not "Downloads a page starts". Words of the design's own, such as obligation,
fold, latched or navigable, become what they mean, unless they are the API's names.

A guide teaches one concept a page, and a section a reader would look for in the sidebar is a page of its own.
Before its first code, a concept gets up to two plain sentences: what goes wrong without it and what it gets the
reader, with no history or scene-setting. Whatever the prose names that a reader would type is shown in a block on
the page, or linked to where it's shown. Every page follows the conventions in `website/README.md`, "Style", so
the guide reads as one. The `review-guides` skill checks all four.

## Design changes

Review and fix in a loop: find what's wrong, fix it, check again. Don't write a review up as a document or commit
one. Ask the maintainer in conversation when a change needs their decision. When the work settles a principle or an
architectural decision, state it in the layer document it belongs to, with its reasons and the alternatives rejected
in `docs/decisions.md`; what was found wrong along the way stays in the commits and the issues.
Keep the documents at even depth and never cut detail to balance them.
Playwright and other prior art are evidence of what works, not a template.

## Issues

Work that isn't done in the change at hand goes in an issue, never into a Markdown file: a bug you found, a browser
behaving oddly or differently from the others, a compromise in Strider it forced, a probe to run, an open question, a
follow-up. The body says what it is, where it was seen (with the browser builds), what Strider does now, and what to
reconsider or decide. Search first, and comment on an existing issue rather than filing it twice.

- **Anyone else:** use GitHub. File with `gh issue create --title "…" --body "…"`, search with
  `gh issue list --search "…"`, and comment with `gh issue comment 12 --body "…"`. The repository is public, so write
  for anyone to read.
- **The maintainer's own agents,** where the `clutch` command is on your `PATH`: use the private Clutch board. File with
  `clutch issue new --title "…" --body "…"`, and leave it unassigned: assigning an agent queues a run, which is the
  maintainer's call. Use `--parent` for work that belongs to a larger issue and `--blocked-by` for what must come
  first. Search with `clutch issue list --search "…"`, and comment with `clutch comment ROOK-12 --body "…"`.

Commits and code comments cite GitHub issues by number (`#51`). Everything public has to make sense to someone who
can't open the board, so a comment explains the behavior itself.

A test that fails only in full runs is an issue too: trace it from the protocol's messages and fix the cause, never
with a retry or a delay. Reproducing it under load (many processes beside busy loops) makes the machine unusable,
so ask the maintainer first.
