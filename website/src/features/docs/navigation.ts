// The guides' chapters: groups in this order, each a directory of src/content/docs, its pages ordered by their
// `order` frontmatter. A page in no listed group isn't in the navigation. A page's section is its chapter's number
// and its place in it: § 1.1 is the first page of chapter 1.
import type { CollectionEntry } from "astro:content"

export interface Group {
  readonly label: string
  /** The directory under src/content/docs; "" for its top level */
  readonly directory: string
  /** What the chapter covers, for the home page's contents */
  readonly description: string
}

export const groups: ReadonlyArray<Group> = [
  {
    label: "Getting started",
    directory: "",
    description: "What Strider is, how to install it and a browser, a first program, and what its errors tell you."
  },
  {
    label: "Pages and locators",
    directory: "pages",
    description:
      "Finding elements, acting on them, expecting what should happen, and contexts that keep sessions apart."
  },
  {
    label: "Events and the network",
    directory: "events",
    description: "Subscribing before you act, watching requests and responses, and routes, scripts and time."
  },
  {
    label: "Testing and tools",
    directory: "tools",
    description: "Tests under Vitest, traces and HAR recordings, and the agent toolkit and the strider command."
  },
  {
    label: "Browsers",
    directory: "browsers",
    description:
      "What's different about Chromium, Firefox and WebKit: launching each, attaching, what each can do, and its quirks."
  }
]

export type Guide = CollectionEntry<"docs">

/** A guide's route: `/docs` for the top-level index, `/docs/<id>` otherwise */
export const guideRoute = (guide: Guide) => (guide.id === "index" ? "/docs" : `/docs/${guide.id}`)

export const directoryOf = (guide: Guide) => {
  const slash = guide.id.lastIndexOf("/")
  return slash === -1 ? "" : guide.id.slice(0, slash)
}

/** The chapters that have pages, numbered from 1 */
export const navigation = (guides: ReadonlyArray<Guide>) =>
  groups.map((group) => ({
    ...group,
    pages: guides.filter((guide) => directoryOf(guide) === group.directory)
      .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title))
  })).filter((group) => group.pages.length > 0).map((group, i) => ({ ...group, number: i + 1 }))

/** A guide's chapter and section, `{ chapter: 1, label: "Getting started", section: "1.1" }` */
export const placeOf = (guides: ReadonlyArray<Guide>, guide: Guide) => {
  for (const chapter of navigation(guides)) {
    const index = chapter.pages.findIndex((page) => page.id === guide.id)
    if (index !== -1) {
      return { chapter: chapter.number, label: chapter.label, section: `${chapter.number}.${index + 1}` }
    }
  }
  return undefined
}
