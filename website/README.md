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
and labels, and IBM Plex Mono for code, all self-hosted from Fontsource (`astro.config.ts`). Night paper follows the
reader's system until they choose with the masthead's toggle. The cover is the engraving's ivory plate, dimmed on night paper.

| Where                                 | What                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/styles/global.css`               | the palette as variables, the type, and the components: labels, badges, callouts      |
| `src/layouts/BaseLayout.astro`        | before first paint, the band: the reader's browser's color, or the one picked         |
| `src/layouts/DocShell.astro`          | the masthead, the band with breadcrumbs, the sidebar, the page and the rail           |
| `src/components/SideNav.astro`        | a sidebar's groups; `SideFilter.astro` narrows the reference's modules as you type    |
| `src/components/Rail.astro`           | what's on the page: a module's categories and declarations, the one being read marked |
| `src/components/BackToTop.astro`      | on every page, a button back to the masthead, shown once the reader is a screen down  |
| `src/components/SiteFooter.astro`     | on every page, the cover's ivory with the mark, documentation and project links     |
| `ec.config.mjs`, `src/features/code/` | code: highlighted in inks that pass 4.5:1 on code ground, a mono title bar with the file and the language |
| `src/components/Mark.astro`           | the silhouette, for the masthead and anything under 64px                              |
| `src/assets/heron-engraving.png`      | the engraving, on the home page only                                               |
| `public/heron.svg`                   | the favicon and T3 project icon                                                   |
| `src/components/Aside.astro`          | callouts in guides: `<Aside type="note">`, `"tip"`, `"caution"` or `"warning"`        |

The band is Chromium blue, Firefox orange, WebKit cyan, Edge green or Opera red, by the brand of the browser the page
is read in, unless the reader clicks Chromium, Firefox or WebKit on the cover, an unmarked easter egg that is
remembered. Each is darkened until white type passes 4.5:1 on it and the color passes as text on paper.

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
| 1. Getting started        | (top)     | introduction, installation, first program, errors, deadlines, Playwright users |
| 2. Pages and locators     | `pages/`  | locators, actions, expectations and reads, contexts, attached browsers |
| 3. Events and the network | `events/` | events, navigations, popups, dialogs and downloads, requests and responses, routes, init scripts, page clock |
| 4. Testing and recordings | `tools/`  | Vitest, traces and HAR files |
| 5. Agents and the command line | `agents/` | snapshots, the agent toolkit, the `strider` CLI |
| 6. Browsers               | `browsers/` | browser support, Chromium, Firefox, WebKit                |

The browser pages render each backend's capabilities with `<Capabilities />` (every backend, side by side) and
`<BrowserLimits browser="firefox" />` (one backend's limits, `when="attached"` for what attaching changes). Both read
`capabilities.json`, which `pnpm api-reference` writes from the adapters' own tables; their labels and groups are in
`src/features/browsers/capabilities.ts`, and a capability without a label shows under its name, in "Other".

Code blocks render through Expressive Code (`ec.config.mjs`), and a title names a file: `` ```ts title="checkout.ts" ``.
A guide's TypeScript is type-checked by `pnpm examples`, with the JSDoc examples, so each block is a module of its
own, with its imports; `@effect/platform-node` is a dev dependency of the repository's root so blocks can import
it. Blocks are formatted as the repository's code is, with Effect's dprint settings, at 88 characters, the width
of the column: `pnpm lint-fix` formats them and `pnpm lint` checks them (`strider-docs format`). The JSDoc examples
are formatted the same way, inside their comments, so the reference shows them unwrapped. dprint keeps the line
breaks it's given where they fit, so lay a block out to read well, naming a value rather than nesting a call four
deep.

### Style

What every guide does the same way. The `review-guides` skill holds pages to it, and proposes a convention where
the guide disagrees with itself; one is added here once the maintainer agrees.

- **Openings.** A page opens, before its first section, with up to two plain sentences: what goes wrong without its
  concept, and what the reader gets. A section introducing a concept does the same before its first code. No
  history, scene-setting or praise.
- **Examples.** Whatever the prose names that a reader would type is shown in a block on the page, or linked to
  where it's shown. A block is one realistic task, written as a step with `Effect.fn`, that reads data through its
  types, such as a body decoded with a Schema, never `JSON.stringify`. Messages and hints are quoted from the
  source, and command output from a real run. A step takes what it works on; a block about getting a browser,
  context or connection gets it inside its step. A step uses `Effect.scoped` only for what must end with it, such
  as a page or context it opens, a recording or a temporary setting; one that subscribes or registers on a page it
  was given leaves the scope to its caller. Layers, schemas, test callbacks, segment exports, handlers passed to a
  combinator, functions run in the page, conditions and patterns, locator helpers and the program that runs the
  steps aren't steps. A handler becomes `Effect.fn` only when it needs a generator. A tracer is provided to the
  program, outside every span it should record.
- **Titles and headings.** A page's title names its subject as a noun phrase (Locators, Actions, Tests with Vitest).
  A section heading is a noun phrase for a subject or an -ing form for a procedure (Launching, Recovering), never
  a sentence or a fragment of one, and never the page's title again: Locators has "The queries". Parallel pages
  give the same section the same heading, and a heading on two pages means the same thing on both. A heading may
  join two words for one subject, as Handlers and decisions does.
- **Decks.** A page's `description` is one noun phrase for what it covers, in the order of its sections: "A page's
  requests and responses as events, their bodies decoded with a Schema, who answered them, the headers they sent,
  and resending a request." The opening, not the deck, says why.
- **Names.** One thing has one name on every page, the reference's: an endpoint, not an address. A session is the
  `strider` CLI's, or a protocol's own, CDP's or BiDi's, as the reference names it; a context has its own cookies
  and storage.
- **Browser differences.** A concept page says what a browser does differently where it teaches the feature, such
  as "not on WebKit" in an action's row, not in a closing section. Only a browser's own page collects them.
- **Links.** A link's text names what it links to: "Call [`page.activate`](…)", never "([reference](…))",
  "(example)", "(how)" or "(below)".
- **Sections.** A section holds one thing a reader looks for. One of a sentence or two joins its neighbour; one
  many times the page's median splits at its own subject.
- **Hosts.** `shop.example.com` for commerce, `app.example.com` for accounts and dashboards, `mail.example.com` for
  mail; another host only for what's its own, such as a payment provider, a map, staging or a cross-origin API;
  `example.test` for the fake browser's timeline.
- **Devices.** Paragraphs explain, lists hold parallel rules, tables compare; bold-led paragraphs only in a
  browser page's differences. A list's items may lead in bold when all of them do, as Introduction's do. No
  callout boxes, no one-item lists.

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
