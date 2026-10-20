# sketch

The whole public API of Strider (`@usestrider/browser`), declared in the package's real shape and checked. Nothing here runs: functions are `declare`d, while Schemas, errors and guards are written out, because their types come from the code. When implementation starts, each module's declarations are replaced by code and its JSDoc stays.

## Layout

| Path | What |
|---|---|
| `src/*.ts` | the main entry's modules, one per file, exported as namespaces by `src/index.ts` |
| `src/{chromium,firefox,webkit,bidi,ai,test,test/vitest,cli}/` | the subpath entry points, each with its own barrel |
| `scenarios/` | the acceptance scenarios and call sites, type-checked as ordinary code |
| `typetest/` | Tstyche tests: access rules, requirement channels, what crosses by value |
| `scripts/` | the barrel, examples, index and API reference generators |
| `INDEX.md` | every declaration and member, one line each (generated) |

## Scripts

| Script | What it does |
|---|---|
| `npm run check` | `tsc` (strict, `exactOptionalPropertyTypes`), barrels up to date, and Effect's language service with `effectFnOpportunity` as an error |
| `npm run barrel` | rewrites each entry point's barrel in Effect's format: `export * as X`, with each module's `@stability` and `@since` |
| `npm run jsdocs` | Effect's own JSDoc checker, `effect-jsdocs --check`, which also writes its model to `.data/jsdocs.json` |
| `npm run examples` | type-checks every `**Example**` from that model against the sketch |
| `npm run test-types` | the Tstyche type tests |
| `npm run index` | writes `INDEX.md` |
| `npm run api-reference` | writes the API reference dataset to `.data/api-reference/` |
| `npm run all` | all of the above, in order |

`effect-jsdocs` is a private tool in the Effect repository, so `npm run jsdocs` runs it from a checkout: set `EFFECT_REPO`, or keep one at `../../../effect`. It only reads the checkout. Once there is an implementation, `@effect/doctest` (published) runs the examples instead of only type-checking them: the fences are already marked `ts import.meta.vitest`.

## Writing JSDoc

Every public declaration follows Effect's contract (`.agents/skills/jsdocs/` in the Effect repository):

- one paragraph that starts with what it does, then optional **When to use** (starting "Use to", "Use when", "Use as" or "Use with"), **Details** and **Gotchas**, in that order;
- `**Example** (Title)` sections, one fenced ` ```ts import.meta.vitest ` block each, importing from `"@usestrider/browser"` as a user would;
- tags in this order: `@see`, `@stability`, `@category`, `@since`. Roots need all but `@see`; members may add `@default`.

Until 1.0, `@stability` is `unstable`, or `experimental` for what rests on an upstream proposal or an in-flight module. `@since` is `0.1.0`.

## The API reference dataset

`npm run api-reference` writes what effect.website renders Effect's reference from, so a site can render ours the same way:

```
.data/api-reference/
  manifest.json          package, version, git revision, TypeDoc version; barrels; one entry per module
  modules/<path>.json    TypeDoc's JSON (schema 2.0) for one module, e.g. modules/Page.json, modules/chromium/Chromium.json
  jsdocs.json            the effect-jsdocs model: every API with parsed sections, examples, tags, @see links and import guidance
```

Each manifest entry gives the module's name (`@usestrider/browser/Page`), its export path, its source file, its JSON file with a SHA-256, and the barrel it is re-exported from (`@usestrider/browser`), which is how a page shows `import { Page } from "@usestrider/browser"`.

Modules are found from `package.json`'s export map, as Effect's site finds them: every file a pattern matches, except barrels (marked `// @barrel:`) and `internal/`. TypeDoc runs per module with `@stability` added to its block tags and external symbols excluded, which keeps inherited Schema members out. Effect-style modules open with an untagged JSDoc block, which TypeDoc ignores, so the script attaches it as the module's comment.

How effect.website renders it (Effect-TS/website, `packages/api-reference` and `apps/web/src/features/api-reference`): an Astro content loader reads the manifest and module files; a page per module lists declarations grouped by `@category`, with a stability badge; the JSDoc's bold-only paragraphs (**When to use**, **Details**, **Gotchas**, **Example**) become section headings; examples render as code. That repository has no license, so this script is our own, written against TypeDoc's documented API; `jsdocs.json` already has the sections split out, for a site that would rather not parse rendered Markdown.

Effect publishes on release: once npm serves the new version, a `repository_dispatch` event (`publish-api-reference`, with the commit) tells the website repository to check out that commit and regenerate. Source links in the dataset point at the git remote, so they appear once the repository has one.
