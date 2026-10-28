# The rubric

Four checks. A finding names one of them; anything else, such as wording or a fact, is out of scope here. The
first three judge a page on its own; Consistent judges it against the rest of the guide.

## Split: one concept a page

A section becomes a page of its own when all three hold:

- a reader would look for its heading in the sidebar ("Dialogs", "Attaching to a browser");
- it doesn't lean on the rest of its page, beyond what earlier pages teach;
- with its examples, it stands as a page: about 250 words of prose or more, not a stub.

Don't split:

- a concept from the contrast that explains it, such as `next`, `stream` and `history`, which are read together;
- the facets of one subject a reader reads in one go, such as a browser's page;
- into pages that would each hold one example and a sentence.

The audit's `split?` flags are candidates only: "Requests and responses" joins two words but is one concept.

A split proposal gives: each new page's title, its description (the deck under the title), its directory and
`order`, the sections that move to it, what stays behind, and the links to the moved sections that must change.

## Orient: why before how

- **A page** opens, before its first section, with up to two sentences: what goes wrong without the page's concept,
  and what it gets the reader. The description says what the page covers; it isn't the orientation. If the
  description already says why, the opening doesn't repeat it.
- **A section** that introduces a concept says, before its first code, what it's for and what it gets the reader,
  in terms of what fails without it, and when to use it rather than its neighbor. A section that varies the one
  before needs only a bridge: "File choosers work the same way."
- **A term** is explained where it first appears, or linked to where it was.

Orientation is not narrative. Up to two plain sentences a concept; no history, no scene-setting, no "imagine",
no rhetorical questions, no praise ("powerful", "seamless"). State the benefit as what happens: "so a download that
starts before the click returns isn't missed", not "making downloads easy".

Before:

> ## Subscribe, act, collect
>
> Subscribe first, then act:

After:

> ## Subscribe, act, collect
>
> An action's effects, such as a popup or a download, can arrive before the action returns. A wait subscribes when
> you create it, so subscribe before acting and nothing the action causes is missed:

## Example: show what's named

Anything the prose names that a reader would type (a function, a method or member, an option, a layer, a command)
appears in a code block on the page, or the page links to where it's shown.

- **Its own concept**, the page's subject or a section's, gets an example on the page.
- **A passing mention** of another page's concept gets a link: to the guide that shows it,
  `[routes](/docs/events/routes)`, or to its entry in the reference, `/docs/api/browser/Dialog#dismissAll`, whose
  every operation has an example.
- **A row of an options table** gets an example only when the row doesn't make its effect plain.
- **A type or a reason** gets one only when it shows something not obvious, such as catching the reason.
- One example can cover several names. Extend an existing block rather than add a near-copy, unless the block would
  stop reading as one task.

An example is a realistic task (`exportCsv`, `deleteAccount`), never `foo`; a module of its own that type-checks;
written as the guide's other blocks are (`website/README.md`, "Guides"). It reads data through its types, such as a
body decoded with a Schema and its fields read, never `JSON.stringify`.

## Consistent: one guide, not twenty

A reader moves from page to page, and the guide should read as one book. Compare a page with the others, against
the conventions in `website/README.md`, "Style":

- **Titles and headings** take one form across the guide, the one the style names: not names on one page and
  sentences or fragments on the next.
- **Pages of a kind share a shape.** The browser pages share their outline (launching, attaching, what the browser
  can't do, what's different, the raw protocol); a concept page opens with its lead, then its sections. A section a
  sibling has and this page lacks, or the reverse, needs a reason.
- **Examples are in proportion.** A page with far fewer or far more blocks for its prose than the guide's median
  needs its content to call for it. Blocks are written alike everywhere: steps as `Effect.fn`, not bare values; the
  same example sites for the same kind of app; tasks named as the reader would name them.
- **Prose uses the same devices for the same things:** the same lead length, and bullets, bold-label paragraphs or
  callouts for the same kind of content on every page.
- **One thing has one name** on every page, the one the reference uses: the `strider` CLI, a context, a deadline.
- **Sections weigh alike.** A section several times its page's median that holds two topics, or one of a line or
  two, is a candidate.

`strider-docs audit --consistency` measures the guide's titles, headings, example density, sites, devices and
section lengths. Where the guide disagrees with itself and the style says nothing, the finding proposes a
convention rather than a page-by-page fix.

## Severity

- **Must:** a reader can't follow the page without it: a concept used before it's explained, an operation of the
  page's own concept with no example, a page whose sections a reader would look for elsewhere.
- **Should:** a reader can follow but works harder: a missing benefit, a passing mention with no link, a page that
  breaks the style.

The loop fixes both; a page is done when a round raises neither.
