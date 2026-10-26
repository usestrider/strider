# Strider

This repository is Strider (`@usestrider/browser` on npm): Effect-native browser automation that speaks CDP, WebDriver
BiDi and the WebKit inspector protocol directly. It is at the design stage. L0, the protocol layer, is built, and
ten slices run through L1 and L2 on every backend (reviews 12, 13, 14, 16, 17, 18, 19 and 20's three steps: actions,
events, every event module, interacting and asserting, declarations, a page's contents, attaching and access, the rest
of the API surface with capabilities and the test layers, recordings, and the agent toolkit with the `strider` CLI);
the rest of the package's modules are declarations,
type-checked and documented, which the implementation replaces module by module. A member of an object that isn't
built yet fails as the defect `NotBuilt`, naming itself (`src/internal/notBuilt.ts`), never as a no-op. Use `pnpm`
from the repository root.

## Layout

- Design documents are at the root: `README.md` (goals, principles, status), `API.md` (L2, the public API),
  `CONCEPTS.md` (L1, the native model), `PROTOCOL.md` (L0), `CLI.md` and `PROBES.md`. `QUIRKS.md` lists the weird
  behaviors found while building, browsers' and our own, to reconsider once the library is built.
- `reviews/` holds one design review per draft; `research/` holds prior-art notes; `upstream/` holds drafts of
  proposals for other projects, which the maintainer posts. Reviews and research are records of their time: don't
  rewrite them.
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
    155.0.8059.79, Firefox 158.0, Playwright's WebKit build 2359), fixed fonts, UTC, `C.UTF-8`, an empty home that
    is deleted after, and no display. Run anywhere else, they fail and say so; a browser of another version fails
    them too. Extra arguments go to Vitest (`pnpm test:integration packages/browser/test/integration/WebKit.test.ts`).
    `test/integration/adapter/` is the adapter conformance suite, written once and run against each backend, with
    the engine's tests; `test/integration/slice/` runs the public API through each backend's layer. With
    `STRIDER_RECORD` naming an absolute directory, the integration tests record each browser's traffic for the
    drift test (`test/integration/record.ts`): `pnpm test:integration --no-file-parallelism`, into
    `test/fixtures/traffic/`, when a browser rolls.
  - `INDEX.md`: every declaration and member, generated.
- `packages/tools/docs`: the JSDoc checker (vendored from Effect; don't edit it), the example check, `INDEX.md` and
  the API reference dataset.
- `packages/tools/utils`: barrel codegen.
- `packages/tools/codegen`: protocol code generation. `protocols/<backend>/` holds the vendored spec (`source/`),
  corrections (`patches/`), our annotations (`overlay/`), and the generated `model.json` and `coverage.json`. Its
  output is `packages/browser/src/cdp/`, `packages/browser/src/bidi-protocol/` and
  `packages/browser/src/webkit-protocol/`. Never edit generated files:
  change a correction or an annotation and run `pnpm codegen:protocol`. A correction says what the spec states,
  what the wire does, and the evidence. On a roll, `pnpm codegen:audit` lists the corrections the new spec has
  absorbed.
- `.repos/`: read-only references cloned by `scripts/worktree-setup.sh`, such as Effect's sources and its
  `.agents/skills`. Never import from them.

## Validation

Use the narrowest check that covers the change:

| Change                               | Run                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source, scenarios or configuration   | `pnpm check`, `pnpm lint-fix`                                                                                                            |
| A new, renamed or removed module     | `pnpm codegen`, then `pnpm check`                                                                                                        |
| Protocol corrections or annotations  | `pnpm codegen:protocol`, then `pnpm check` and `pnpm test --run packages/browser/test/Drift.test.ts`                                     |
| Runtime behavior                     | `pnpm test --run <file>`                                                                                                                 |
| The protocol client or transports    | `pnpm test --run packages/browser/test/CdpConnection.test.ts packages/browser/test/ProtocolClient.test.ts`, then `pnpm test:integration` |
| A backend adapter or launcher        | `pnpm test:integration`                                                                                                                  |
| The model, engine, locators or pages | `pnpm test:integration packages/browser/test/integration/adapter packages/browser/test/integration/slice`                                |
| The `strider` command                | `pnpm test --run packages/browser/test/Browsers.test.ts`, `pnpm test:integration packages/browser/test/integration/Cli.test.ts`          |
| Access rules or other type behavior  | `pnpm test-types`                                                                                                                        |
| JSDoc text, categories or links      | `pnpm jsdocs`                                                                                                                            |
| JSDoc examples                       | `pnpm jsdocs`, then `pnpm examples`                                                                                                      |
| Before a commit that touches `src/`  | `pnpm all`, and `pnpm test:integration` if it touches what drives a browser                                                              |

Never run bare `pnpm test`: it starts watch mode. Report any check you couldn't run.

## Conventions

Strider follows the Effect core team's conventions; `reviews/07-effect-conventions.md` records them, and API.md's
Conventions section applies them. Effect's skills in `.repos/effect/.agents/skills` are the reference.

- Modules are namespaces with short names inside (`UserContext.Options`); access levels keep full names
  (`Page.ReadonlyPage`).
- A member with nothing to configure is a value; settings are a trailing `options?: … | undefined`. A `*With`
  member takes a function, never options.
- Data that crosses a boundary is a Schema. Each module has one error, a `Schema.TaggedError` whose `reason` is a
  union of `Schema.Error` classes; reasons several modules share live in `Reason`.
- Library code uses `Effect.fnUntraced`; examples use `Effect.fn("name")`. A function that returns `Effect.gen` is a
  compile error.
- An operation's span is opened through `src/internal/spans.ts` (`Spans.operation(name, { attributes })` or
  `Spans.fn`), never `Effect.withSpan` or `Effect.fn`, so `SpanNameGenerator`, `TracerDisabledWhen` and the
  diagnostics preset apply to it; name its target with `browser.page.id`, `browser.context.id` or `browser.realm.id`.
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

## Design changes

A change to the design starts as a review in `reviews/NN-….md`, committed on its own, and is then applied as a
revision recorded in the README's Status. Keep the documents at even depth and never cut detail to balance them.
Playwright and other prior art are evidence of what works, not a template.

When a probe or a build turns up something weird (a browser behaving oddly or differently from the others, or a
compromise in Strider it forced), add it to `QUIRKS.md` in the same commit, with the next number: what it is, where
it was seen, what Strider does now, and what to reconsider. Entries are never removed, only marked **Resolved**,
**Kept** or **Reported**, as `QUIRKS.md` says. A test that fails only in full runs is a quirk too: reproduce it by
running that test in many processes at once beside busy loops, trace it from the protocol's messages, and fix the
cause, never with a retry or a delay (review 21 found Q69 and Q149 this way).
