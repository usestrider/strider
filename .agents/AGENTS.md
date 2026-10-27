# Strider

This repository is Strider (`@usestrider/browser` on npm): Effect-native browser automation that speaks CDP, WebDriver
BiDi and the WebKit inspector protocol directly. It is pre-release. All three layers are built, on Chromium, Firefox
and stock WebKit, and every member the API declares is built. One declared before it is built fails as the defect
`NotBuilt`, naming itself (`src/internal/notBuilt.ts`), never as a no-op. Use `pnpm` from the repository root.

## Layout

- Design documents are at the root: `README.md` (goals, principles, status), `API.md` (L2, the public API),
  `CONCEPTS.md` (L1, the native model), `PROTOCOL.md` (L0), `CLI.md` and `PROBES.md`. `QUIRKS.md` lists the weird
  behaviors found while building, browsers' and our own, to reconsider once the library is built.
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
- `packages/scenarios`: private, never published: Strider and Playwright side by side on the integration
  environment's Chromium. `pnpm scenarios` writes its `RESULTS.md`; `pnpm scenarios --record` visits
  the public demo sites once, live, into `.data/scenarios/`. Playwright (`playwright-core`) is this package's
  dependency alone: never import it elsewhere.
- `packages/tools/docs`: the JSDoc checker (vendored from Effect; don't edit it), the example check, which checks
  the guides' TypeScript too, `INDEX.md` and the API reference dataset, with what TypeScript reads in every example
  and guide block (`code.json`).
- `packages/tools/utils`: barrel codegen; `clean`, which `pnpm build` runs first, so no earlier build's output is
  published; and `pack-check`, which checks what the published packages would be: each one packed, installed in a
  project of its own with only its peers, imported under Node and type-checked under `nodenext`.
- `packages/tools/codegen`: protocol code generation. `protocols/<backend>/` holds the vendored spec (`source/`),
  corrections (`patches/`), our annotations (`overlay/`), and the generated `model.json` and `coverage.json`. Its
  output is `packages/browser/src/cdp/`, `packages/browser/src/bidi-protocol/`,
  `packages/browser/src/webkit-stock-protocol/` (stock WebKit's inspector, from WebKitGTK's source) and
  `packages/browser/src/webkit-automation-protocol/` (stock WebKit's Automation domain). Never edit generated files:
  change a correction or an annotation and run `pnpm codegen:protocol`. A correction says what the spec states,
  what the wire does, and the evidence. On a roll, `pnpm codegen:audit` lists the corrections the new spec has
  absorbed. `keyboards/source/` holds Unicode CLDR's keyboard layouts, which `pnpm codegen:keyboards` turns into
  `packages/browser/src/internal/keyboardLayouts.ts`.
- `.github/workflows/`: CI. `checks.yml` runs `pnpm all`, `pnpm build` and `pnpm pack-check` on every push and
  pull request, in the Nix environment's default shell; `integration.yml` runs the integration tests nightly when
  `main` has changed, and on demand, keeping the log of a failed run.
- `website/`: the documentation site, built as effect.website is: Astro, MDX, Expressive Code, remark and Tailwind, in
  the design `website/README.md` describes. Guides are MDX in `website/src/content/docs/`, and their TypeScript is
  type-checked as the JSDoc examples are. The API reference is rendered from the dataset `pnpm api-reference` writes,
  which isn't committed, so run `pnpm reference` before `pnpm website` (the dev server) or `pnpm website:build`.
  `website/README.md` says how it fits together.
- `.repos/`: read-only references cloned by `scripts/worktree-setup.sh`, such as Effect's sources and its
  `.agents/skills`. Never import from them.

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
| JSDoc examples                        | `pnpm jsdocs`, then `pnpm examples`                                                                                                      |
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
  Work it leaves running, such as a handler's or a recording's, starts through `Operation.deciding` or
  `Operation.detached`, never under the operation's deadline.
- A deadline, and any wait on the browser, reads the browser's clock (`src/internal/browserClock.ts`), never the
  fiber's `Clock`, which `TestClock` replaces: a real browser's is the live clock, `Browser.layerTest`'s Effect's.
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

## Design changes

Review and fix in a loop: find what's wrong, fix it, check again. Don't write a review up as a document or commit
one. Ask the maintainer in conversation when a change needs their decision. When the work settles a principle or an
architectural decision, state it in the layer document it belongs to, with its reasons and the alternatives rejected
in `docs/decisions.md`; what was found wrong along the way stays in the commits and `QUIRKS.md`.
`reviews/26-operations.md` is left from an earlier practice: delete it once its last step is built.
Keep the documents at even depth and never cut detail to balance them.
Playwright and other prior art are evidence of what works, not a template.

When a probe or a build turns up something weird (a browser behaving oddly or differently from the others, or a
compromise in Strider it forced), add it to `QUIRKS.md` in the same commit, with the next number: what it is, where
it was seen, what Strider does now, and what to reconsider. Entries are never removed, only marked **Resolved**,
**Kept** or **Reported**, as `QUIRKS.md` says. A test that fails only in full runs is a quirk too: trace it from the protocol's messages and fix the cause, never
with a retry or a delay. Reproducing it under load (many processes beside busy loops) makes the machine unusable,
so ask the maintainer first.
