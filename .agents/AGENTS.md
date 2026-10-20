# Strider

This repository is Strider (`@usestrider/browser` on npm): Effect-native browser automation that speaks CDP, WebDriver
BiDi and the WebKit inspector protocol directly. It is at the design stage: the package's modules are declarations,
type-checked and documented, and the implementation replaces them module by module, starting at L0, the protocol
layer. Use `pnpm` from the repository root.

## Layout

- Design documents are at the root: `README.md` (goals, principles, status), `API.md` (L2, the public API),
  `CONCEPTS.md` (L1, the native model), `PROTOCOL.md` (L0), `CLI.md` and `PROBES.md`.
- `reviews/` holds one design review per draft; `research/` holds prior-art notes; `upstream/` holds drafts of
  proposals for other projects, which the maintainer posts. Reviews and research are records of their time: don't
  rewrite them.
- `packages/browser` is the published package:
  - `src/`: one module per file, exported as namespaces. `src/index.ts` and each subpath's `index.ts` are generated.
    `src/internal/` is implementation that no subpath exports, such as the protocol client and CDP's wire.
  - `scenarios/`: the acceptance scenarios from API.md, type-checked as ordinary code.
  - `typetest/`: Tstyche tests of access rules, requirement channels and what crosses by value.
  - `test/`: runtime tests with `@effect/vitest`. `test/integration/` drives a real Chromium: set `STRIDER_CHROMIUM`, or
    put Chromium or Chrome on `PATH`; without one, those tests are reported as skipped.
  - `INDEX.md`: every declaration and member, generated.
- `packages/tools/docs`: the JSDoc checker (vendored from Effect; don't edit it), the example check, `INDEX.md` and
  the API reference dataset.
- `packages/tools/utils`: barrel codegen.
- `packages/tools/codegen`: protocol code generation. `protocols/<backend>/` holds the vendored spec (`source/`),
  corrections (`patches/`), our annotations (`overlay/`), and the generated `model.json` and `coverage.json`. Its
  output is `packages/browser/src/cdp/`. Never edit generated files: change a correction or an annotation and run
  `pnpm codegen:protocol`. A correction says what the spec states, what the wire does, and the evidence.
- `.repos/`: read-only references cloned by `scripts/worktree-setup.sh`, such as Effect's sources and its
  `.agents/skills`. Never import from them.

## Validation

Use the narrowest check that covers the change:

| Change                              | Run                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Source, scenarios or configuration  | `pnpm check`, `pnpm lint-fix`                                                                                                                |
| A new, renamed or removed module    | `pnpm codegen`, then `pnpm check`                                                                                                            |
| Protocol corrections or annotations | `pnpm codegen:protocol`, then `pnpm check`                                                                                                   |
| Runtime behavior                    | `pnpm test --run <file>`                                                                                                                     |
| The protocol client or transports   | `pnpm test --run packages/browser/test/CdpConnection.test.ts packages/browser/test/ProtocolClient.test.ts packages/browser/test/integration` |
| Access rules or other type behavior | `pnpm test-types`                                                                                                                            |
| JSDoc text, categories or links     | `pnpm jsdocs`                                                                                                                                |
| JSDoc examples                      | `pnpm jsdocs`, then `pnpm examples`                                                                                                          |
| Before a commit that touches `src/` | `pnpm all`                                                                                                                                   |

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
- Nothing implicit (principle 23): every default is stated with `@default`, and nothing hidden waits or retries.
- Generated files (sections marked `// @barrel:`, `INDEX.md`, `src/cdp/`, the protocol models) are regenerated, never edited.

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
