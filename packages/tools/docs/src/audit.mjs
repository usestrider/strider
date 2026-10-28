// Lists, for each guide in reading order, what a reviewer of the guides checks: a page that may hold more than one
// concept, sections with few words before their first code, and names the prose mentions that no block on the page
// shows, with where else the guides show them. These are candidates for a reviewer to judge, not errors, so the
// audit never fails. It also lists links to a guide or a heading that doesn't exist, which a split leaves behind.
// With --consistency, it compares the pages instead: the forms of their titles and headings, how many examples
// each has for its prose, the sites its examples visit, and the devices its prose uses.
import * as fs from "node:fs"
import * as path from "node:path"
import { codeBlocks, typescriptLanguages } from "./guides.mjs"

/** A page over this many words of prose, its code aside, may hold more than one concept */
export const longPage = 700
/** A page with more sections than this may hold more than one concept */
export const manySections = 7
/** A section with fewer words than this before its first code may not say what the code is for */
export const shortLead = 15

const fenceLine = /^ {0,3}(?:> ?)*\s*(`{3,}|~{3,})/
const heading = /^(#{2,6}) (.+)$/
const inlineCode = /`([^`]+)`/g
const words = (text) => text.match(/\S+/g)?.length ?? 0
const strings = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g

// A span that names nothing to show in code: a string, a number, a path, a URL, a glob, a flag, a file, an
// environment variable, or an HTML attribute or HTTP header
const notCode = new RegExp(
  "^(?:[\"'].*[\"']|-.*|\\d.*|.*/.*|.*\\*.*|[a-z]+:\\S+|.*\\.(?:js|mjs|ts|json|html|md|har|zip)|[A-Z][A-Z0-9_]*" +
    "|[A-Za-z]+(?:-[A-Za-z]+)+)$"
)
// Words of the language, and names too short to be the API's: a snapshot's refs, such as `e12`
const notApi = /^(?:true|false|null|undefined|await|async|var|let|const|new|this|typeof|yield|return|.{1,2}|[a-z]\d+)$/
// A span that is a command: lowercase words, such as `npx strider browsers install chromium`
const command = /^[a-z][\w-]*(?: [\w.:=@/-]+)+$/
// A span that quotes a message: four or more words and no code's punctuation
const quote = (text) => words(text) >= 4 && !/[(){}=]|=>/.test(text)

/** The identifiers in code, without its strings and comments, and the tags it names in strings, `"LocatorError"` */
const identifiers = (code) => [
  ...code.replace(strings, "\"\"").replace(/(^|[^:])\/\/.*$/gm, "$1").match(/[A-Za-z_$][\w$]*/g) ?? [],
  ...Array.from(code.matchAll(/["']([A-Z][A-Za-z0-9]*)["']/g), ([, tag]) => tag)
]

/**
 * The names the public packages' own source uses, which tells a name of the API from an HTML attribute, a DOM name
 * or a plain value. Generated protocol modules and `internal/` are left out.
 */
const vocabulary = (root) => {
  const names = new Set()
  for (const pkg of ["browser", "vitest"]) {
    const dir = path.join(root, "packages", pkg, "src")
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir, { recursive: true })) {
      if (!file.endsWith(".ts") || file.split(path.sep).includes("internal")) continue
      const text = fs.readFileSync(path.join(dir, file), "utf8")
      if (/generated/i.test(text.slice(0, 300))) continue
      for (const name of identifiers(text)) names.add(name)
    }
  }
  return names
}

/** The names a span of inline code mentions: a call's callee and its options' keys, not its positional arguments */
const namesIn = (span) => {
  const found = []
  let parens = 0
  let braces = 0
  for (const [token] of span.replace(strings, "\"\"").matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|[(){}]/g)) {
    if (token === "(") parens++
    else if (token === ")") parens--
    else if (token === "{") braces++
    else if (token === "}") braces--
    else if (parens === 0 || braces > 0) found.push(token)
  }
  return found
}

const lastPart = (name) => name.slice(name.lastIndexOf(".") + 1)

// A heading that reads as a sentence or a fragment of one, rather than a name: a verb, a comma, or a question word
const phrase = new RegExp(
  ",|\\b(?:is|are|has|have|can|can't|do|does|don't|doesn't|isn't|aren't|needs|takes|goes|runs|works|says|" +
    "leaves|first|then)\\b|^(?:What|Who|When|Why|How)\\b",
  "i"
)

/** The form of a title or heading: a name, a gerund ("Finding elements"), a phrase, or, for titles, an article's */
const formOf = (text, { title = false } = {}) => {
  const bare = text.replace(/`/g, "")
  if (title && /^(?:A|An|The) /.test(bare)) return "article"
  const rest = bare.replace(/^(?:A|An|The) /, "")
  if (/^\p{Lu}\p{Ll}+ing\b/u.test(rest)) return "gerund"
  if (phrase.test(rest)) return "phrase"
  if (title && / and /.test(rest)) return "joined"
  return "name"
}

// The sites examples visit: the example domains, and example.test
const site = /https?:\/\/((?:[a-z0-9-]+\.)*(?:example\.[a-z]+|example\.test))/g

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** A heading's anchor, as the site's rehypeHeadingIds makes it with github-slugger */
const slug = (text) =>
  text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-")

/** The page's frontmatter, its lines after it, and how many lines the frontmatter took */
const parse = (text) => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const data = {}
  let start = 0
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1)
    for (const line of lines.slice(1, end)) {
      const field = /^(\w+):\s*(.*)$/.exec(line)
      if (field !== null) data[field[1]] = field[2].replace(/^["'](.*)["']$/, "$1")
    }
    start = end + 1
  }
  return { data, lines: lines.slice(start), offset: start }
}

/** A guide: its sections and their leads, the names its prose mentions, what its code uses and what it links to */
const read = (file, id, known) => {
  const text = fs.readFileSync(file, "utf8")
  const { data, lines, offset } = parse(text)
  const blocks = codeBlocks(lines.join("\n"))
  const typescript = blocks.filter((block) => typescriptLanguages.has(block.lang))
  const page = {
    id,
    file,
    title: data.title ?? id,
    order: Number(data.order ?? 0),
    words: 0,
    lead: { words: 0, code: false },
    sections: [],
    mentions: [],
    blocks: typescript.length,
    codeLines: typescript.reduce((n, block) => n + block.code.split("\n").length, 0),
    code: new Set(typescript.flatMap((block) => identifiers(block.code))),
    commands: blocks.filter((block) => !typescriptLanguages.has(block.lang)).map((block) => block.code),
    links: new Set(),
    hrefs: [],
    anchors: new Set(),
    allBlocks: blocks.length,
    sites: Array.from(text.matchAll(site), ([, host]) => host),
    declares: typescript.reduce((n, block) => n + (block.code.match(/^declare const /gm)?.length ?? 0), 0),
    asides: 0,
    boldLeads: 0
  }
  let fenced = false
  let current = page.lead
  for (const [i, raw] of lines.entries()) {
    const line = offset + i + 1
    if (fenceLine.test(raw)) {
      if (!fenced) current.code = true
      fenced = !fenced
      continue
    }
    if (fenced || /^\s*import .* from /.test(raw)) continue
    if (/^\s*<Aside\b/.test(raw)) page.asides++
    if (/^\*\*[^*]+\*\*/.test(raw)) page.boldLeads++
    const head = heading.exec(raw)
    if (head !== null) {
      const base = slug(head[2])
      let anchor = base
      for (let n = 1; page.anchors.has(anchor); n++) anchor = `${base}-${n}`
      page.anchors.add(anchor)
    }
    if (head?.[1] === "##") {
      current = { title: head[2], line, words: 0, lead: 0, code: false }
      page.sections.push(current)
      continue
    }
    for (const [, link, anchor] of raw.matchAll(/\]\((\/docs[^)#\s]*)(?:#([^)\s]*))?\)/g)) {
      page.links.add(link)
      page.hrefs.push({ path: link, anchor, line })
    }
    const table = raw.trimStart().startsWith("|")
    for (const [, span] of raw.matchAll(inlineCode)) {
      const text = span.trim()
      if (command.test(text)) page.mentions.push({ name: text, line, kind: "command", table })
      else if (!notCode.test(text) && !quote(text)) {
        for (const name of namesIn(text)) {
          if (notApi.test(lastPart(name)) || !known.has(lastPart(name))) continue
          page.mentions.push({ name, line, kind: /^[A-Z]/.test(lastPart(name)) ? "type" : "operation", table })
        }
      }
    }
    const prose = raw.replace(/<[^>]*>/g, " ").replace(/\]\([^)]*\)/g, "]").replace(/^\s*\|?[-:| ]+\|?\s*$/, "")
    const count = words(head === null ? prose : head[2])
    page.words += count
    current.words += count
    if (current !== page.lead && !current.code) current.lead += count
  }
  return page
}

/** Whether a page's code shows a name: the member or function it ends with is used, or the command is run */
const shows = (page, mention) =>
  mention.kind === "command"
    ? page.commands.some((code) => code.includes(mention.name.split(" ").slice(0, 3).join(" ")))
    : page.code.has(lastPart(mention.name))

/** The guides in the site's reading order: its chapters in order, each one's pages by `order`, then title */
const readingOrder = async (root, dir) => {
  const { groups } = await import(path.join(root, "website/src/features/docs/navigation.ts"))
  const known = vocabulary(root)
  const pages = fs.readdirSync(dir, { recursive: true }).filter((file) => /\.mdx?$/.test(file)).map((file) =>
    read(path.join(dir, file), file.replace(/\.mdx?$/, "").split(path.sep).join("/"), known)
  )
  const directoryOf = (page) => page.id.includes("/") ? page.id.slice(0, page.id.lastIndexOf("/")) : ""
  return groups.flatMap((group, chapter) =>
    pages.filter((page) => directoryOf(page) === group.directory)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .map((page, index) => ({ ...page, section: `${chapter + 1}.${index + 1}` }))
  )
}

const route = (page) => page.id === "index" ? "/docs" : `/docs/${page.id}`

/** Each guide's audit, in reading order */
export const auditGuides = async (root, dir) => {
  const pages = await readingOrder(root, dir)
  return pages.map((page) => {
    const split = []
    if (page.words > longPage) split.push(`${page.words} words, over ${longPage}`)
    if (page.sections.length > manySections) split.push(`${page.sections.length} sections, over ${manySections}`)
    if (/ and |, /.test(page.title)) split.push(`its title joins subjects: "${page.title}"`)
    const seen = new Set()
    const unshown = page.mentions.filter((mention) => {
      if (seen.has(mention.name) || shows(page, mention)) return false
      seen.add(mention.name)
      return true
    }).map((mention) => {
      const shownIn = pages.filter((other) => other.id !== page.id && shows(other, mention))
      return {
        name: mention.name,
        line: mention.line,
        kind: mention.kind,
        table: mention.table,
        shownIn: shownIn.map((other) => other.id),
        linkedTo: shownIn.filter((other) => page.links.has(route(other))).map((other) => other.id)
      }
    })
    const broken = page.hrefs.filter(({ path: href }) => !href.startsWith("/docs/api")).flatMap(
      ({ path: href, anchor, line }) => {
        const target = pages.find((other) => route(other) === href)
        if (target === undefined) return [{ href, line, problem: "no such guide" }]
        if (anchor !== undefined && !target.anchors.has(anchor)) {
          return [{ href: `${href}#${anchor}`, line, problem: "no such heading" }]
        }
        return []
      }
    )
    return {
      id: page.id,
      section: page.section,
      title: page.title,
      file: path.relative(root, page.file).split(path.sep).join("/"),
      words: page.words,
      blocks: page.blocks,
      codeLines: page.codeLines,
      split,
      leadWords: page.lead.words,
      sections: page.sections.map(({ title, line, words, lead, code }) => ({
        title,
        line,
        words,
        leadWords: code ? lead : null,
        short: code && lead < shortLead
      })),
      unshown,
      broken,
      style: {
        titleForm: formOf(page.title, { title: true }),
        headingForms: page.sections.map((section) => formOf(section.title)),
        blocks: page.allBlocks,
        blocksPer100Words: page.words === 0 ? 0 : Math.round((page.allBlocks / page.words) * 1000) / 10,
        sites: [...new Set(page.sites)],
        declares: page.declares,
        asides: page.asides,
        boldLeads: page.boldLeads,
        sectionWords: {
          median: median(page.sections.map((section) => section.words)),
          max: Math.max(0, ...page.sections.map((section) => section.words))
        }
      }
    }
  })
}

const count = (items) => {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

/** The guides compared: where they differ in form, in how many examples they give, and in what their prose uses */
const consistencyReport = (audits) => {
  const out = ["Consistency across the guide", ""]
  const titles = Map.groupBy(audits, (page) => page.style.titleForm)
  out.push("Page titles, by form:")
  for (const [form, pages] of [...titles].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`  ${form.padEnd(8)} ${pages.length}  ${pages.map((page) => page.title).join(" · ")}`)
  }
  const headings = count(audits.flatMap((page) => page.style.headingForms))
  out.push("", `Section headings, by form: ${headings.map(([form, n]) => `${form} ${n}`).join(", ")}`)
  for (const page of audits) {
    const forms = count(page.style.headingForms)
    if (forms.length < 2) continue
    const named = page.sections.map((section, i) => `${section.title} (${page.style.headingForms[i]})`)
    out.push(`  § ${page.section} ${page.title}: ${forms.map(([form, n]) => `${n} ${form}`).join(", ")}`)
    out.push(`      ${named.join(" · ")}`)
  }
  const densities = audits.map((page) => page.style.blocksPer100Words)
  const middle = median(densities)
  out.push("", `Code blocks per 100 words of prose: median ${middle}`)
  for (const page of audits) {
    const density = page.style.blocksPer100Words
    const flag = density < middle / 2
      ? "  fewer than half the median"
      : density > middle * 2
      ? "  over twice the median"
      : ""
    out.push(
      `  § ${page.section.padEnd(4)} ${page.title.padEnd(30)} ${
        String(density).padStart(4)
      }  (${page.style.blocks} blocks)${flag}`
    )
  }
  const sites = count(audits.flatMap((page) => page.style.sites))
  out.push(
    "",
    `Sites in examples, by how many pages visit them: ${sites.map(([host, n]) => `${host} ${n}`).join(", ")}`
  )
  const devices = [
    ["Blocks written as `declare const` values rather than steps", (page) => page.style.declares],
    ["Callouts (<Aside>)", (page) => page.style.asides],
    ["Paragraphs led by a bold label", (page) => page.style.boldLeads]
  ]
  for (const [label, of] of devices) {
    const using = audits.filter((page) => of(page) > 0)
    out.push("", `${label}: ${using.length === 0 ? "none" : using.map((page) => `${page.id} ${of(page)}`).join(", ")}`)
  }
  out.push("", "Words per section, median and longest, by page:")
  for (const page of audits) {
    out.push(
      `  § ${page.section.padEnd(4)} ${page.title.padEnd(30)} ${String(page.style.sectionWords.median).padStart(5)} ${
        String(page.style.sectionWords.max).padStart(5)
      }`
    )
  }
  return out.join("\n") + "\n"
}

const pagesList = (ids) => ids.length > 3 ? `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more` : ids.join(", ")

const where = (item) => {
  if (item.linkedTo.length > 0) return `shown in ${pagesList(item.linkedTo)}, linked`
  if (item.shownIn.length > 0) return `shown in ${pagesList(item.shownIn)}, not linked`
  return "shown nowhere in the guides"
}

const kinds = [["operation", "operations"], ["command", "commands"], ["type", "types and reasons"]]

const report = (audits) => {
  const out = []
  for (const page of audits) {
    out.push(`§ ${page.section} ${page.title}  ${page.file}`)
    out.push(
      `  ${page.words} words of prose, ${page.sections.length} sections, ` +
        `${page.blocks} TypeScript blocks of ${page.codeLines} lines`
    )
    for (const reason of page.split) out.push(`  split?   ${reason}`)
    if (page.leadWords === 0) {
      out.push(`  lead     none: after its description, the page opens with "## ${page.sections[0]?.title ?? ""}"`)
    }
    for (const section of page.sections.filter((section) => section.short)) {
      out.push(`  orient?  :${section.line} "${section.title}", ${section.leadWords} words before its first code`)
    }
    const width = Math.max(0, ...page.unshown.map((item) => item.name.length))
    for (const [kind, label] of kinds) {
      const items = page.unshown.filter((item) => item.kind === kind)
      if (items.length === 0) continue
      out.push(`  ${label} named with no code on this page:`)
      for (const item of items) {
        const table = item.table ? " (in a table)" : ""
        out.push(`    :${String(item.line).padEnd(4)} ${item.name.padEnd(width)}  ${where(item)}${table}`)
      }
    }
    for (const link of page.broken) out.push(`  broken   :${link.line} ${link.href}: ${link.problem}`)
    out.push("")
  }
  const sum = (f) => audits.reduce((n, page) => n + f(page), 0)
  const unshown = (f) => sum((page) => page.unshown.filter(f).length)
  const operation = (item) => item.kind !== "type"
  out.push(
    `${audits.length} pages: ${audits.filter((page) => page.split.length > 0).length} to consider splitting, ` +
      `${audits.filter((page) => page.leadWords === 0).length} with no lead, ` +
      `${sum((page) => page.sections.filter((section) => section.short).length)} sections with a short lead.`,
    `Operations and commands with no code on their page: ` +
      `${unshown((item) => operation(item) && !item.table && item.shownIn.length === 0)} shown nowhere and ` +
      `${unshown((item) => operation(item) && !item.table && item.shownIn.length > 0 && item.linkedTo.length === 0)} ` +
      `shown elsewhere but not linked, in prose; ` +
      `${unshown((item) => operation(item) && item.table)} more in tables.`,
    `Broken links to guides: ${sum((page) => page.broken.length)}.`
  )
  return out.join("\n") + "\n"
}

/**
 * Writes the audit of the pages named (ids such as `events/events`), or of every page, as text or JSON; with
 * `consistency`, the comparison of the pages instead
 */
export const audit = async (root, dir, { json = false, consistency = false, pages = [] } = {}) => {
  const audits = (await auditGuides(root, dir)).filter((page) => pages.length === 0 || pages.includes(page.id))
  const text = consistency ? consistencyReport(audits) : report(audits)
  process.stdout.write(json ? JSON.stringify(audits, null, 2) + "\n" : text)
  return 0
}
