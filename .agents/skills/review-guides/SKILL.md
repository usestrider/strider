---
name: review-guides
description: Review the website's guides for pages that hold more than one concept, concepts rushed without their purpose or benefit, APIs named without an example, and pages out of step with the rest of the guide, then fix them in a loop. Use when asked to review, audit or improve the guides in website/src/content/docs, or one page of them.
---

# Reviewing the guides

The guides are the MDX pages in `website/src/content/docs/`. [rubric.md](rubric.md) holds the four checks: Split,
Orient, Example and Consistent. `website/README.md`, "Style", holds the conventions the guide has agreed. Given page ids (`events/events`), review those pages; given none, the whole guide.

## 1. Audit

```sh
pnpm exec strider-docs audit [page…]          # read it
pnpm exec strider-docs audit --json [page…]   # give it to a reviewer
pnpm exec strider-docs audit --consistency     # compare the pages
```

It lists candidates per page, in reading order: split flags, sections with a short lead before their code, and
names the prose mentions that no block on the page shows. It can't judge; the reviewer does. It also lists links to
a guide or heading that doesn't exist, which must be none before a commit. `--consistency` compares the pages:
their titles' and headings' forms, code blocks per 100 words of prose, the sites examples visit, `declare const`
blocks, callouts and bold-label paragraphs, and section lengths.

## 2. Splits first

For the whole guide, run the split pass before anything else, since a split changes what each page follows. Give a
fresh subagent [reviewer.md](reviewer.md)'s brief for the split pass. Put its findings to the maintainer as one
proposal: for each page, its new pages, what moves where and the sidebar's order.

**Nothing is split without the maintainer's yes.** While waiting, carry on with the pages no proposal touches.

A split, once agreed: write each new page with its frontmatter (`title`, `description`, `order`), renumber the
chapter's `order`s, move the sections and their examples, give each page its own opening, update every link to a
moved section (the audit's `broken` lines list what's left), and update the chapter table in `website/README.md`,
"Guides".

## 3. Consistency, across the guide

After the splits, before the pages: a convention changes many pages at once. Give a fresh subagent
[reviewer.md](reviewer.md)'s brief for the consistency pass, with `audit --consistency`. Put its proposals to the
maintainer as one batch: for each, the convention, the pages it changes, and an example of each change, such as the
titles renamed.

**No convention is adopted without the maintainer's yes.** An agreed one goes into `website/README.md`, "Style",
and the pages are brought to it in the loop below, the reviewer checking Consistent against it.

## 4. Each page, in reading order

1. **Review.** A fresh subagent with [reviewer.md](reviewer.md)'s brief: the rubric, the page, the pages before it
   and the page's audit, and the style. It judges the page as a reader with only the site would, and reads the source to check the
   page's facts and its own proposed fixes.
2. **Fix.** Read the source and JSDoc of whatever an example will use before writing it, so it's right, even when
   the reviewer proposed it. For each
   finding, fix it or decline it with a reason; a fix is as the rubric says and as `website/README.md`, "Guides",
   writes blocks: a module of its own, imports included, a value named rather than a call nested. Quote messages
   and hints from the source.
3. **Check.**

   ```sh
   pnpm lint-fix && pnpm reference && pnpm website:check
   ```

   `pnpm lint-fix` formats the blocks; `pnpm reference` type-checks them (`pnpm examples`) and links them. The
   audit must list no broken links. A link into the reference (`/docs/api/…#…`) isn't checked by either: build
   the site (`pnpm website:build`) and look for the anchor's `id` in `website/dist/`.
4. **Review again,** with a new subagent, given the earlier findings and what was done with each, and the audit
   run again, since lines move. The page is done when a round raises nothing new. Stop after three rounds: fix
   what the third raises, check and commit, with no fourth review. A finding that comes back after it was fixed
   goes to the maintainer instead.
5. **Commit** the page on its own, `Guides: <page>: <what changed>`, with what was added and why in the body. No
   review document.

## 5. Report

To the maintainer: each page's changes, the findings declined and why, the ones put to them, and any split or
convention still waiting on their yes. Report any check that couldn't run.
