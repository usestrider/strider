/**
 * `strider export test` (CLI.md): a session's successful commands as one Vitest test.
 * Every command is one statement against the public API, so the test reads as the session ran: a ref becomes
 * the locator its snapshot names, a `%name%` secret its `Config.Redacted`, a wait the `next` it started, with
 * its `--within` as `Deadline.within`, and `remove r1` the `remove` of the handle the route or dialog handler gave.
 * Reads (`pages`, `tabs`, `snapshot`, `find`, `screenshot`, `history`) aren't repeated. What runs only in a session,
 * a segment and a tab taken with `control` until its `release`, is a marked placeholder, which `placeholders` lists.
 */
import type * as Snapshot from "../../Snapshot.ts"

/** A command the session ran, as the test repeats it. */
export type Step =
  | { readonly _tag: "NewPage"; readonly page: string; readonly url: string | undefined }
  | { readonly _tag: "Remove"; readonly registration: string }
  | { readonly _tag: "Rename"; readonly from: string; readonly to: string }
  | { readonly _tag: "Segment"; readonly file: string }
  | {
    readonly _tag: "Tool"
    readonly tool: string
    readonly params: Readonly<Record<string, unknown>>
    /** The target as a query on its page (`queryOf`), read from the snapshot the call was checked against. */
    readonly target: string | undefined
    /** The handle the call printed, a wait's (`w1`), a registration's (`r1`) or a page's name, or its outcome's text. */
    readonly result: string | undefined
  }

/** Where the session's browser came from, as the test's layer names it. */
export type Browser =
  | { readonly _tag: "Launch"; readonly backend: "chromium" | "firefox" | "webkit"; readonly executablePath: string }
  | { readonly _tag: "Attach"; readonly backend: "chromium" | "bidi"; readonly endpoint: string }

const quote = (text: string) => JSON.stringify(text)

/**
 * A session's context's focus: emulated where the backend has focus emulation, which WebDriver BiDi and stock
 * WebKit haven't, so every page keeps rendering while another is in front (QUIRKS.md, Q19). Stock WebKit's pages are
 * windows of their own. The daemon and the exported test agree.
 */
export const focusFor = (browser: Browser): "emulated" | "system" =>
  browser.backend === "chromium" ? "emulated" : "system"

/** Whether a session launches WebKit, which reaches its browser over TCP. */
const launchesWebKit = (browser: Browser) => browser._tag === "Launch" && browser.backend === "webkit"

/**
 * A target as a query on its page, such as `getByRole("button")`; a ref as its snapshot named it. The test puts the
 * page's variable before it, which a page renamed later changes.
 */
export const queryOf = (
  target: string,
  snapshot: Snapshot.Snapshot | undefined
): string => {
  if (/^e\d+$/.test(target)) {
    const node = snapshot?.refs.get(target as Snapshot.RefId)
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
  readonly steps: ReadonlyArray<Step>
}): { readonly text: string; readonly placeholders: ReadonlyArray<string> } => {
  const used = new Set<string>(["Browser"])
  const placeholders: Array<string> = []
  const focus = focusFor(options.browser) === "emulated" ? `focus: "emulated"` : undefined
  const body: Array<string> = options.state === undefined
    ? [`const context = yield* Browser.newContext(${focus === undefined ? "" : `{ ${focus} }`})`]
    : [
      `const saved = yield* (yield* FileSystem.FileSystem).readFileString(${quote(options.state)})`,
      `const context = yield* Browser.newContext({ storageState: yield* Schema.decodeEffect(StorageState.Json)(saved)${
        focus === undefined ? "" : `, ${focus}`
      } })`
    ]
  if (options.state !== undefined) used.add("StorageState")
  // A route or dialog handler the session removed keeps its handle, whose remove ends it where the session did
  const removed = new Set(options.steps.flatMap((step) => step._tag === "Remove" ? [step.registration] : []))
  const handle = (step: Step) =>
    step._tag === "Tool" && step.result !== undefined && removed.has(step.result) ? `const ${step.result} = ` : ""
  // Each page's variable, by the name the session gives it now: a page renamed is the variable of its new name
  const taken = new Set([...reserved, ...Object.keys(imports)])
  const variables = new Map<string, string>()
  const declare = (page: string) => {
    let name = variable(page)
    for (let n = 2; taken.has(name); n++) name = `${variable(page)}_${n}`
    taken.add(name)
    variables.set(page, name)
    return name
  }
  const pageVariable = (page: string) => variables.get(page) ?? variable(page)
  const value = (text: string) => {
    const secret = /^%([A-Za-z_][\w-]*)%$/.exec(text)?.[1]
    if (secret === undefined) return quote(text)
    used.add("Config")
    return `yield* Config.Redacted(${quote(options.secrets[secret] ?? secret.toUpperCase())})`
  }
  for (const step of options.steps) {
    if (step._tag === "Segment") {
      // A segment runs only inside a session: its code goes here by hand
      placeholders.push(`strider run ${step.file}, which runs only in a session`)
      body.push(`// TODO strider run ${step.file}: a segment runs only in a session; put its steps here`)
      continue
    }
    if (step._tag === "NewPage") {
      const page = declare(step.page)
      body.push(`const ${page} = yield* context.newPage`)
      if (step.url !== undefined) body.push(`yield* ${page}.goto(${quote(step.url)})`)
      continue
    }
    if (step._tag === "Remove") {
      body.push(`yield* ${step.registration}.remove`)
      continue
    }
    if (step._tag === "Rename") {
      // `page name`: later steps name the page by its new name, which is a variable of its own from here
      const from = pageVariable(step.from)
      variables.delete(step.from)
      body.push(`const ${declare(step.to)} = ${from}`)
      continue
    }
    if (step._tag === "Tool" && step.tool === "control") {
      // A tab the session took from the browser: the test takes it with control, or opens its own page, under the
      // variable later steps use
      const tab = String((step.params as { tab?: string; url?: string }).tab ?? (step.params as { url?: string }).url)
      placeholders.push(`strider control ${tab}, a tab of the browser's own`)
      body.push(
        `// TODO strider control ${tab}: a tab of the browser's own; take it with page.control in the test${
          step.result === undefined ? "" : `, as ${declare(step.result)}`
        }`
      )
      continue
    }
    if (step._tag === "Tool" && step.tool === "release") {
      // Where the session gave the tab back, which ends the scope control took it in
      const name = String(step.params.page)
      placeholders.push(`strider release -p ${name}, which gives back a tab the test takes by hand`)
      body.push(
        `// TODO strider release -p ${name}: the session gave the tab back here; close the scope it was taken in`
      )
      variables.delete(name)
      continue
    }
    const params = step.params as Record<string, string | ReadonlyArray<string> | number | undefined>
    const page = typeof params.page === "string" ? pageVariable(params.page) : "page"
    const target = step.target === undefined ? "" : `${page}.${step.target}`
    switch (step.tool) {
      case "newPage": {
        // Through strider mcp, under the name the toolkit gave it
        const opened = declare(step.result ?? String(params.name ?? "page"))
        body.push(`const ${opened} = yield* context.newPage`)
        if (params.url !== undefined) body.push(`yield* ${opened}.goto(${quote(String(params.url))})`)
        break
      }
      case "goto":
        body.push(`yield* ${page}.goto(${quote(String(params.url))})`)
        break
      case "back":
        body.push(`yield* ${page}.back()`)
        break
      case "click":
        body.push(`yield* ${target}.click()`)
        break
      case "fill":
        body.push(`yield* ${target}.fill(${value(String(params.value))})`)
        break
      case "press":
        body.push(
          params.target === undefined
            ? `yield* ${page}.keyboard.press(${quote(String(params.key))})`
            : `yield* ${target}.press(${quote(String(params.key))})`
        )
        break
      case "select":
        body.push(
          `yield* ${target}.selectOption([${
            (params.values as ReadonlyArray<string>).map((label) => `{ label: ${quote(label)} }`).join(", ")
          }])`
        )
        break
      case "scroll":
        body.push(`yield* ${target}.scrollIntoView()`)
        break
      case "expect": {
        used.add("Expect")
        const matcher = {
          visible: "toBeVisible",
          hidden: "toBeHidden",
          enabled: "toBeEnabled",
          disabled: "toBeDisabled",
          checked: "toBeChecked"
        }[String(params.state)] ?? "toBeVisible"
        body.push(`yield* ${target}.pipe(Expect.${matcher})`)
        if (params.text !== undefined) {
          body.push(`yield* ${target}.pipe(Expect.toContainText(${quote(String(params.text))}))`)
        }
        break
      }
      case "next": {
        const wait = step.result ?? "wait"
        const module = {
          navigation: "PageNavigation",
          popup: "Popup",
          dialog: "Dialog",
          download: "Download",
          response: "NetworkResponse",
          console: "ConsoleMessage"
        }[String(params.event)] ?? "PageNavigation"
        used.add(module)
        // --within is the deadline the wait took at next, as Deadline.within around next gives it. A duration
        // parses with any whitespace before its unit, and Duration.Input's type takes one space
        if (params.within !== undefined) used.add("Deadline")
        const within = params.within === undefined
          ? ""
          : `.pipe(Deadline.within(${quote(String(params.within).replace(/\s+/, " "))}))`
        body.push(
          `const ${wait} = yield* ${module}.next(${page}${
            module === "NetworkResponse" ? `, { url: ${quote(String(params.url))} }` : ""
          })${within}`
        )
        break
      }
      case "await": {
        const popup = step.result !== undefined ? /^popup (\S+),/.exec(step.result)?.[1] : undefined
        body.push(
          popup === undefined
            ? `yield* ${String(params.wait)}`
            : `const ${declare(popup.replace(/,$/, ""))} = yield* ${String(params.wait)}`
        )
        break
      }
      case "route": {
        used.add("Route")
        const decision = params.action === "abort"
          ? "Route.abort()"
          : params.action === "continue"
          ? "Route.continue"
          : `Route.fulfill(HttpServerResponse.text(${quote(String(params.body ?? ""))}, { status: ${
            params.status ?? 200
          }${params.contentType === undefined ? "" : `, contentType: ${quote(String(params.contentType))}`} }))`
        body.push(
          `${handle(step)}yield* ${page}.route(${quote(String(params.pattern))}, () => Effect.succeed(${decision}))`
        )
        break
      }
      case "dialog":
        used.add("Dialog")
        body.push(
          handle(step) + (params.decision === "accept" && params.text !== undefined
            // As in the session, a dialog of unknown kind, as every dialog on WebKit is, gets the text too
            ? `yield* Dialog.handle(${page}, (dialog) => Effect.succeed(dialog._tag === "Prompt" || dialog._tag === "Unknown" ? dialog.respond(${
              quote(String(params.text))
            }) : dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept))`
            : `yield* Dialog.handle(${page}, Dialog.${params.decision === "accept" ? "acceptAll" : "dismissAll"})`)
        )
        break
    }
  }
  const layer = options.browser._tag === "Launch"
    ? {
      chromium: { module: "chromium", name: "Chromium" },
      firefox: { module: "firefox", name: "Firefox" },
      webkit: { module: "webkit", name: "WebKit" }
    }[options.browser.backend]
    : options.browser.backend === "chromium"
    ? { module: "chromium", name: "Chromium" }
    : { module: "bidi", name: "Bidi" }
  const browserLayer = options.browser._tag === "Launch"
    ? `${layer.name}.layer({ executablePath: ${quote(options.browser.executablePath)} })`
    : `${layer.name}.layerConnect(${quote(options.browser.endpoint)})`
  const library = [...used].filter((each) => each !== "Config").map((each) => imports[each] ?? each).sort()
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
