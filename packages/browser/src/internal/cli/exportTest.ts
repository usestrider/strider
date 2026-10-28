/**
 * `strider export test` (CLI.md): a session's successful commands as one Vitest test.
 * Every command is one statement against the public API, so the test reads as the session ran: a ref becomes
 * the locator its snapshot names, a `%name%` secret its `Config.Redacted`, a wait the `next` it started, with
 * its `--within` as `Deadline.within`, and `remove r1` the `remove` of the handle the route or dialog handler gave.
 * Reads (`pages`, `snapshot`, `screenshot`, `history`) aren't repeated.
 */
import type * as Snapshot from "../../Snapshot.ts"

/** A command the session ran, as the test repeats it. */
export type Step =
  | { readonly _tag: "NewPage"; readonly page: string; readonly url: string | undefined }
  | { readonly _tag: "Remove"; readonly registration: string }
  | { readonly _tag: "Segment"; readonly file: string }
  | {
    readonly _tag: "Tool"
    readonly tool: string
    readonly params: Readonly<Record<string, unknown>>
    readonly target: string | undefined
    /** The handle the call printed, a wait's (`w1`) or a registration's (`r1`), or else its outcome's text. */
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

/** A locator expression for a target, on the page variable `page`; a ref as its snapshot named it. */
export const locatorOf = (
  page: string,
  target: string,
  snapshot: Snapshot.Snapshot | undefined
): string => {
  if (/^e\d+$/.test(target)) {
    const node = snapshot?.refs.get(target as Snapshot.RefId)
    if (node === undefined) return `${page}.locator("*") /* ${target}: no snapshot named it */`
    const name = node.name._tag === "None" ? undefined : node.name.value
    if (node.role._tag === "Aria") {
      return name === undefined
        ? `${page}.getByRole(${quote(node.role.role)})`
        : `${page}.getByRole(${quote(node.role.role)}, { name: ${quote(name)}, exact: true })`
    }
    return name === undefined
      ? `${page}.locator("*") /* ${target}: a ${node.role.role} element with no name */`
      : `${page}.getByText(${quote(name)}, { exact: true })`
  }
  const [kind, ...rest] = target.split("=")
  const value = rest.join("=")
  const exact = /^"(.*)"$/.exec(value)?.[1]
  switch (kind) {
    case "role": {
      const match = /^([a-z]+)(?:\[name="(.*)"\])?$/.exec(value)
      return match?.[2] === undefined
        ? `${page}.getByRole(${quote(match?.[1] ?? value)})`
        : `${page}.getByRole(${quote(match[1]!)}, { name: ${quote(match[2])}, exact: true })`
    }
    case "text":
      return exact === undefined
        ? `${page}.getByText(${quote(value)})`
        : `${page}.getByText(${quote(exact)}, { exact: true })`
    case "label":
      return exact === undefined
        ? `${page}.getByLabel(${quote(value)})`
        : `${page}.getByLabel(${quote(exact)}, { exact: true })`
    case "testid":
      return `${page}.getByTestId(${quote(exact ?? value)})`
    default:
      return `${page}.locator(${quote(value)})`
  }
}

/** A JavaScript name for a page's name. */
const variable = (name: string) => {
  const camel = name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
  return /^[A-Za-z_$][\w$]*$/.test(camel) ? camel : `page_${camel.replace(/\W/g, "_")}`
}

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

/** The test file. */
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
  const pages = new Set<string>()
  const value = (text: string) => {
    const secret = /^%([A-Za-z_][\w-]*)%$/.exec(text)?.[1]
    if (secret === undefined) return quote(text)
    used.add("Config")
    return `yield* Config.Redacted(${quote(options.secrets[secret] ?? secret.toUpperCase())})`
  }
  for (const step of options.steps) {
    if (step._tag === "Segment") {
      // A segment runs only inside a session: its code goes here by hand
      placeholders.push(step.file)
      body.push(`// TODO strider run ${step.file}: a segment runs only in a session; put its steps here`)
      continue
    }
    if (step._tag === "NewPage") {
      const page = variable(step.page)
      pages.add(step.page)
      body.push(`const ${page} = yield* context.newPage`)
      if (step.url !== undefined) body.push(`yield* ${page}.goto(${quote(step.url)})`)
      continue
    }
    if (step._tag === "Remove") {
      body.push(`yield* ${step.registration}.remove`)
      continue
    }
    if (step._tag === "Tool" && step.tool === "control") {
      // A tab the session took from the browser: the test takes it with control, or opens its own page
      const tab = String((step.params as { tab?: string; url?: string }).tab ?? (step.params as { url?: string }).url)
      placeholders.push(`control ${tab}`)
      body.push(`// TODO strider control ${tab}: a tab of the browser's own; take it with page.control in the test`)
      continue
    }
    const params = step.params as Record<string, string | ReadonlyArray<string> | number | undefined>
    const page = typeof params.page === "string" ? variable(params.page) : "page"
    const target = step.target ?? ""
    switch (step.tool) {
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
            : `const ${variable(popup.replace(/,$/, ""))} = yield* ${String(params.wait)}`
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
