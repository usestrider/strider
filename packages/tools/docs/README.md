# @usestrider/docs-tools

Private tools that check Strider's JSDoc and generate its reference. Run them from the repository root:

| Script                | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm jsdocs`         | Effect's own JSDoc checker, vendored in `src/jsdocs/`; writes its model to `.data/jsdocs.json`     |
| `pnpm examples`       | type-checks every `**Example**` from that model, and every guide's TypeScript, against the source  |
| `strider-docs format` | formats every guide's TypeScript and JSON blocks with dprint; `pnpm lint` runs it with `--check`   |
| `pnpm index`          | writes `packages/browser/INDEX.md`                                                                 |
| `pnpm api-reference`  | writes the API reference dataset to `.data/api-reference/`, with what TypeScript reads in the code |
| `pnpm reference`      | `jsdocs`, `examples`, `index` and `api-reference`, in order                                        |
| `strider-docs audit`  | lists, for each guide, what its review checks (below); `--json` for the data, page ids for some    |

`strider-docs audit` reads the guides in the site's reading order and lists candidates for a reviewer, never
errors: pages long enough (over 700 words of prose or 7 sections) or titled with "and" so they may hold more than one
concept; pages with no paragraph before their first section, and sections with under 15 words before their first
code; and each name the prose puts in inline code that no block on the page uses, with whether another guide shows it
and whether this page links there. A name counts when the public packages' own source uses it as an identifier,
which leaves out HTML attributes, DOM names and plain values. It also lists links to a guide or a heading that
doesn't exist, with headings' anchors made as the site makes them; links into the reference aren't checked. With
`--consistency`, it compares the pages instead: the form of each title and heading (a name, a gerund such as
"Finding elements", a phrase, a title's article), code blocks per 100 words of prose against the median, the sites
examples visit, `declare const` blocks, callouts and bold-label paragraphs, and each page's section lengths.

Once the modules are implemented, `@effect/doctest` runs the examples instead of only type-checking them: the fences
are already marked `ts import.meta.vitest`.

The guides' TypeScript blocks (`ts` or `typescript` fences in the MDX of `website/src/content/docs/`, in lists and
quotes too) are checked in the same `tsc` run, with the same settings. An error in one names the guide, the line and
the column, `website/src/content/docs/index.mdx(18,5): error TS2322: …`.

dprint formats the repository with Effect's own settings (`dprint.json`), but it reads Markdown, not MDX, so
`strider-docs format` formats the guides' blocks itself: each TypeScript or JSON block goes through
`dprint fmt --stdin` with those settings and a line width of 88, the width of the site's column, and is written back
in place. `pnpm lint-fix` runs it, and `pnpm lint` runs it with `--check`, naming each block that isn't formatted.

## The API reference dataset

`pnpm api-reference` writes what effect.website renders Effect's reference from, so a site can render ours the same
way:

```
.data/api-reference/
  <package>/
    manifest.json        package, version, git revision, TypeDoc version; barrels; one entry per module
    modules/<path>.json  TypeDoc's JSON (schema 2.0) for one module, e.g. modules/Page.json, modules/chromium/Chromium.json
    jsdocs.json          the effect-jsdocs model: every API with parsed sections, examples, tags, @see links and import guidance
  code.json              what TypeScript reads in every example and guide block: classification, quick info, targets
```

Each manifest entry gives the module's name (`@usestrider/browser/Page`), its export path, its source file, its JSON
file with a SHA-256, and the barrel it is re-exported from (`@usestrider/browser`), which is how a page shows
`import { Page } from "@usestrider/browser"`.

Modules are found from the package's export map, as Effect's site finds them: every file a pattern matches, except
barrels (marked `// @barrel:`) and `internal/`. TypeDoc runs per module with `@stability` added to its block tags and
external symbols excluded, which keeps inherited Schema members out. Effect-style modules open with an untagged JSDoc
block, which TypeDoc ignores, so the script attaches it as the module's comment. A type the source writes is
converted from its type node, not from the type the checker resolved: the checker loses the name of an alias such as
`type PageNavigation = typeof PageNavigation.Type`, so `page.goto`'s return type would read as four object types
instead of `Effect.Effect<PageNavigation.PageNavigation, …>`.

How effect.website renders it (Effect-TS/website, `packages/api-reference` and `apps/web/src/features/api-reference`):
an Astro content loader reads the manifest and module files; a page per module lists declarations grouped by
`@category`, with a stability badge; the JSDoc's bold-only paragraphs (**When to use**, **Details**, **Gotchas**,
**Example**) become section headings; examples render as code. That repository has no license, so this script is our
own, written against TypeDoc's documented API; `jsdocs.json` already has the sections split out, for a site that
would rather not parse rendered Markdown.

Strider's site, `website/`, renders the dataset the same way (`website/src/features/reference/`), with the
manifest's `categoryOrder` (INDEX.md's order, `src/categories.mjs`) and `repository` for source links.

Effect publishes on release: once npm serves the new version, a `repository_dispatch` event
(`publish-api-reference`, with the commit) tells the website repository to check out that commit and regenerate.
Source links in the dataset point at the git remote.

### The code

`code.json` is what TypeScript's language service reads in every block of code the documentation shows: each
package's JSDoc examples and the guides' TypeScript blocks (`src/code.mjs`). One language service holds them all,
with the tests' compiler options, as the example check reads them, so the whole pass takes about two seconds. Each block is written once, however many places show it:

```json
{
  "typescript": "6.0.3",
  "blocks": [{
    "key": "dd46ea0c…",
    "lang": "ts",
    "code": "import { Effect } from \"effect\"\n…",
    "sources": [{ "api": "@usestrider/browser/Browser.newPage", "title": "A page for one test" }],
    "identifiers": [{
      "start": 245,
      "length": 4,
      "type": "member",
      "modifiers": [],
      "quickInfo": {
        "display": "(method) Page.goto(url: Url | string, …): Effect.Effect<…>",
        "documentation": "Navigates to `url`; …"
      },
      "target": { "module": "@usestrider/browser/Page", "name": "Page.goto" }
    }]
  }]
}
```

- `key` is the SHA-256, in hex, of the block's language, a newline and its code, so a site finds a block from what
  it renders. An example's language is `ts`; a guide block's is its fence's. A guide's `sources` give its path and
  the line its code starts on.
- `type` and `modifiers` are TypeScript's 2020 semantic classification, by name (`class`, `interface`, `namespace`,
  `function`, `member`, `parameter`, `variable`, `property`, …; `declaration`, `readonly`, `defaultLibrary`, …).
  TypeScript leaves a module's namespace unclassified (`import { Effect } from "effect"`, `export * as Page`); here
  it is a `namespace`.
- `quickInfo` is what hovering the identifier in an editor shows, shortened as an editor shortens it, and the first
  paragraph of its JSDoc.
- `target` is the documented declaration the identifier names: a module of the manifests, and the declaration's
  name there, a member as `Page.goto`, or none for the module itself. It is found along the identifier's aliases, so
  `Browser` in `import { Browser } from "@usestrider/browser"` names the module, and an object literal's key names the
  property of the type it fills (`emulation` in `newPage({ emulation })` is `UserContext.Options.emulation`). Only
  declarations TypeDoc's JSON has, and their members, are targets.
