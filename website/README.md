# @usestrider/website

Strider's documentation site, built as [effect.website](https://effect.website) is: Astro, with MDX guides,
Expressive Code for code, remark for Markdown, and Tailwind. It follows that site's split, on one site
under one layout:

| Route                          | What it is                                                                  |
| ------------------------------ | --------------------------------------------------------------------------- |
| `/docs`, `/docs/<guide>`       | guides: MDX in `src/content/docs/`                                          |
| `/docs/api`                    | the reference's index: every module, by section                             |
| `/docs/api/<package>/<module>` | one module, e.g. `/docs/api/browser/Page`, `/docs/api/browser/cdp/Network` |

Run it from the repository's root. The reference is rendered from the dataset `pnpm api-reference` writes to
`.data/api-reference/`, which isn't committed, so generate it first:

```sh
pnpm reference        # the JSDoc model, the example check, INDEX.md and the dataset
pnpm website          # the dev server, http://127.0.0.1:4390; regenerating the dataset reloads the reference
pnpm website:check    # type-checks the site
pnpm website:build    # the static site, in website/dist/
```

## The design

After O'Reilly's engineering books: an inked animal, paper and ink, and one band color per page; the only other fills
are engine labels. Structure is drawn with 1px rules, never shadows, rounded corners or tints. Type is set for reading
on a screen: EB Garamond for titles, Source Serif 4 for prose at 18px on a 1.65 leading, IBM Plex Sans for navigation
and labels, and IBM Plex Mono for code, all self-hosted from Fontsource (`astro.config.ts`). The site is light only
for now; the night palette waits in `global.css` for a toggle.

| Where                                 | What                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/styles/global.css`               | the palette as variables, the type, and the components: labels, badges, callouts      |
| `src/layouts/BaseLayout.astro`        | before first paint, the band: the reader's browser's color                            |
| `src/layouts/DocShell.astro`          | the masthead, the band with breadcrumbs, the sidebar, the page and the rail           |
| `src/components/SideNav.astro`        | a sidebar's groups; `SideFilter.astro` narrows the reference's modules as you type    |
| `src/components/Rail.astro`           | what's on the page: a module's categories and declarations, the one being read marked |
| `ec.config.mjs`, `src/features/code/` | code: highlighted in inks that pass 4.5:1 on code ground, a mono title bar with the file and the language |
| `src/components/Mark.astro`           | the silhouette, for the masthead and anything under 64px                              |
| `src/assets/heron-engraving.png`      | the engraving, on the home page only, from `design/strider/heron/`                    |
| `src/components/Aside.astro`          | callouts in guides: `<Aside type="note">`, `"tip"`, `"caution"` or `"warning"`        |

The band is Chromium blue, Firefox orange, WebKit cyan, Edge green or Opera red, by the brand of the browser the page
is read in. Each is darkened until white type passes 4.5:1 on it and the color passes as text on paper.

A module's page reads as effect.website's does: its summary and import line, then each category's declarations, each
with its summary, signature, JSDoc sections, examples and `@see` links. A type's Schema or tag folds into a line
beneath it. An interface's members are listed apart, and left out of its signature, when one of them has docs; an
interface of undocumented fields is shown as its body.

## Guides

A guide is an `.mdx` file in `src/content/docs/` with a `title`, a `description` (its deck) and an `order`.
The chapters are the groups in `src/features/docs/navigation.ts`, each a directory, in order; a page's section,
§ 1.1, is its chapter and its place in it:

| Chapter                   | Directory | Pages                                                         |
| ------------------------- | --------- | ------------------------------------------------------------- |
| 1. Getting started        | (top)     | introduction, installation, a first program, errors and deadlines |
| 2. Pages and locators     | `pages/`  | finding elements, actions, expectations and reads, contexts and access |
| 3. Events and the network | `events/` | events, requests and responses, routes, scripts and time      |
| 4. Testing and tools      | `tools/`  | Vitest, traces and HAR files, agents and the `strider` command |
| 5. Browsers               | `browsers/` | choosing a browser, Chromium, Firefox, WebKit, stock WebKit  |

The browser pages render each backend's capabilities with `<Capabilities />` (every backend, side by side) and
`<BrowserLimits browser="firefox" />` (one backend's limits, `when="attached"` for what attaching changes). Both read
`capabilities.json`, which `pnpm api-reference` writes from the adapters' own tables; their labels and groups are in
`src/features/browsers/capabilities.ts`, and a capability without a label shows under its name, in "Other".

Code blocks render through Expressive Code (`ec.config.mjs`), and a title names a file: `` ```ts title="checkout.ts" ``.
A guide's TypeScript is type-checked by `pnpm examples`, with the JSDoc examples, so each block is a module of its
own, with its imports; `@effect/platform-node` is a dev dependency of the repository's root so blocks can import
it. Blocks are formatted as the repository's code is, with Effect's dprint settings, at 88 characters, the width
of the column: `pnpm lint-fix` formats them and `pnpm lint` checks them (`strider-docs format`). dprint keeps the
line breaks it's given where they fit, so lay a block out to read well, naming a value rather than nesting a call
four deep.

## The reference

`src/features/reference/` turns the dataset into pages:

| File           | What it does                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `loader.ts`    | the `reference` collection: one entry per module, from the manifests, holding only what navigation needs |
| `dataset.ts`   | reads the manifests, a module's TypeDoc JSON (checked against its hash) and the JSDoc model              |
| `view.ts`      | a module's page: declarations by `@category`, each with signatures, JSDoc sections, examples and members |
| `signature.ts` | prints TypeDoc's reflections back as TypeScript, `.d.ts`-style, every documented reference linked        |
| `doc.ts`       | the pretty printer that lays signatures out to a width                                                   |
| `html.ts`      | writes a laid-out signature as HTML, its references linked                                               |
| `markdown.ts`  | renders JSDoc Markdown with remark; inline code that names a declaration links to it                     |
| `sections.ts`  | groups modules by entry point; the generated protocol domains come last, closed                          |

A module's TypeDoc JSON is read when its page renders, never stored in Astro's data store, as effect.website does:
the dataset is about 40 MB, two thirds of it the generated protocol domains.

Prose comes from the JSDoc model (`jsdocs.json`), which has each declaration's sections split out and its import
line; structure, signatures and sources come from TypeDoc. A member the model doesn't list, such as one an interface
inherits from a generic, falls back on TypeDoc's comment, split into the same sections. A type and the value that
shares its name, a model and its Schema or a service and its tag, are one entry. Stability and `@since` are shown on
a declaration only where they differ from its module's.

The dataset also holds `code.json`: what TypeScript read in every example and guide block (each identifier's
classification, quick info and the declaration it names). The site doesn't use it yet; an Expressive Code plugin
could add its links and hovers to code blocks.
