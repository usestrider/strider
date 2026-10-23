/**
 * The query and actionability engine (review 12): one engine of ours, evaluated in each document's utility
 * world, the same on every backend, so a locator means the same thing in every browser.
 *
 * `engine` is self-contained: it refers to nothing outside its own body but the page's globals, because its
 * source crosses into the page as text (`source`), where it is installed once per realm, out of the page's
 * reach. L1 sends it requests as JSON and reads JSON back (`Request`, `Response`).
 *
 * - **The tree** is the document's elements and those of every open shadow root, in tree order, a shadow
 *   root's elements right after its host. Closed shadow roots are invisible to scripts, so to the engine too;
 *   iframes are entered only through `frame()`, which isn't built.
 * - **Text** is an element's text content in the flat tree (a shadow host's shadow tree, a slot's assigned
 *   nodes), skipping `script`, `style`, `noscript` and `template`, with a button-like `input`'s value, and
 *   whitespace collapsed and trimmed. Not `innerText`, which depends on layout and differs between engines.
 * - **`getByText`** matches the smallest element that says it: its text matches and no child element's does.
 *   The document's `head` isn't searched.
 * - **`getByRole`** takes the first role token the engine knows from `role`, or else the implicit role under
 *   HTML-AAM, and computes the accessible name under accname 1.2.
 * - **Actions** check at each animation frame, in the page, until the checks pass or the round's cap runs out
 *   (CONCEPTS.md §8): visible, enabled, notInert, inViewport (scrolling into view once), stable across
 *   `frames` frames, and receivesPointer at the action point.
 */

/** How a query matches text. */
export type TextMatcher =
  | { readonly _tag: "String"; readonly value: string; readonly exact: boolean }
  | { readonly _tag: "RegExp"; readonly source: string; readonly flags: string }

/** One step of a locator, applied to the matches of the steps before it. */
export type Step =
  | {
    readonly _tag: "Role"
    readonly role: string
    readonly name: TextMatcher | null
    readonly includeHidden: boolean
  }
  | { readonly _tag: "Text"; readonly matcher: TextMatcher }
  | { readonly _tag: "Label"; readonly matcher: TextMatcher }
  | { readonly _tag: "Placeholder"; readonly matcher: TextMatcher }
  | { readonly _tag: "AltText"; readonly matcher: TextMatcher }
  | { readonly _tag: "Title"; readonly matcher: TextMatcher }
  | { readonly _tag: "TestId"; readonly id: string }
  | { readonly _tag: "Css"; readonly selector: string }
  | { readonly _tag: "Nth"; readonly index: number }
  | {
    readonly _tag: "Filter"
    readonly hasText: TextMatcher | null
    readonly hasNotText: TextMatcher | null
    readonly has: ReadonlyArray<Step> | null
    readonly hasNot: ReadonlyArray<Step> | null
    readonly visible: boolean | null
  }
  | { readonly _tag: "And"; readonly other: ReadonlyArray<Step> }
  | { readonly _tag: "Or"; readonly other: ReadonlyArray<Step> }

/** Which actionability checks an action runs. */
export interface Checks {
  readonly visible: boolean
  readonly enabled: boolean
  readonly notInert: boolean
  readonly inViewport: boolean
  /** Frames the rect must stay unchanged across; 0 skips the check. */
  readonly stable: number
  readonly receivesPointer: boolean
}

/** Why an element isn't ready, as CONCEPTS.md §8 names it. */
export type NotReady =
  | { readonly _tag: "NoMatch" }
  | { readonly _tag: "NotVisible" }
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Inert" }
  | { readonly _tag: "BlockedByModal"; readonly dialog: string }
  | { readonly _tag: "OutsideViewport" }
  | { readonly _tag: "NotStable" }
  | { readonly _tag: "NoRenderingOpportunity" }
  | { readonly _tag: "Covered"; readonly by: string }

/** A request to the engine. */
export type Request =
  | { readonly op: "count"; readonly steps: ReadonlyArray<Step> }
  | { readonly op: "visible"; readonly steps: ReadonlyArray<Step> }
  | {
    readonly op: "act"
    readonly steps: ReadonlyArray<Step>
    readonly checks: Checks
    /** Milliseconds this round may wait for the checks to pass. */
    readonly cap: number
    /** From the padding box's top left, in CSS pixels; `null` is its centre. */
    readonly position: { readonly x: number; readonly y: number } | null
  }
  | { readonly op: "title" }
  | { readonly op: "role"; readonly steps: ReadonlyArray<Step> }

/** A candidate of an ambiguous match. */
export interface Candidate {
  readonly description: string
  readonly visible: boolean
}

/** What the engine answers. */
export type Response =
  | { readonly _tag: "Count"; readonly count: number }
  | { readonly _tag: "Visible"; readonly count: number; readonly visible: boolean }
  | {
    readonly _tag: "Ready"
    readonly point: { readonly x: number; readonly y: number }
    readonly element: string
    readonly scrolled: boolean
  }
  | {
    readonly _tag: "NotReady"
    readonly reason: NotReady
    /** Each reason seen this round, de-duplicated in order. */
    readonly history: ReadonlyArray<NotReady>
    readonly scrolled: boolean
  }
  | { readonly _tag: "Strict"; readonly candidates: ReadonlyArray<Candidate>; readonly count: number }
  | { readonly _tag: "InvalidSelector"; readonly selector: string; readonly message: string }
  | { readonly _tag: "Title"; readonly title: string }
  | {
    readonly _tag: "Roles"
    readonly roles: ReadonlyArray<{ readonly role: string | null; readonly name: string }>
  }

/** The engine. Self-contained: its source is evaluated in the page. */
export function engine() {
  // ── The tree ──────────────────────────────────────────────────────────────────────────────────────────

  const SKIPPED = new Set(["script", "style", "noscript", "template"])

  /** Every element under `root`, in tree order, with each open shadow root's elements after its host. */
  const elementsUnder = (root: Document | Element | ShadowRoot): Array<Element> => {
    const out: Array<Element> = []
    const visit = (node: Document | Element | ShadowRoot) => {
      for (let child = node.firstElementChild; child !== null; child = child.nextElementSibling) {
        out.push(child)
        if (child.shadowRoot !== null) visit(child.shadowRoot)
        visit(child)
      }
    }
    visit(root)
    return out
  }

  /** The parent in the composed tree: the parent element, or a shadow root's host. */
  const composedParent = (element: Element): Element | null => {
    if (element.parentElement !== null) return element.parentElement
    const root = element.parentNode
    return root instanceof ShadowRoot ? root.host : null
  }

  /** Whether `ancestor` contains `node` in the composed tree. */
  const composedContains = (ancestor: Element, node: Element): boolean => {
    for (let current: Element | null = node; current !== null; current = composedParent(current)) {
      if (current === ancestor) return true
    }
    return false
  }

  /** A node's children in the flat tree: a host's shadow tree, a slot's assigned nodes. */
  const flatChildNodes = (node: Node): Array<Node> => {
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true })
      return assigned.length > 0 ? assigned : Array.from(node.childNodes)
    }
    if (node instanceof Element && node.shadowRoot !== null) return Array.from(node.shadowRoot.childNodes)
    return Array.from(node.childNodes)
  }

  const flatChildElements = (element: Element): Array<Element> => {
    const out: Array<Element> = []
    for (const child of flatChildNodes(element)) {
      if (!(child instanceof Element)) continue
      if (child instanceof HTMLSlotElement) out.push(...flatChildElements(child))
      else out.push(child)
    }
    return out
  }

  const inHead = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.localName === "head") return true
    }
    return false
  }

  // ── Text ──────────────────────────────────────────────────────────────────────────────────────────────

  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim()

  const buttonLikeInput = (element: Element): element is HTMLInputElement =>
    element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)

  const rawText = new Map<Node, string>()
  const textOfNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ""
    if (!(node instanceof Element)) return ""
    const cached = rawText.get(node)
    if (cached !== undefined) return cached
    let text = ""
    if (SKIPPED.has(node.localName)) text = ""
    else if (buttonLikeInput(node)) text = node.value
    else for (const child of flatChildNodes(node)) text += textOfNode(child)
    rawText.set(node, text)
    return text
  }

  /** An element's text: flat-tree text content, whitespace collapsed. */
  const textOf = (element: Element): string => collapse(textOfNode(element))

  const matches = (matcher: TextMatcher, text: string): boolean => {
    if (matcher._tag === "RegExp") return new RegExp(matcher.source, matcher.flags).test(text)
    const expected = collapse(matcher.value)
    return matcher.exact ? text === expected : text.toLowerCase().includes(expected.toLowerCase())
  }

  // ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────

  const KNOWN_ROLES = new Set([
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "mark",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem"
  ])

  /** Roles whose name comes from their content (accname 1.2, step 2F). */
  const NAME_FROM_CONTENT = new Set([
    "button",
    "cell",
    "checkbox",
    "columnheader",
    "gridcell",
    "heading",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "row",
    "rowheader",
    "switch",
    "tab",
    "tooltip",
    "treeitem"
  ])

  const hasAccessibleNameAttribute = (element: Element): boolean =>
    (element.getAttribute("aria-label") ?? "").trim() !== "" || element.hasAttribute("aria-labelledby") ||
    (element.getAttribute("title") ?? "").trim() !== ""

  const focusable = (element: Element): boolean =>
    element.hasAttribute("tabindex") ||
    (element instanceof HTMLAnchorElement && element.hasAttribute("href")) ||
    ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && !element.disabled)

  const inputRole = (input: HTMLInputElement): string | null => {
    const list = input.hasAttribute("list")
    switch (input.type) {
      case "button":
      case "image":
      case "reset":
      case "submit":
        return "button"
      case "checkbox":
        return "checkbox"
      case "radio":
        return "radio"
      case "range":
        return "slider"
      case "number":
        return "spinbutton"
      case "search":
        return list ? "combobox" : "searchbox"
      case "email":
      case "tel":
      case "text":
      case "url":
        return list ? "combobox" : "textbox"
      default:
        return null
    }
  }

  const sectioningAncestor = (element: Element): boolean => {
    for (let current = composedParent(element); current !== null; current = composedParent(current)) {
      if (["article", "aside", "main", "nav", "section"].includes(current.localName)) return true
    }
    return false
  }

  /** The implicit role under HTML-AAM, for the elements the engine knows; `null` for none. */
  const implicitRole = (element: Element): string | null => {
    switch (element.localName) {
      case "a":
      case "area":
        return element.hasAttribute("href") ? "link" : element.localName === "a" ? "generic" : null
      case "address":
      case "details":
      case "fieldset":
      case "hgroup":
      case "optgroup":
        return "group"
      case "article":
        return "article"
      case "aside":
        return "complementary"
      case "blockquote":
        return "blockquote"
      case "button":
        return "button"
      case "caption":
        return "caption"
      case "code":
        return "code"
      case "datalist":
        return "listbox"
      case "dd":
        return "definition"
      case "del":
      case "s":
        return "deletion"
      case "dialog":
        return "dialog"
      case "dt":
        return "term"
      case "em":
        return "emphasis"
      case "figure":
        return "figure"
      case "footer":
        return sectioningAncestor(element) ? "generic" : "contentinfo"
      case "form":
        return hasAccessibleNameAttribute(element) ? "form" : null
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading"
      case "header":
        return sectioningAncestor(element) ? "generic" : "banner"
      case "hr":
        return "separator"
      case "html":
        return "document"
      case "img":
        return element.getAttribute("alt") === "" && !hasAccessibleNameAttribute(element) ? "presentation" : "img"
      case "input":
        return inputRole(element as HTMLInputElement)
      case "ins":
        return "insertion"
      case "li":
        return "listitem"
      case "main":
        return "main"
      case "mark":
        return "mark"
      case "math":
        return "math"
      case "menu":
      case "ol":
      case "ul":
        return "list"
      case "meter":
        return "meter"
      case "nav":
        return "navigation"
      case "option":
        return "option"
      case "output":
        return "status"
      case "p":
        return "paragraph"
      case "progress":
        return "progressbar"
      case "search":
        return "search"
      case "section":
        return hasAccessibleNameAttribute(element) ? "region" : "generic"
      case "select": {
        const select = element as HTMLSelectElement
        return select.multiple || select.size > 1 ? "listbox" : "combobox"
      }
      case "strong":
        return "strong"
      case "sub":
        return "subscript"
      case "sup":
        return "superscript"
      case "table":
        return "table"
      case "tbody":
      case "tfoot":
      case "thead":
        return "rowgroup"
      case "td": {
        const table = element.closest("table")
        const role = table?.getAttribute("role")
        return role === "grid" || role === "treegrid" ? "gridcell" : "cell"
      }
      case "textarea":
        return "textbox"
      case "th":
        return element.getAttribute("scope") === "row" ? "rowheader" : "columnheader"
      case "time":
        return "time"
      case "tr":
        return "row"
      case "b":
      case "bdi":
      case "bdo":
      case "data":
      case "div":
      case "i":
      case "pre":
      case "q":
      case "samp":
      case "small":
      case "span":
      case "u":
        return "generic"
      default:
        return null
    }
  }

  const roleCache = new Map<Element, string | null>()
  /** An element's role: the first role token the engine knows, or its implicit role. */
  const roleOf = (element: Element): string | null => {
    if (roleCache.has(element)) return roleCache.get(element)!
    let role: string | null = null
    for (const token of (element.getAttribute("role") ?? "").split(/\s+/)) {
      if (!KNOWN_ROLES.has(token)) continue
      // A focusable element can't be presentational (ARIA 1.2, presentational roles conflict resolution)
      if ((token === "none" || token === "presentation") && focusable(element)) continue
      role = token
      break
    }
    if (role === null) role = implicitRole(element)
    roleCache.set(element, role)
    return role
  }

  // ── Hidden, visible ───────────────────────────────────────────────────────────────────────────────────

  /** Excluded from the accessibility tree: `aria-hidden`, `display: none`, `visibility: hidden`. */
  const hiddenFromAccessibility = (element: Element): boolean => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.getAttribute("aria-hidden") === "true") return true
    }
    return !element.checkVisibility({ visibilityProperty: true })
  }

  /** CONCEPTS.md §8, Visible. */
  const visible = (element: Element): boolean => {
    if (getComputedStyle(element).display === "contents") {
      return flatChildElements(element).some(visible)
    }
    if (!element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  // ── Accessible names (accname 1.2) ────────────────────────────────────────────────────────────────────

  interface NameContext {
    readonly visited: Set<Element>
    /** Inside an `aria-labelledby` traversal, which includes hidden referenced nodes. */
    readonly labelledBy: boolean
    /** Computing another element's name, not the root's. */
    readonly traversal: boolean
    readonly includeHidden: boolean
  }

  const byId = (element: Element, id: string): Element | null => {
    const root = element.getRootNode()
    return root instanceof Document || root instanceof ShadowRoot ? root.getElementById(id) : null
  }

  const embeddedControlRole = (role: string | null): boolean =>
    role === "textbox" || role === "searchbox" || role === "combobox" || role === "listbox" ||
    role === "slider" || role === "spinbutton"

  const embeddedValue = (element: Element, role: string | null): string => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (role === "slider" || role === "spinbutton") {
        return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? element.value
      }
      return element.value
    }
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.selectedOptions).map((option) => textOf(option)).join(" ")
    }
    return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? textOf(element)
  }

  const labelsOf = (element: Element): Array<HTMLLabelElement> =>
    "labels" in element && element.labels instanceof NodeList
      ? Array.from(element.labels as NodeListOf<HTMLLabelElement>)
      : []

  const pseudoContent = (element: Element, pseudo: "::before" | "::after"): string => {
    const content = getComputedStyle(element, pseudo).content
    const match = /^"(.*)"$/.exec(content)
    return match === null ? "" : match[1]!
  }

  const nameOfNode = (node: Node, context: NameContext): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ""
    if (!(node instanceof Element)) return ""
    return nameOfElement(node, context)
  }

  const nameOfElement = (element: Element, context: NameContext): string => {
    if (context.visited.has(element)) return ""
    context.visited.add(element)
    // 2A: hidden, unless referenced or asked for
    if (!context.labelledBy && !(context.includeHidden && !context.traversal) && hiddenFromAccessibility(element)) {
      return ""
    }
    // 2B: aria-labelledby, not followed twice
    if (!context.labelledBy) {
      const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((id) => id !== "")
      const parts = ids.flatMap((id) => {
        const target = byId(element, id)
        return target === null ? [] : [nameOfElement(target, { ...context, labelledBy: true, traversal: true })]
      })
      const joined = parts.join(" ")
      if (joined.trim() !== "") return joined
    }
    const role = roleOf(element)
    // 2E: an embedded control inside another element's name contributes its value
    if (context.traversal && embeddedControlRole(role)) return embeddedValue(element, role)
    // 2C: aria-label
    const label = element.getAttribute("aria-label") ?? ""
    if (label.trim() !== "") return label
    // 2D: the host language's label
    if (role !== "none" && role !== "presentation") {
      const native = nativeName(element, context)
      if (native.trim() !== "") return native
    }
    // 2F: name from content
    if (context.traversal || (role !== null && NAME_FROM_CONTENT.has(role))) {
      let content = pseudoContent(element, "::before")
      for (const child of flatChildNodes(element)) {
        if (child instanceof Element && SKIPPED.has(child.localName)) continue
        const name = nameOfNode(child, { ...context, traversal: true })
        const inline = !(child instanceof Element) || getComputedStyle(child).display.startsWith("inline")
        content += inline ? name : ` ${name} `
      }
      content += pseudoContent(element, "::after")
      if (content.trim() !== "") return content
    }
    // 2I: the tooltip, then a placeholder (HTML-AAM)
    const title = element.getAttribute("title") ?? ""
    if (title.trim() !== "") return title
    const placeholder = element.getAttribute("placeholder") ?? ""
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && placeholder.trim() !== "") {
      return placeholder
    }
    return ""
  }

  const nativeName = (element: Element, context: NameContext): string => {
    if (element instanceof HTMLInputElement) {
      if (element.type === "submit" || element.type === "reset" || element.type === "button") {
        return element.value !== "" ? element.value : element.type === "submit" ? "Submit" : element.type === "reset"
          ? "Reset"
          : ""
      }
      if (element.type === "image") return element.alt !== "" ? element.alt : element.value
    }
    const labels = labelsOf(element)
    if (labels.length > 0) {
      return labels.map((label) => nameOfElement(label, { ...context, traversal: true })).join(" ")
    }
    if (element instanceof HTMLImageElement || element instanceof HTMLAreaElement) {
      return element.getAttribute("alt") ?? ""
    }
    const first = (selector: string) => Array.from(element.children).find((child) => child.matches(selector))
    if (element instanceof HTMLFieldSetElement) {
      const legend = first("legend")
      return legend === undefined ? "" : nameOfElement(legend, { ...context, traversal: true })
    }
    if (element instanceof HTMLTableElement) {
      const caption = first("caption")
      return caption === undefined ? "" : nameOfElement(caption, { ...context, traversal: true })
    }
    if (element.localName === "figure") {
      const caption = first("figcaption")
      return caption === undefined ? "" : nameOfElement(caption, { ...context, traversal: true })
    }
    if (element instanceof SVGSVGElement) {
      const title = first("title")
      return title === undefined ? "" : title.textContent ?? ""
    }
    return ""
  }

  const nameCache = new Map<Element, string>()
  const accessibleName = (element: Element, includeHidden: boolean): string => {
    const cached = nameCache.get(element)
    if (cached !== undefined) return cached
    const name = collapse(
      nameOfElement(element, { visited: new Set(), labelledBy: false, traversal: false, includeHidden })
    )
    nameCache.set(element, name)
    return name
  }

  // ── Queries ───────────────────────────────────────────────────────────────────────────────────────────

  interface InvalidSelector {
    readonly invalidSelector: true
    readonly selector: string
    readonly message: string
  }
  const isInvalidSelector = (error: unknown): error is InvalidSelector =>
    typeof error === "object" && error !== null && "invalidSelector" in error

  const labelable = (element: Element): boolean =>
    (element instanceof HTMLInputElement && element.type !== "hidden") || element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement ||
    element instanceof HTMLMeterElement || element instanceof HTMLOutputElement ||
    element instanceof HTMLProgressElement

  const labelTexts = (element: Element): Array<string> => {
    const texts: Array<string> = []
    for (const id of (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((id) => id !== "")) {
      const target = byId(element, id)
      if (target !== null) texts.push(textOf(target))
    }
    const label = element.getAttribute("aria-label")
    if (label !== null) texts.push(collapse(label))
    for (const each of labelsOf(element)) texts.push(textOf(each))
    return texts
  }

  const attributeMatches = (element: Element, attribute: string, matcher: TextMatcher): boolean => {
    const value = element.getAttribute(attribute)
    return value !== null && matches(matcher, collapse(value))
  }

  /** The candidates of one query under `scope`, in tree order. */
  const query = (scope: Document | Element, step: Step): Array<Element> => {
    const under = elementsUnder(scope)
    switch (step._tag) {
      case "Css": {
        const roots: Array<Document | Element | ShadowRoot> = [scope]
        for (const element of under) if (element.shadowRoot !== null) roots.push(element.shadowRoot)
        const found = new Set<Element>()
        for (const root of roots) {
          try {
            for (const element of Array.from(root.querySelectorAll(step.selector))) found.add(element)
          } catch (error) {
            throw {
              invalidSelector: true,
              selector: step.selector,
              message: error instanceof Error ? error.message : String(error)
            } satisfies InvalidSelector
          }
        }
        return under.filter((element) => found.has(element))
      }
      case "Text": {
        const candidates = under.filter((element) => !inHead(element) && !SKIPPED.has(element.localName))
        const says = (element: Element) => matches(step.matcher, textOf(element))
        return candidates.filter((element) => says(element) && !flatChildElements(element).some(says))
      }
      case "Role":
        return under.filter((element) =>
          roleOf(element) === step.role && (step.includeHidden || !hiddenFromAccessibility(element)) &&
          (step.name === null || matches(step.name, accessibleName(element, step.includeHidden)))
        )
      case "Label":
        return under.filter((element) =>
          (labelable(element) || element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")) &&
          labelTexts(element).some((text) => matches(step.matcher, text))
        )
      case "Placeholder":
        return under.filter((element) =>
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
          attributeMatches(element, "placeholder", step.matcher)
        )
      case "AltText":
        return under.filter((element) =>
          (element instanceof HTMLImageElement || element instanceof HTMLAreaElement ||
            (element instanceof HTMLInputElement && element.type === "image")) &&
          attributeMatches(element, "alt", step.matcher)
        )
      case "Title":
        return under.filter((element) => attributeMatches(element, "title", step.matcher))
      case "TestId":
        return under.filter((element) => element.getAttribute("data-testid") === step.id)
      default:
        return []
    }
  }

  const treeOrder = (elements: Iterable<Element>): Array<Element> => {
    const set = new Set(elements)
    return elementsUnder(document).filter((element) => set.has(element))
  }

  /** The matches of a locator's steps, from the document. */
  const resolve = (
    steps: ReadonlyArray<Step>,
    from: ReadonlyArray<Document | Element> = [document]
  ): Array<Element> => {
    let current: ReadonlyArray<Document | Element> = from
    for (const step of steps) {
      switch (step._tag) {
        case "Nth": {
          const index = step.index < 0 ? current.length + step.index : step.index
          current = index >= 0 && index < current.length ? [current[index]!] : []
          break
        }
        case "Filter": {
          current = current.filter((scope) => {
            if (!(scope instanceof Element)) return false
            if (step.hasText !== null && !matches(step.hasText, textOf(scope))) return false
            if (step.hasNotText !== null && matches(step.hasNotText, textOf(scope))) return false
            if (step.has !== null && resolve(step.has, [scope]).length === 0) return false
            if (step.hasNot !== null && resolve(step.hasNot, [scope]).length > 0) return false
            if (step.visible !== null && visible(scope) !== step.visible) return false
            return true
          })
          break
        }
        case "And": {
          const other = new Set(resolve(step.other))
          current = current.filter((element) => element instanceof Element && other.has(element))
          break
        }
        case "Or":
          current = treeOrder([
            ...current.filter((scope): scope is Element => scope instanceof Element),
            ...resolve(step.other)
          ])
          break
        default: {
          const found = new Set<Element>()
          for (const scope of current) for (const element of query(scope, step)) found.add(element)
          current = current.length === 1 ? Array.from(found) : treeOrder(found)
        }
      }
    }
    return current.filter((scope): scope is Element => scope instanceof Element)
  }

  // ── Actionability ─────────────────────────────────────────────────────────────────────────────────────

  /** A short description of an element for errors: `button#buy.primary "Add to cart"`. */
  const describe = (element: Element): string => {
    let out = element.localName
    if (element.id !== "") out += `#${element.id}`
    for (const name of Array.from(element.classList).slice(0, 2)) out += `.${name}`
    const text = textOf(element)
    if (text !== "") out += ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`
    return out
  }

  const enabled = (element: Element): boolean => {
    if (element.matches(":disabled")) return false
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.getAttribute("aria-disabled") === "true") return false
    }
    return true
  }

  const inertReason = (element: Element): NotReady | null => {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
      if (current.hasAttribute("inert")) return { _tag: "Inert" }
    }
    const modal = Array.from(document.querySelectorAll("dialog")).find((dialog) => dialog.matches(":modal"))
    return modal !== undefined && !composedContains(modal, element)
      ? { _tag: "BlockedByModal", dialog: describe(modal) }
      : null
  }

  const inViewport = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const width = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
    const height = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
    return width > 0 && height > 0 && width * height > 0.99
  }

  /** The action point, in viewport CSS pixels: the padding box's centre, or `position` from its top left. */
  const actionPoint = (element: Element, position: { readonly x: number; readonly y: number } | null) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const left = rect.left + parseFloat(style.borderLeftWidth)
    const top = rect.top + parseFloat(style.borderTopWidth)
    const width = rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    const height = rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
    return position === null
      ? { x: left + width / 2, y: top + height / 2 }
      : { x: left + position.x, y: top + position.y }
  }

  /** What the pointer would hit at a point, through open shadow roots. */
  const hitTarget = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y)
    while (hit !== null && hit.shadowRoot !== null) {
      const inner = hit.shadowRoot.elementFromPoint(x, y)
      if (inner === null || inner === hit) break
      hit = inner
    }
    return hit
  }

  const sameRect = (a: DOMRect, b: DOMRect) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

  const nextFrame = (timeout: number): Promise<boolean> =>
    new Promise((resume) => {
      const timer = setTimeout(() => resume(false), Math.max(0, timeout))
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resume(true)
      })
    })

  const act = async (request: Extract<Request, { op: "act" }>): Promise<Response> => {
    const end = performance.now() + request.cap
    const history: Array<NotReady> = []
    const seen = new Set<string>()
    let last: NotReady = { _tag: "NoMatch" }
    const note = (reason: NotReady) => {
      const key = JSON.stringify(reason)
      if (!seen.has(key)) {
        seen.add(key)
        history.push(reason)
      }
      last = reason
    }
    let scrolled = false
    let frames = 0
    // The rects of one element across frames, for the stable check
    let tracked: Element | null = null
    let rects: Array<DOMRect> = []
    while (true) {
      const left = end - performance.now()
      if (left <= 0) return { _tag: "NotReady", reason: last, history, scrolled }
      if (!(await nextFrame(left))) {
        if (frames === 0) note({ _tag: "NoRenderingOpportunity" })
        return { _tag: "NotReady", reason: last, history, scrolled }
      }
      frames++
      rawText.clear()
      roleCache.clear()
      nameCache.clear()
      const found = resolve(request.steps)
      if (found.length > 1) return strict(found)
      const element = found[0]
      if (element !== tracked) {
        tracked = element ?? null
        rects = []
      }
      const checks = request.checks
      let reason: NotReady | null = null
      if (element === undefined) reason = { _tag: "NoMatch" }
      else if (checks.visible && !visible(element)) reason = { _tag: "NotVisible" }
      else if (checks.enabled && !enabled(element)) reason = { _tag: "Disabled" }
      else if (checks.notInert && inertReason(element) !== null) reason = inertReason(element)
      else if (checks.inViewport && !inViewport(element)) {
        reason = { _tag: "OutsideViewport" }
        if (!scrolled) {
          element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
          scrolled = true
        }
      } else if (checks.stable > 0) {
        rects.push(element.getBoundingClientRect())
        if (rects.length > checks.stable + 1) rects.shift()
        if (rects.length < checks.stable + 1 || !rects.every((rect) => sameRect(rect, rects[0]!))) {
          reason = { _tag: "NotStable" }
        }
      }
      if (reason === null && element !== undefined && checks.receivesPointer) {
        const point = actionPoint(element, request.position)
        const hit = hitTarget(point.x, point.y)
        if (hit === null || !composedContains(element, hit)) {
          reason = { _tag: "Covered", by: hit === null ? "nothing at that point" : describe(hit) }
        }
      }
      if (reason === null && element !== undefined) {
        return { _tag: "Ready", point: actionPoint(element, request.position), element: describe(element), scrolled }
      }
      if (reason!._tag !== "NotStable") rects = []
      // A rect still settling within its first frames is the check working, not a reason to report
      if (reason!._tag !== "NotStable" || rects.length === checks.stable + 1) note(reason!)
      else if (history.length === 0) last = reason!
    }
  }

  const strict = (found: ReadonlyArray<Element>): Response => ({
    _tag: "Strict",
    count: found.length,
    candidates: found.slice(0, 10).map((element) => ({ description: describe(element), visible: visible(element) }))
  })

  const run = async (text: string): Promise<string> => {
    const request = JSON.parse(text) as Request
    rawText.clear()
    roleCache.clear()
    nameCache.clear()
    try {
      switch (request.op) {
        case "count":
          return JSON.stringify({ _tag: "Count", count: resolve(request.steps).length } satisfies Response)
        case "visible": {
          const found = resolve(request.steps)
          if (found.length > 1) return JSON.stringify(strict(found))
          return JSON.stringify(
            {
              _tag: "Visible",
              count: found.length,
              visible: found.length === 1 && visible(found[0]!)
            } satisfies Response
          )
        }
        case "act":
          return JSON.stringify(await act(request))
        case "title":
          return JSON.stringify({ _tag: "Title", title: document.title } satisfies Response)
        case "role":
          return JSON.stringify(
            {
              _tag: "Roles",
              roles: resolve(request.steps).map((element) => ({
                role: roleOf(element),
                name: accessibleName(element, true)
              }))
            } satisfies Response
          )
      }
    } catch (error) {
      if (isInvalidSelector(error)) {
        return JSON.stringify(
          { _tag: "InvalidSelector", selector: error.selector, message: error.message } satisfies Response
        )
      }
      throw error
    }
  }

  return { run }
}

/** The key the engine is installed under in a realm's global: a symbol, out of the way of anything else. */
export const installKey = "@usestrider/browser/engine/1"

/** Installs the engine in a realm, once: a function declaration for `evaluate`. */
export const install = `function() {
  const key = Symbol.for(${JSON.stringify(installKey)});
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, { value: (${engine.toString()})(), enumerable: false });
  }
  return "installed";
}`

/** Runs one request: a function declaration for `evaluate`, taking the request as JSON text. */
export const run = `function(request) {
  const engine = globalThis[Symbol.for(${JSON.stringify(installKey)})];
  return engine === undefined ? "\\u0000missing" : engine.run(request);
}`

/** What `run` answers when the realm has no engine yet. */
export const missing = "\u0000missing"
