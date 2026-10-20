# @usestrider/docs-tools

Private tools that check Strider's JSDoc and generate its reference. Run them from the repository root:

| Script               | What it does                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm jsdocs`        | Effect's own JSDoc checker, vendored in `src/jsdocs/`; writes its model to `.data/jsdocs.json` |
| `pnpm examples`      | type-checks every `**Example**` from that model against the package's source                   |
| `pnpm index`         | writes `packages/browser/INDEX.md`                                                             |
| `pnpm api-reference` | writes the API reference dataset to `.data/api-reference/`                                     |
| `pnpm reference`     | all four, in order                                                                             |

Once the modules are implemented, `@effect/doctest` runs the examples instead of only type-checking them: the fences
are already marked `ts import.meta.vitest`.

## The API reference dataset

`pnpm api-reference` writes what effect.website renders Effect's reference from, so a site can render ours the same
way:

```
.data/api-reference/
  manifest.json          package, version, git revision, TypeDoc version; barrels; one entry per module
  modules/<path>.json    TypeDoc's JSON (schema 2.0) for one module, e.g. modules/Page.json, modules/chromium/Chromium.json
  jsdocs.json            the effect-jsdocs model: every API with parsed sections, examples, tags, @see links and import guidance
```

Each manifest entry gives the module's name (`@usestrider/browser/Page`), its export path, its source file, its JSON
file with a SHA-256, and the barrel it is re-exported from (`@usestrider/browser`), which is how a page shows
`import { Page } from "@usestrider/browser"`.

Modules are found from the package's export map, as Effect's site finds them: every file a pattern matches, except
barrels (marked `// @barrel:`) and `internal/`. TypeDoc runs per module with `@stability` added to its block tags and
external symbols excluded, which keeps inherited Schema members out. Effect-style modules open with an untagged JSDoc
block, which TypeDoc ignores, so the script attaches it as the module's comment.

How effect.website renders it (Effect-TS/website, `packages/api-reference` and `apps/web/src/features/api-reference`):
an Astro content loader reads the manifest and module files; a page per module lists declarations grouped by
`@category`, with a stability badge; the JSDoc's bold-only paragraphs (**When to use**, **Details**, **Gotchas**,
**Example**) become section headings; examples render as code. That repository has no license, so this script is our
own, written against TypeDoc's documented API; `jsdocs.json` already has the sections split out, for a site that
would rather not parse rendered Markdown.

Effect publishes on release: once npm serves the new version, a `repository_dispatch` event
(`publish-api-reference`, with the commit) tells the website repository to check out that commit and regenerate.
Source links in the dataset point at the git remote.
