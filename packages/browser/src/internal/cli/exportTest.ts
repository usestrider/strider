/**
 * `strider export test` (CLI.md): a session's successful commands as one Vitest test.
 * Every command is one statement against the public API, so the test reads as the session ran: a ref becomes
 * the locator its snapshot names, a secret's `%name%`, wherever the session put one in, its `Config.Redacted`, a
 * wait the `next` it started, with its `--within` as `Deadline.within`, `remove r1` the `remove` of the handle the
 * route or dialog handler gave, and `page name` a variable of the new name.
 * Reads (`pages`, `tabs`, `snapshot`, `find`, `screenshot`, `history`) aren't repeated. What runs only in a session,
 * a segment and a tab taken with `control` until its `release`, is a marked placeholder, which `placeholders` lists.
 * A check of a text with a secret in it is left out, with a comment, since a failed check prints the text (Q248).
 *
 * A page the session came to know without a command that opened it is declared where a later statement names it,
 * as a reader would declare it: a popup with `Popup.next` from just before the command that opened it, or with the
 * wait the session had started on its opener; a page first found among the context's pages by its place there; and
 * a segment's in its placeholder. One the export can't declare so is a marked placeholder too (Q251).
 */
import * as Schema from "effect/Schema"
import type * as Snapshot from "../../Snapshot.ts"
import * as Secrets from "../secrets.ts"
import * as Tools from "../tools.ts"

/** A popup a command opened, by its name and its opener's as the command ran. */
export interface Opened {
  readonly page: string
  readonly opener: string
}

/** A tool call the session ran, by its tool, with that tool's parameters. */
export type ToolStep<K extends Tools.ToolName = Tools.ToolName> = {
  readonly [Name in K]: {
    readonly _tag: "Tool"
    readonly tool: Name
    readonly params: Tools.Params<Name>
    /** The target as a query on its page (`queryOf`), read from the snapshot the call was checked against. */
    readonly target: string | undefined
    /** The handle the call printed, a wait's (`w1`), a registration's (`r1`) or a page's name, or its outcome's text. */
    readonly result: string | undefined
    /** The popups it opened. */
    readonly popups?: ReadonlyArray<Opened> | undefined
  }
}[K]

/** A command the session ran, as the test repeats it, or how it came to know a page no command opened. */
export type Step =
  | {
    readonly _tag: "Viewport"
    readonly page: string
    readonly viewport: { readonly width: number; readonly height: number }
  }
  | {
    readonly _tag: "NewPage"
    readonly page: string
    readonly url: string | undefined
    /** The popups it opened, such as one its page's first document opened. */
    readonly popups?: ReadonlyArray<Opened> | undefined
  }
  | { readonly _tag: "Remove"; readonly registration: string }
  | { readonly _tag: "Rename"; readonly from: string; readonly to: string }
  | {
    readonly _tag: "Segment"
    readonly file: string
    /** The pages it gave the session, by the names they had after it: opened, returned, kept or popups. */
    readonly pages?: ReadonlyArray<string> | undefined
  }
  | ToolStep
  /** A popup that opened while a popup wait the session had started on its opener was pending: the wait gives it. */
  | { readonly _tag: "Popup"; readonly page: string; readonly wait: string }
  /** A page the session first found among its context's pages, at `index`, with no event saying what opened it. */
  | { readonly _tag: "Listed"; readonly page: string; readonly index: number }

/** The page a tool call names, if its tool takes one. */
const pageOf = (step: ToolStep): string | undefined => "page" in step.params ? step.params.page : undefined

/** The matcher each state `expect` waits for is. */
const matchers: { readonly [State in typeof Tools.ExpectedState.Type]: string } = {
  visible: "toBeVisible",
  hidden: "toBeHidden",
  enabled: "toBeEnabled",
  disabled: "toBeDisabled",
  checked: "toBeChecked"
}

/** The module whose `next` waits for each event `next` names. */
const modules: { readonly [Event in typeof Tools.Event.Type]: string } = {
  navigation: "PageNavigation",
  popup: "Popup",
  dialog: "Dialog",
  download: "Download",
  response: "NetworkResponse",
  console: "ConsoleMessage"
}

/** The tools that only read, which the test doesn't repeat. */
const reads = new Set(["pages", "tabs", "snapshot", "find", "screenshot", "history"])

/**
 * The pages the test's statements name, and so must declare: a step's page, a renamed page, and the opener of a popup
 * that is one of them, which the test waits on.
 */
const namedPages = (steps: ReadonlyArray<Step>): ReadonlySet<string> => {
  const named = new Set(steps.flatMap((step) =>
    step._tag === "Viewport" ? [step.page] : step._tag === "Rename"
      ? [step.from]
      : step._tag === "Tool" && !reads.has(step.tool) && step.tool !== "release"
      ? [pageOf(step)].filter((page) => page !== undefined)
      : []
  ))
  const opened = steps.flatMap((step) => step._tag === "Tool" || step._tag === "NewPage" ? step.popups ?? [] : [])
  for (let size = -1; size !== named.size;) {
    size = named.size
    for (const popup of opened) if (named.has(popup.page)) named.add(popup.opener)
  }
  return named
}

/** Names as a sentence lists them: `a`, `a and b`, `a, b and c`. */
const listed = (names: ReadonlyArray<string>) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

/** Where the session's browser came from, as the test's layer names it. */
export type Browser =
  | { readonly _tag: "Launch"; readonly backend: "chromium" | "firefox" | "webkit"; readonly executablePath: string }
  | { readonly _tag: "Attach"; readonly backend: "chromium" | "bidi" | "webkit"; readonly endpoint: string }

const quote = (text: string) => JSON.stringify(text)

/** Text as it stands inside a template literal. */
const literal = (text: string) =>
  JSON.stringify(text).slice(1, -1).replace(/\\"/g, `"`).replace(/`|\$\{/g, (match) => `\\${match}`)

/**
 * A session's context's focus: emulated where the backend has focus emulation, which WebDriver BiDi and stock
 * WebKit haven't, so every page keeps rendering while another is in front (QUIRKS.md, Q19). Stock WebKit's pages are
 * windows of their own. The daemon and the exported test agree.
 */
export const focusFor = (browser: Browser): "emulated" | "system" =>
  browser.backend === "chromium" ? "emulated" : "system"

/** Whether a session launches WebKit, which reaches its browser over TCP. */
const launchesWebKit = (browser: Browser) => browser._tag === "Launch" && browser.backend === "webkit"

const isRef = Schema.is(Tools.Ref)

/**
 * A target as a query on its page, such as `getByRole("button")`; a ref as its snapshot named it. The test puts the
 * page's variable before it, which a page renamed later changes.
 */
export const queryOf = (
  target: string,
  snapshot: Snapshot.Snapshot | undefined
): string => {
  if (isRef(target)) {
    const node = snapshot?.refs.get(target)
    if (node === undefined) return `locator("*") /* ${target}: no snapshot named it */`
    const name = node.name._tag === "None" ? undefined : node.name.value
    if (node.role._tag === "Aria") {
      return name === undefined
        ? `getByRole(${quote(node.role.role)})`
        : `getByRole(${quote(node.role.role)}, { name: ${quote(name)}, exact: true })`
    }
    return name === undefined
      ? `locator("*") /* ${target}: a ${node.role.role} element with no name */`
      : `getByText(${quote(name)}, { exact: true })`
  }
  const [kind, ...rest] = target.split("=")
  const value = rest.join("=")
  const exact = /^"(.*)"$/.exec(value)?.[1]
  switch (kind) {
    case "role": {
      const match = /^([a-z]+)(?:\[name="(.*)"\])?$/.exec(value)
      return match?.[2] === undefined
        ? `getByRole(${quote(match?.[1] ?? value)})`
        : `getByRole(${quote(match[1]!)}, { name: ${quote(match[2])}, exact: true })`
    }
    case "text":
      return exact === undefined
        ? `getByText(${quote(value)})`
        : `getByText(${quote(exact)}, { exact: true })`
    case "label":
      return exact === undefined
        ? `getByLabel(${quote(value)})`
        : `getByLabel(${quote(exact)}, { exact: true })`
    case "testid":
      return `getByTestId(${quote(exact ?? value)})`
    default:
      return `locator(${quote(value)})`
  }
}

/** A locator expression for a target, on the page variable `page`. */
export const locatorOf = (page: string, target: string, snapshot: Snapshot.Snapshot | undefined): string =>
  `${page}.${queryOf(target, snapshot)}`

/** A JavaScript name for a page's name. */
const variable = (name: string) => {
  const camel = name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
  return /^[A-Za-z_$][\w$]*$/.test(camel) ? camel : `page_${camel.replace(/\W/g, "_")}`
}

/** The names the test file declares besides its pages, which a page's variable mustn't take. */
const reserved = [
  "browser",
  "context",
  "describe",
  "it",
  "layer",
  "saved",
  "Bidi",
  "Chromium",
  "Effect",
  "FileSystem",
  "Firefox",
  "HttpServerResponse",
  "Layer",
  "NodeServices",
  "NodeSocket",
  "Redacted",
  "Schema",
  "SocketConnector",
  "WebKit"
]

const imports: Readonly<Record<string, string>> = {
  Browser: "Browser",
  Config: "Config",
  Deadline: "Deadline",
  Dialog: "Dialog",
  Download: "Download",
  Expect: "Expect",
  NetworkResponse: "NetworkResponse",
  PageNavigation: "PageNavigation",
  Popup: "Popup",
  Route: "Route",
  ConsoleMessage: "ConsoleMessage",
  StorageState: "StorageState"
}

/** The test file, and what each of its placeholders stands for, which `export test` lists. */
export const render = (options: {
  readonly name: string
  readonly browser: Browser
  readonly secrets: Readonly<Record<string, string>>
  readonly state: string | undefined
  /** The session `start --fork` copied the state of, which no file holds. */
  readonly fork?: string | undefined
  /** The profile `start --user-data-dir` gave the session's browser, which that browser keeps locked. */
  readonly userDataDir?: string | undefined
  readonly viewport?: { readonly width: number; readonly height: number } | undefined
  readonly steps: ReadonlyArray<Step>
}): { readonly text: string; readonly placeholders: ReadonlyArray<string> } => {
  const used = new Set<string>(["Browser"])
  const placeholders: Array<string> = []
  const contextOptions = [
    focusFor(options.browser) === "emulated" ? `focus: "emulated"` : undefined,
    options.viewport === undefined
      ? undefined
      : `emulation: { viewport: { width: ${options.viewport.width}, height: ${options.viewport.height} } }`
  ].filter((value) => value !== undefined).join(", ")
  const settings = contextOptions === "" ? undefined : contextOptions
  // What the test can't start from, it says, and starts without
  const started = [
    ...(options.fork === undefined ? [] : [
      `// The session started from session ${options.fork}'s state (start --fork), which no file holds: this test's context starts empty`
    ]),
    ...(options.userDataDir === undefined ? [] : [
      `// The session's browser ran on the profile at ${options.userDataDir} (start --user-data-dir), which that browser keeps locked: this test's starts with an empty one`
    ])
  ]
  const body: Array<string> = options.state === undefined
    ? [...started, `const context = yield* Browser.newContext(${settings === undefined ? "" : `{ ${settings} }`})`]
    : [
      ...started,
      `const saved = yield* (yield* FileSystem.FileSystem).readFileString(${quote(options.state)})`,
      `const context = yield* Browser.newContext({ storageState: yield* Schema.decodeEffect(StorageState.Json)(saved)${
        settings === undefined ? "" : `, ${settings}`
      } })`
    ]
  if (options.state !== undefined) used.add("StorageState")
  // A route or dialog handler the session removed keeps its handle, whose remove ends it where the session did
  const removed = new Set(options.steps.flatMap((step) => step._tag === "Remove" ? [step.registration] : []))
  const handle = (step: Step) =>
    step._tag === "Tool" && step.result !== undefined && removed.has(step.result) ? `const ${step.result} = ` : ""
  // Each page's variable, by the name the session gives it now: a page renamed is the variable of its new name
  const taken = new Set([...reserved, ...Object.keys(imports)])
  const fresh = (base: string) => {
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    return name
  }
  const variables = new Map<string, string>()
  const declare = (page: string) => {
    const name = fresh(variable(page))
    variables.set(page, name)
    return name
  }
  // A page no command opened is declared only where a statement names it
  const named = namedPages(options.steps)
  /** The popups a wait the session started gives, declared from it when a statement first names them. */
  const pending = new Map<string, string>()
  /** A page's variable, declared first if it's a page the session only saw, or a placeholder if no step opened it. */
  const use = (page: string): string => {
    const known = variables.get(page)
    if (known !== undefined) return known
    const wait = pending.get(page)
    pending.delete(page)
    const declared = declare(page)
    if (wait !== undefined) {
      body.push(`const ${declared} = yield* ${wait}`)
      return declared
    }
    placeholders.push(`page ${page}, which no command the test repeats opened`)
    body.push(
      `// TODO page ${page}: the session had it, but no command the test repeats opened it; declare it here, as ${declared}`
    )
    return declared
  }
  /**
   * A command's popups that a statement names: each opener's first is waited for with `Popup.next` from just before
   * the command, or, for the page the command opens, from just after it's declared. `Popup.next` gives an opener's
   * first popup alone, so a second popup of one opener, or a popup of a popup, that the same command opened is a
   * placeholder.
   */
  const popupsOf = (popups: ReadonlyArray<Opened> | undefined, self: string | undefined) => {
    const shown = (popups ?? []).filter((popup) => named.has(popup.page))
    const ours = new Set(shown.map((popup) => popup.page))
    const firsts = new Set<string>()
    const waits = shown.map((popup) => {
      const first = !firsts.has(popup.opener) && !ours.has(popup.opener)
      firsts.add(popup.opener)
      return { ...popup, first, wait: undefined as string | undefined }
    })
    const subscribe = (own: boolean) => {
      for (const each of waits) {
        if (!each.first || (each.opener === self) !== own) continue
        used.add("Popup")
        const opener = use(each.opener)
        each.wait = fresh(`${opener}Popups`)
        body.push(`const ${each.wait} = yield* Popup.next(${opener})`)
      }
    }
    return {
      before: () => subscribe(false),
      declared: () => subscribe(true),
      after: () => {
        for (const each of waits) {
          if (each.wait !== undefined) {
            body.push(`const ${declare(each.page)} = yield* ${each.wait}`)
            continue
          }
          const declared = declare(each.page)
          placeholders.push(`page ${each.page}, a popup that Popup.next can't single out`)
          body.push(
            `// TODO page ${each.page}: one of several popups the command above opened, which Popup.next can't single out; declare it here, as ${declared}`
          )
        }
      }
    }
  }
  // A secret's `%name%` anywhere in a fill's value or a URL is its value, which the session put in as the call ran;
  // any other `%…%`, such as a URL's `%C3%`, is text, as the session sent it (Q250)
  const split = (text: string) => Secrets.split(text, Object.keys(options.secrets))
  const hasSecret = (text: string) => split(text).length > 1
  const secret = (name: string) => {
    used.add("Config")
    return `yield* Config.Redacted(${quote(options.secrets[name]!)})`
  }
  /** A string with the secrets' values put in where the session put them, built from each secret's config. */
  const revealed = (text: string) => {
    const parts = split(text)
    if (parts.length === 1) return quote(text)
    used.add("Redacted")
    const value = (name: string) => `Redacted.value(${secret(name)})`
    if (parts.length === 3 && parts[0] === "" && parts[2] === "") return value(parts[1]!)
    return `\`${parts.map((part, index) => index % 2 === 1 ? `\${${value(part)}}` : literal(part)).join("")}\``
  }
  /** A fill's value: one with a secret in it stays redacted, as the session filled it. */
  const filled = (text: string) => {
    const parts = split(text)
    if (parts.length === 3 && parts[0] === "" && parts[2] === "") return secret(parts[1]!)
    return parts.length > 1 ? `Redacted.make(${revealed(text)})` : quote(text)
  }
  const viewports = new Map<string, string>()
  for (const step of options.steps) {
    if (step._tag === "Viewport") {
      const page = use(step.page)
      const registration = fresh(`${page}Viewport`)
      body.push(
        `const ${registration} = yield* ${page}.emulate({ viewport: { width: ${step.viewport.width}, height: ${step.viewport.height} } })`
      )
      const previous = viewports.get(page)
      if (previous !== undefined) body.push(`yield* ${previous}.remove`)
      viewports.set(page, registration)
      continue
    }
    if (step._tag === "Segment") {
      // A segment runs only inside a session: its code goes here by hand, declaring the pages later steps name
      const pages = (step.pages ?? []).filter((page) => named.has(page) && !variables.has(page)).map(declare)
      const declaring = pages.length === 0 ? "" : `, declaring ${listed(pages)}`
      placeholders.push(`strider run ${step.file}, which runs only in a session${declaring}`)
      body.push(`// TODO strider run ${step.file}: a segment runs only in a session; put its steps here${declaring}`)
      continue
    }
    if (step._tag === "Popup") {
      if (!variables.has(step.page)) pending.set(step.page, step.wait)
      continue
    }
    if (step._tag === "Listed") {
      // As a reader waits for a page no event announces: by its place among the context's pages
      if (named.has(step.page) && !variables.has(step.page)) {
        body.push(
          `const ${declare(step.page)} = (yield* context.pages.waitFor((pages) => pages.length >= ${
            step.index + 1
          }))[${step.index}]!`
        )
      }
      continue
    }
    if (step._tag === "NewPage") {
      const popups = popupsOf(step.popups, step.page)
      popups.before()
      const page = declare(step.page)
      body.push(`const ${page} = yield* context.newPage`)
      popups.declared()
      if (step.url !== undefined) body.push(`yield* ${page}.goto(${revealed(step.url)})`)
      popups.after()
      continue
    }
    if (step._tag === "Remove") {
      body.push(`yield* ${step.registration}.remove`)
      continue
    }
    if (step._tag === "Rename") {
      // `page name`: later steps name the page by its new name, which is a variable of its own from here
      const from = use(step.from)
      variables.delete(step.from)
      const to = declare(step.to)
      body.push(`const ${to} = ${from}`)
      const viewport = viewports.get(from)
      if (viewport !== undefined) {
        viewports.delete(from)
        viewports.set(to, viewport)
      }
      continue
    }
    if (reads.has(step.tool)) continue
    if (step.tool === "control") {
      // A tab the session took from the browser: the test takes it with control, or opens its own page, under the
      // variable later steps use
      const tab = step.params.tab ?? step.params.url
      placeholders.push(`strider control ${tab}, a tab of the browser's own`)
      body.push(
        `// TODO strider control ${tab}: a tab of the browser's own; take it with page.control in the test${
          step.result === undefined ? "" : `, as ${declare(step.result)}`
        }`
      )
      continue
    }
    if (step.tool === "release") {
      // Where the session gave the tab back, which ends the scope control took it in
      const name = step.params.page
      placeholders.push(`strider release -p ${name}, which gives back a tab the test takes by hand`)
      body.push(
        `// TODO strider release -p ${name}: the session gave the tab back here; close the scope it was taken in`
      )
      variables.delete(name)
      continue
    }
    const pageName = pageOf(step)
    const page = pageName === undefined ? "page" : use(pageName)
    const target = step.target === undefined ? "" : `${page}.${step.target}`
    // Through strider mcp, newPage opens a page under the name the toolkit gave it
    const opens = step.tool === "newPage" ? step.result ?? step.params.name ?? "page" : undefined
    const popups = popupsOf(step.popups, opens)
    popups.before()
    switch (step.tool) {
      case "newPage": {
        const opened = declare(opens!)
        body.push(`const ${opened} = yield* context.newPage`)
        popups.declared()
        if (step.params.url !== undefined) body.push(`yield* ${opened}.goto(${revealed(step.params.url)})`)
        break
      }
      case "goto":
        body.push(`yield* ${page}.goto(${revealed(step.params.url)})`)
        break
      case "back":
        body.push(`yield* ${page}.back()`)
        break
      case "click":
        body.push(`yield* ${target}.click()`)
        break
      case "fill":
        body.push(`yield* ${target}.fill(${filled(step.params.value)})`)
        break
      case "press":
        body.push(
          step.params.target === undefined
            ? `yield* ${page}.keyboard.press(${quote(step.params.key)})`
            : `yield* ${target}.press(${quote(step.params.key)})`
        )
        break
      case "select":
        body.push(
          `yield* ${target}.selectOption([${
            step.params.values.map((label) => `{ label: ${quote(label)} }`).join(", ")
          }])`
        )
        break
      case "scroll":
        body.push(`yield* ${target}.scrollIntoView()`)
        break
      case "expect": {
        used.add("Expect")
        body.push(`yield* ${target}.pipe(Expect.${matchers[step.params.state]})`)
        const text = step.params.text
        if (text !== undefined) {
          // A text with a secret in it isn't checked: a failed check prints the text it expected
          body.push(
            hasSecret(text)
              ? `// Left out: the session's check that this contains ${
                quote(text)
              }, which has a secret in it, since a failed check prints the text it expected`
              : `yield* ${target}.pipe(Expect.toContainText(${quote(text)}))`
          )
        }
        break
      }
      case "next": {
        const wait = step.result ?? "wait"
        const module = modules[step.params.event]
        used.add(module)
        // --within is the deadline the wait took at next, as Deadline.within around next gives it. A duration
        // parses with any whitespace before its unit, and Duration.Input's type takes one space
        const within = step.params.within === undefined
          ? ""
          : `.pipe(Deadline.within(${quote(step.params.within.replace(/\s+/, " "))}))`
        if (within !== "") used.add("Deadline")
        body.push(
          `const ${wait} = yield* ${module}.next(${page}${
            module === "NetworkResponse" ? `, { url: ${quote(step.params.url ?? "")} }` : ""
          })${within}`
        )
        break
      }
      case "await": {
        // A popup a statement named before the session collected it is declared already
        const popup = step.result !== undefined ? /^popup (\S+),/.exec(step.result)?.[1] : undefined
        if (popup !== undefined) pending.delete(popup)
        body.push(
          popup === undefined || variables.has(popup)
            ? `yield* ${step.params.wait}`
            : `const ${declare(popup)} = yield* ${step.params.wait}`
        )
        break
      }
      case "route": {
        used.add("Route")
        const { action, body: text, contentType, pattern, status } = step.params
        const decision = action === "abort"
          ? "Route.abort()"
          : action === "continue"
          ? "Route.continue"
          : `Route.fulfill(HttpServerResponse.text(${quote(text ?? "")}, { status: ${status ?? 200}${
            contentType === undefined ? "" : `, contentType: ${quote(contentType)}`
          } }))`
        body.push(`${handle(step)}yield* ${page}.route(${quote(pattern)}, () => Effect.succeed(${decision}))`)
        break
      }
      case "dialog": {
        used.add("Dialog")
        const { decision, text } = step.params
        body.push(
          handle(step) + (decision === "accept" && text !== undefined
            // As in the session, a dialog of unknown kind, as every dialog on WebKit is, gets the text too
            ? `yield* Dialog.handle(${page}, (dialog) => Effect.succeed(dialog._tag === "Prompt" || dialog._tag === "Unknown" ? dialog.respond(${
              quote(text)
            }) : dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept))`
            : `yield* Dialog.handle(${page}, Dialog.${decision === "accept" ? "acceptAll" : "dismissAll"})`)
        )
        break
      }
    }
    popups.after()
  }
  const layer = options.browser._tag === "Launch"
    ? {
      chromium: { module: "chromium", name: "Chromium" },
      firefox: { module: "firefox", name: "Firefox" },
      webkit: { module: "webkit", name: "WebKit" }
    }[options.browser.backend]
    : options.browser.backend === "chromium"
    ? { module: "chromium", name: "Chromium" }
    : options.browser.backend === "webkit"
    ? { module: "webkit", name: "WebKit" }
    : { module: "bidi", name: "Bidi" }
  const browserLayer = options.browser._tag === "Launch"
    ? `${layer.name}.layer({ executablePath: ${quote(options.browser.executablePath)} })`
    : `${layer.name}.${options.browser.backend === "webkit" ? "layerAttach" : "layerConnect"}(${
      quote(options.browser.endpoint)
    })`
  const library = [...used].filter((each) => each !== "Config" && each !== "Redacted").map((each) =>
    imports[each] ?? each
  ).sort()
  const needsResponse = options.steps.some((step) =>
    step._tag === "Tool" && step.tool === "route" && step.params.action === "fulfill"
  )
  const lines = [
    `// Exported from the strider session ${options.name}. Each statement is one command the session ran.`,
    `import * as NodeServices from "@effect/platform-node/NodeServices"`,
    `import { describe, layer } from "@effect/vitest"`,
    `import { ${library.join(", ")} } from "@usestrider/browser"`,
    `import { ${layer.name} } from "@usestrider/browser/${layer.module}"`,
    `import { ${
      [
        ...(used.has("Config") ? ["Config"] : []),
        "Effect",
        ...(options.state === undefined ? [] : ["FileSystem"]),
        "Layer",
        ...(used.has("Redacted") ? ["Redacted"] : []),
        ...(options.state === undefined ? [] : ["Schema"])
      ].join(", ")
    } } from "effect"`,
    ...(needsResponse ? [`import { HttpServerResponse } from "effect/http"`] : []),
    ...(launchesWebKit(options.browser)
      ? [
        `import * as NodeSocket from "@effect/platform-node/NodeSocket"`,
        `import { SocketConnector } from "@usestrider/browser/protocol"`
      ]
      : []),
    ``,
    launchesWebKit(options.browser)
      ? `const browser = ${browserLayer}.pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port })))))`
      : `const browser = ${browserLayer}.pipe(Layer.provide(NodeServices.layer))`,
    ``,
    `describe(${quote(options.name)}, () => {`,
    `  layer(browser, { excludeTestServices: true })((it) => {`,
    `    it.effect(${quote(options.name)}, () =>`,
    `      Effect.scoped(Effect.gen(function*() {`,
    ...body.map((line) => `        ${line}`),
    `      })))`,
    `  })`,
    `})`,
    ``
  ]
  return { text: lines.join("\n"), placeholders }
}
