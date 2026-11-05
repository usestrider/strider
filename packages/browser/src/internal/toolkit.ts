/**
 * The agent toolkit's handlers: the tools of `tools.ts`, bound to one context.
 *
 * - **Pages by name.** A page is named when it is created (`newPage`'s `name`, or `p1`, `p2`…) or first seen,
 *   as a popup is. Every page tool names its page; there is no current one.
 * - **Targets** are a ref, checked against the page's latest snapshot, or a locator string that maps to one
 *   query; a bad one fails at once.
 * - **The digest.** The context's and each page's event channels are recorded from the start, and each result
 *   takes what they recorded since the previous call: navigations, popups, dialogs and who decided them,
 *   downloads, uncaught exceptions, console errors and failed requests. No tool waits after it acts.
 * - **Secrets.** A `%name%` in a parameter, for a name among the secrets, is the secret's value at dispatch, and
 *   every result and digest line has the values put back as `%name%`. Other text between `%` signs, such as a
 *   URL's `%C3%`, is sent as written.
 * - **Capture.** The policy decides whether screenshots are sent and how much console text the digest carries.
 *   Redacted snapshots mask editable fields' text and all validation messages, keeping invalid state and refs;
 *   full snapshots retain that text and those messages. `CapturePolicy.strict` uses redacted snapshots.
 */
import type * as Toolkit from "effect/ai/Toolkit"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type * as CapturePolicy from "../ai/CapturePolicy.ts"
import type * as Browser from "../Browser.ts"
import * as ConsoleMessage from "../ConsoleMessage.ts"
import * as Deadline from "../Deadline.ts"
import type * as Declaration from "../Declaration.ts"
import * as Dialog from "../Dialog.ts"
import * as Download from "../Download.ts"
import * as Expect from "../Expect.ts"
import type * as Locator from "../Locator.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import * as PageNavigation from "../PageNavigation.ts"
import * as Popup from "../Popup.ts"
import * as Route from "../Route.ts"
import type * as Snapshot from "../Snapshot.ts"
import type * as Target from "../Target.ts"
import * as UncaughtException from "../UncaughtException.ts"
import type * as UserContext from "../UserContext.ts"
import * as Events from "./events.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Secrets from "./secrets.ts"
import * as Tools from "./tools.ts"
import * as UrlPattern from "./urlPattern.ts"

/** What a toolkit is bound to. */
export interface Options {
  readonly context: UserContext.UserContext
  readonly secrets: Readonly<Record<string, Redacted.Redacted<string>>>
  readonly capture: CapturePolicy.CapturePolicy
  /** The browser, for `tabs` and `control`; without it, they fail with `NotPermitted`. */
  readonly browser?: Browser.Browser | undefined
  /**
   * Whether the context's pages enter the session automatically. An attached inspector shares the browser's
   * default context, so its tabs are acquired through explicit control instead.
   * @default true
   */
  readonly discoverContextPages?: boolean | undefined
  /** Told of each page the toolkit comes to know that no tool opened, as the CLI's exported test declares it. */
  readonly seen?: ((seen: Seen) => void) | undefined
}

/**
 * A page the toolkit came to know that no tool opened: one it found among the context's pages and named, at its
 * place there, or a popup a page it watches opened, told each time one opens, named before or not.
 */
export type Seen =
  | { readonly _tag: "Listed"; readonly page: Page.Page; readonly name: string; readonly index: number }
  | {
    readonly _tag: "Popup"
    readonly page: Page.Page
    readonly name: string
    readonly opener: Page.Page
    /** The opener's name as the popup opened. */
    readonly openerName: string
  }

/**
 * Told of each page a call opens, by its id, as soon as it opens and before it navigates, in the fiber of the call
 * that opened it: the CLI's daemon gives a page's popups to the command that opened it.
 */
export const Opened = Context.Reference<(page: string) => void>("@usestrider/browser/internal/toolkit/Opened", {
  defaultValue: () => () => {}
})

const failed = (error: string, message: string, reason?: string) =>
  new Tools.ToolFailure({ error, message, ...(reason === undefined ? {} : { reason }) })

/** A library error, as the model sees it: its tag, its reason's, and its message, hint included. */
export const toFailure = (error: unknown): Tools.ToolFailure => {
  if (error instanceof Tools.ToolFailure) return error
  const tagged = error as {
    readonly _tag?: unknown
    readonly reason?: { readonly _tag?: unknown }
    readonly message?: unknown
  }
  return failed(
    typeof tagged._tag === "string" ? tagged._tag : "Error",
    typeof tagged.message === "string" ? tagged.message : String(error),
    typeof tagged.reason?._tag === "string" ? tagged.reason._tag : undefined
  )
}

const editable = new Set(["textbox", "searchbox", "combobox", "spinbutton", "editable"])

/** Fields keep their labels; their descendants and text-derived editable names are field content. */
const privateName = (role: string, fromText: boolean, inside: boolean) => inside || (role === "editable" && fromText)

// Consume quoted names and text too, so only tokens outside JSON strings are masked.
const snapshotToken = /\[validationMessage=("(?:[^"\\]|\\.)*")\]|"(?:[^"\\]|\\.)*"/g

/** Redacted snapshots mask every validation message and editable fields' own text; full capture keeps both. */
export const masked = (text: string): string => {
  const lines = text.replace(
    snapshotToken,
    (token, message: string | undefined) => message === undefined ? token : "[validationMessage=\"•••\"]"
  ).split("\n")
  let inside: number | undefined = undefined
  return lines.map((line) => {
    const indent = line.length - line.trimStart().length
    if (inside !== undefined && indent <= inside) inside = undefined
    // Consume the complete JSON name before inspecting metadata, so a label cannot forge its origin.
    const node = /^(\s*- ([a-z]+):?)(?: ("(?:[^"\\]|\\.)*"))?(.*)$/.exec(line)
    if (node === null) return line
    const [, prefix, role, name, metadata] = node
    const hidden = privateName(role!, metadata!.includes("[name from: text]"), inside !== undefined)
    if (inside === undefined && editable.has(role!) && line.endsWith(":")) inside = indent
    return hidden && name !== undefined ? `${prefix} "•••"${metadata}` : line
  }).join("\n")
}

const isRef = Schema.is(Tools.Ref)

/** A locator string's query, or a ref's locator from the page's latest snapshot. */
const parseTarget = (
  page: Page.Page,
  name: string,
  target: string,
  latest: (name: string) => Option.Option<Snapshot.Snapshot<Locator.Locator>>,
  owner: (ref: string) => Option.Option<string>
): Effect.Effect<Locator.Locator, Tools.ToolFailure> =>
  Effect.suspend(() => {
    const invalid = (hint: string) => Effect.fail(failed("InvalidInput", `${JSON.stringify(target)}: ${hint}`))
    if (isRef(target)) {
      const snapshot = latest(name)
      if (Option.isNone(snapshot) || !snapshot.value.refs.has(target)) {
        const elsewhere = owner(target)
        return invalid(
          Option.isSome(elsewhere) && elsewhere.value !== name
            ? `the ref is from ${elsewhere.value}'s snapshot; take a snapshot of ${name} for its refs`
            : Option.isNone(snapshot)
            ? `${name} has no snapshot yet; call snapshot first`
            : `${name}'s latest snapshot has no ${target}`
        )
      }
      return Effect.succeed(snapshot.value.ref(target))
    }
    const quoted = (value: string) => /^"(.*)"$/.exec(value)?.[1]
    const [kind, ...rest] = target.split("=")
    const value = rest.join("=")
    switch (kind) {
      case "role": {
        const match = /^([a-z]+)(?:\[name="(.*)"\])?$/.exec(value)
        if (match === null) return invalid(`expected role=button or role=button[name="Save"]`)
        return Effect.succeed(
          match[2] === undefined
            ? page.getByRole(match[1]!)
            : page.getByRole(match[1]!, { name: match[2], exact: true })
        )
      }
      case "text": {
        const exact = quoted(value)
        return Effect.succeed(exact === undefined ? page.getByText(value) : page.getByText(exact, { exact: true }))
      }
      case "label": {
        const exact = quoted(value)
        return Effect.succeed(exact === undefined ? page.getByLabel(value) : page.getByLabel(exact, { exact: true }))
      }
      case "testid":
        return Effect.succeed(page.getByTestId(quoted(value) ?? value))
      case "css":
        return value === "" ? invalid("a CSS selector after css=") : Effect.succeed(page.locator(value))
      default:
        return invalid(`expected a ref like e12, or role=…, text=…, label=…, testid=… or css=…`)
    }
  })

/** The pages, snapshots and digest a toolkit keeps, which the CLI's session commands share. */
export interface Session {
  readonly toolkit: Toolkit.WithHandler<Tools.Tools>
  /** Names a page: `given`, which must be free, or the next `p1`, `p2`…; a named page keeps its name. */
  readonly name: (page: Page.Page, given?: string) => Effect.Effect<string, Tools.ToolFailure>
  /**
   * Opens a page in the context, named `name`, which must be free, or the next `p1`, `p2`…, and navigates it to
   * `url` when one is given, with its secrets put in. The name is checked before the page opens; a page whose
   * navigation fails is closed and its name freed, so a failed open leaves nothing behind.
   */
  readonly open: (
    options: { readonly name?: string | undefined; readonly url?: string | undefined }
  ) => Effect.Effect<{ readonly page: Page.Page; readonly name: string }, Tools.ToolFailure>
  /** Renames a page. */
  readonly rename: (from: string, to: string) => Effect.Effect<void, Tools.ToolFailure>
  /** The page with a name; fails, naming the others, when there is none. */
  readonly page: (name: string) => Effect.Effect<Page.Page, Tools.ToolFailure>
  /** The context's pages, each named. */
  readonly pages: Effect.Effect<ReadonlyArray<{ readonly name: string; readonly page: Page.Page }>>
  /** The page with a name, as the toolkit knows it now, without listing the context's pages again. */
  readonly named: (name: string) => Option.Option<Page.Page>
  /** A page's latest snapshot, which its refs are checked against. */
  readonly latest: (name: string) => Option.Option<Snapshot.Snapshot<Locator.Locator>>
  /** Ends a route or dialog handler that `route` or `dialog` declared, by its registration (`r1`). */
  readonly remove: (registration: string) => Effect.Effect<void, Tools.ToolFailure>
  /** Text with each secret's `%name%` replaced by its value, as the tools put secrets in. */
  readonly reveal: (text: string) => string
  /** A value with each secret's value replaced by its `%name%` again, as every result has it. */
  readonly conceal: <A>(value: A) => A
}

/** Binds the tools to a context for the scope. */
export const make = (options: Options) => Effect.map(makeSession(options), (session) => session.toolkit)

/** Binds the tools to a context for the scope, with the session they keep. */
export const makeSession = Effect.fnUntraced(function*(options: Options) {
  const scope = yield* Effect.scope
  const context = options.context
  const { runtime, entry } = Handles.target(context).behind as {
    readonly runtime: Handles.Behind<Model.ContextEntry>["runtime"]
    readonly entry: Model.ContextEntry
  }
  const capture = options.capture
  const secrets = Object.entries(options.secrets).map(([name, value]) => ({ name, value: Redacted.value(value) }))

  // ── Secrets ──
  // Only a secret's own name is a placeholder: any other `%…%`, such as a URL's `%C3%`, is sent as written (Q250)
  const values = new Map(secrets.map((secret) => [secret.name, secret.value]))
  const reveal = (text: string): string =>
    Secrets.split(text, values.keys()).map((part, index) => index % 2 === 1 ? values.get(part)! : part).join("")
  const conceal = <A>(value: A): A => {
    if (typeof value === "string") {
      let out: string = value
      for (const secret of secrets) if (secret.value !== "") out = out.split(secret.value).join(`%${secret.name}%`)
      return out as A
    }
    if (Array.isArray(value)) return value.map(conceal) as A
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, conceal(each)])) as A
    }
    return value
  }

  // ── Pages, named ──
  const byName = new Map<string, Page.Page>()
  const nameById = new Map<Target.NavigableId, string>()
  // The names given to pages, as against the handles `p1`, `p2`… generated for them
  const kept = new Set<string>()
  let counter = 0
  const snapshots = new Map<string, Snapshot.Snapshot<Locator.Locator>>()
  const digest: Array<string> = []
  // Each named page's digest lines are recorded in a scope of its own, which forgetting the page closes
  const watching = new Map<Target.NavigableId, Scope.Closeable>()
  // Key grants by identity so renaming or reusing a name cannot release another page.
  const controlled = new Map<Target.NavigableId, Scope.Closeable>()
  const closed = (page: Page.Page) => Handles.page(page).entry.state.getUnsafe().status._tag === "Closed"

  const nameOf = (page: Page.Page, given?: string): Effect.Effect<string> =>
    Effect.suspend(() => {
      const known = nameById.get(page.id)
      if (known !== undefined) return Effect.succeed(known)
      let name = given
      while (name === undefined || byName.has(name)) name = `p${++counter}`
      byName.set(name, page)
      if (name === given) kept.add(name)
      nameById.set(page.id, name)
      return Effect.flatMap(Scope.fork(scope), (watcher) => {
        watching.set(page.id, watcher)
        return Effect.as(watchPage(page, name, watcher), name)
      })
    })
  /** Atomically retires bookkeeping, then finishes both resource closures even if its caller is interrupted. */
  const forget = (page: Page.Page): Effect.Effect<void> =>
    Effect.suspend(() => {
      const name = nameById.get(page.id)
      if (name !== undefined) {
        const status = Handles.page(page).entry.state.getUnsafe().status
        if (status._tag === "Closed") digest.push(`${name} closed: ${status.reason._tag}`)
        byName.delete(name)
        kept.delete(name)
        snapshots.delete(name)
      }
      nameById.delete(page.id)
      const watcher = watching.get(page.id)
      const grant = controlled.get(page.id)
      watching.delete(page.id)
      controlled.delete(page.id)
      return (watcher === undefined ? Effect.void : Scope.close(watcher, Exit.void)).pipe(
        Effect.ensuring(grant === undefined ? Effect.void : Scope.close(grant, Exit.void))
      )
    }).pipe(Operation.detached, Effect.uninterruptible)
  const pruneClosed = Effect.suspend(() =>
    Effect.forEach([...byName.values()].filter(closed), forget, { discard: true })
  )
  const nameOfEntry = (id: Target.NavigableId): string => nameById.get(id) ?? id

  /** The session's pages, each named, the new ones `p1`, `p2`…: its context's, then those named outside it. */
  const refresh = Effect.gen(function*() {
    yield* pruneClosed
    if (options.discoverContextPages === false) return [...byName.values()]
    const pages = yield* context.pages
    for (const [index, page] of pages.entries()) {
      if (nameById.has(page.id)) continue
      const name = yield* nameOf(page)
      options.seen?.({ _tag: "Listed", page, name, index })
    }
    // A tab taken with control, and a popup of one, stays in the context it was already in
    const inContext = new Set(pages.map((page) => page.id))
    return [...pages, ...[...byName.values()].filter((page) => !inContext.has(page.id))]
  })

  const pageNamed = (name: string): Effect.Effect<Page.Page, Tools.ToolFailure> =>
    Effect.flatMap(Effect.orDie(refresh), () => {
      const page = byName.get(name)
      return page === undefined
        ? Effect.fail(
          failed("PageNotFound", `No page named ${name}; the pages are ${[...byName.keys()].join(", ") || "none"}`)
        )
        : Effect.succeed(page)
    })

  /** `session.page`: finds a page by a name it was given, never by a generated handle. */
  const keptNamed = (name: string): Effect.Effect<Page.Page, Tools.ToolFailure> =>
    Effect.flatMap(pageNamed(name), (page) =>
      kept.has(name) ? Effect.succeed(page) : Effect.fail(
        failed(
          "PageNotFound",
          `${name} is a generated handle, not a name; give the page a name with keep, then find it by that name. The named pages are ${
            [...kept].join(", ") || "none"
          }`
        )
      ))

  // ── The digest ──
  const note = (line: string) => void digest.push(line)
  const drainEffect = Effect.fnUntraced(
    function*<A>(channel: Events.Channel<A>, each: (value: A) => Effect.Effect<void>, within: Scope.Scope = scope) {
      const queue = yield* Events.recorded(channel, () => true).pipe(Scope.provide(within))
      yield* Effect.gen(function*() {
        while (true) yield* each((yield* Queue.take(queue)).value)
      }).pipe(Effect.ignore, Effect.forkIn(within))
    }
  )
  const drain = <A>(channel: Events.Channel<A>, each: (value: A) => void, within: Scope.Scope = scope) =>
    drainEffect(channel, (value) => Effect.sync(() => each(value)), within)
  const consoleLine = (message: ConsoleMessage.ConsoleMessage, where: string) =>
    capture.consoleText === "full"
      ? `console ${message.level} on ${where}: ${message.text}`
      : `console ${message.level} on ${where} (text not sent)`
  const originName = (origin: Target.EventOrigin) => origin._tag === "Page" ? nameOfEntry(origin.page) : "a worker"

  /** A page's name as it is now, which `page name` may have changed since `named` was given. */
  const nameNow = (page: Page.Page, named: string) => nameById.get(page.id) ?? named

  // Each line names the page by its name as the line is noted, so a page renamed since it was first seen is
  // called by its new name
  const watchPage = (page: Page.Page, first: string, within: Scope.Scope): Effect.Effect<void> =>
    Effect.gen(function*() {
      const pageEntry = Handles.page(page).entry
      if (options.discoverContextPages === false) yield* watchDigest(pageEntry.events, within)
      const name = () => nameNow(page, first)
      yield* drain(pageEntry.events.navigation, (navigation) => {
        if (
          navigation.frame === pageEntry.id &&
          (navigation.outcome._tag === "Committed" || navigation.outcome._tag === "SameDocument")
        ) {
          note(`${name()} navigated to ${navigation.url}`)
        }
      }, within)
      yield* drainEffect(pageEntry.events.popup, (popup) =>
        Option.match(runtime.page(popup.page), {
          onNone: () => Effect.void,
          onSome: (opened) =>
            Effect.flatMap(nameOf(opened), (popupName) =>
              Effect.sync(() => {
                options.seen?.({
                  _tag: "Popup",
                  page: opened,
                  name: popupName,
                  opener: page,
                  openerName: name()
                })
                note(`popup ${popupName} opened from ${name()}${
                  Option.match(popup.url.getUnsafe(), {
                    onNone: () => "",
                    onSome: (url) => ` at ${url}`
                  })
                }`)
              }))
        }), within)
      yield* drain(
        pageEntry.events.dialog,
        (prompt) => note(`dialog ${prompt.kind}${prompt.message === "" ? "" : ` "${prompt.message}"`} on ${name()}`),
        within
      )
      yield* Effect.forkIn(
        // Cleanup must be a sibling: closing this watcher from its own fiber would interrupt cleanup itself.
        Effect.flatMap(page.closed, () => Effect.forkIn(forget(page), scope).pipe(Effect.uninterruptible)),
        within
      )
    })

  const watchDigest = Effect.fnUntraced(function*(events: Model.ContextEvents, within: Scope.Scope) {
    yield* drain(events.autoResolution, (resolution) => {
      switch (resolution._tag) {
        case "Dialog":
          note(
            `dialog ${resolution.prompt.kind} on ${
              nameOfEntry(resolution.prompt.page)
            } ${resolution.decision}ed by policy`
          )
          return
        case "FileChooser":
          note(`file chooser on ${nameOfEntry(resolution.chooser.navigable)} canceled by policy`)
          return
        default:
          return
      }
    }, within)
    yield* drain(events.response, ({ response, hop }) => {
      if (response.status >= 400) note(`${hop.request.method} ${response.url} answered ${response.status}`)
    }, within)
    // A request that failed: no response, for a reason other than its cancellation (CLI.md, the digest)
    yield* drainEffect(events.request, (request) =>
      Option.match(runtime.model.hop(request.hop), {
        onNone: () => Effect.void,
        onSome: (hop) =>
          Deferred.await(hop.end).pipe(
            Effect.flatMap((end) =>
              Effect.sync(() => {
                if (end._tag === "Failed" && !end.canceled) {
                  note(`${request.method} ${request.url} failed: ${end.error}`)
                }
              })
            ),
            Effect.forkIn(within),
            Effect.asVoid
          )
      }), within)
    yield* drain(events.console, (message) => {
      if (message.level === "error" && capture.consoleText !== "omitted") {
        note(consoleLine(message, originName(message.origin)))
      }
    }, within)
    yield* drain(
      events.exception,
      (exception) => note(`uncaught ${exception.name}: ${exception.message} on ${originName(exception.origin)}`),
      within
    )
    yield* drain(
      events.download,
      (download) =>
        note(`download "${download.suggestedFilename}" on ${nameOfEntry(download.page.id)} from ${download.url}`),
      within
    )
  })
  if (options.discoverContextPages !== false) yield* watchDigest(entry.events, scope)
  yield* refresh.pipe(Effect.orDie)

  // ── Results ──
  const run = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
    effect.pipe(
      Effect.mapError(toFailure),
      Effect.map((outcome) => conceal({ outcome, sinceLast: digest.splice(0) })),
      // A failure stays a ToolFailure, so its Schema encodes it
      Effect.mapError((failure) => new Tools.ToolFailure(conceal({ ...failure })))
    )
  const onPage = <A, R>(name: string, f: (page: Page.Page) => Effect.Effect<A, unknown, R>) =>
    run(Effect.flatMap(pageNamed(name), f))
  // An action brings its page to the front first: the tools name pages, and a page behind another may not render
  // (Firefox's background tabs, QUIRKS.md Q71), with no tool to bring it forward. A backend that can't bring one
  // forward, as attached stock WebKit can't, acts on it where it is
  const acting = <A, R>(name: string, f: (page: Page.Page) => Effect.Effect<A, unknown, R>) =>
    onPage(name, (page) =>
      Effect.andThen(
        page.activate.pipe(Effect.catchReason("PageError", "Unsupported", () => Effect.void)),
        f(page)
      ))
  const targeted = (page: Page.Page, name: string, target: string) =>
    parseTarget(page, name, target, (each) => Option.fromNullishOr(snapshots.get(each)), (ref) => {
      for (const [each, snapshot] of snapshots) if (snapshot.refs.has(ref as Snapshot.RefId)) return Option.some(each)
      return Option.none()
    })

  const waits = new Map<string, Effect.Effect<string, unknown>>()
  const registrations = new Map<string, Declaration.Registration>()
  let waitCount = 0
  let registrationCount = 0
  const register = (registration: Declaration.Registration) =>
    Effect.sync(() => {
      const id = `r${++registrationCount}`
      registrations.set(id, registration)
      return { registration: id }
    })
  const within = (input: string | undefined): Effect.Effect<Option.Option<Duration.Duration>, Tools.ToolFailure> =>
    Effect.suspend(() => {
      if (input === undefined) return Effect.succeedNone
      try {
        return Effect.succeedSome(Duration.fromInputUnsafe(input as Duration.Input))
      } catch {
        return Effect.fail(failed("InvalidInput", `${JSON.stringify(input)} isn't a duration, such as "30 seconds"`))
      }
    })

  // ── The browser's other pages, taken with control ──
  // Each controlled page's grant lives in a scope of its own, which release closes
  const browserPages = Effect.suspend(() =>
    options.browser === undefined
      ? Effect.fail(
        failed(
          "NotPermitted",
          "This toolkit was made for its context alone; BrowserToolkit.make with the browser lists and controls its tabs"
        )
      )
      : Effect.map(options.browser.pages, (pages) => pages.filter((page) => !nameById.has(page.id)))
  )

  const taken = (name: string) => failed("InvalidInput", `A page is already named ${name}`)
  const open: Session["open"] = Effect.fnUntraced(
    function*({ name, url }) {
      yield* pruneClosed
      // Checked first, so a name that's taken opens nothing
      if (name !== undefined && byName.has(name)) return yield* Effect.fail(taken(name))
      const page = yield* context.newPage.pipe(Scope.provide(scope), Effect.mapError(toFailure))
      const opened = yield* Opened
      opened(page.id)
      // Taken while the page opened: closed again, as a failed navigation's page is
      const closeAgain = Effect.andThen(forget(page), Effect.ignore(page.close()))
      if (name !== undefined && byName.has(name)) {
        yield* closeAgain
        return yield* Effect.fail(taken(name))
      }
      const named = yield* nameOf(page, name)
      // A page whose navigation fails isn't the session's: the command failed, and the exported test leaves it
      // out, so the page goes with it
      if (url !== undefined) {
        yield* page.goto(reveal(url)).pipe(Effect.mapError(toFailure), Effect.onError(() => closeAgain))
      }
      return { page, name: named }
    },
    Effect.mapError((failure) => new Tools.ToolFailure(conceal({ ...failure })))
  )

  const handlers = Tools.toolkit.of({
    tabs: () =>
      run(
        Effect.flatMap(browserPages, (pages) =>
          Effect.forEach(pages, (page) =>
            Effect.map(page.url, (url) => ({ tab: String(page.id), url: String(url) }))))
      ),
    control: ({ name, tab, url }) =>
      run(Effect.gen(function*() {
        yield* pruneClosed
        if ((tab === undefined) === (url === undefined)) {
          return yield* Effect.fail(failed("InvalidInput", "Name the tab one way: by its id from tabs, or by a URL"))
        }
        if (name !== undefined && byName.has(name)) {
          return yield* Effect.fail(failed("InvalidInput", `A page is already named ${name}`))
        }
        const pages = yield* browserPages
        const listed = yield* Effect.forEach(pages, (page) => Effect.map(page.url, (at) => ({ page, at: String(at) })))
        const matches = url === undefined ? undefined : UrlPattern.compile(url)
        const found = listed.filter((each) => tab !== undefined ? String(each.page.id) === tab : matches!(each.at))
        if (found.length !== 1) {
          return yield* Effect.fail(
            failed(
              "InvalidInput",
              `${found.length === 0 ? "No tab" : `${found.length} tabs`} matched ${tab ?? url}; the tabs are ${
                listed.map((each) => `${each.page.id} ${each.at}`).join(", ") || "none"
              }`
            )
          )
        }
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function*() {
            const grant = yield* Scope.fork(scope)
            const page = yield* restore(found[0]!.page.control).pipe(
              Scope.provide(grant),
              Effect.onError(() => Scope.close(grant, Exit.void))
            )
            controlled.set(page.id, grant)
            return yield* Effect.gen(function*() {
              const named = yield* nameOf(page, name)
              return { page: named, url: String(yield* restore(page.url)) }
            }).pipe(Effect.onError(() => forget(page)))
          })
        )
      })),
    release: ({ page: name }) =>
      run(Effect.gen(function*() {
        const page = byName.get(name)
        if (page === undefined || !controlled.has(page.id)) {
          return yield* Effect.fail(
            failed(
              "InvalidInput",
              `${name} wasn't taken with control; a page the session opened is the session's, and closes with it`
            )
          )
        }
        yield* forget(page)
        return `released ${name}; the tab stays open`
      })),
    pages: () =>
      run(Effect.gen(function*() {
        const pages = yield* refresh
        return yield* Effect.forEach(pages, (page) =>
          Effect.map(page.url, (url) => ({ page: nameById.get(page.id)!, url: String(url) })))
      })),
    newPage: ({ name, url }) =>
      run(Effect.gen(function*() {
        const opened = yield* open({ name, url })
        return { page: opened.name, url: String(yield* opened.page.url) }
      })),
    goto: ({ page: name, url }) =>
      onPage(name, (page) =>
        Effect.gen(function*() {
          const navigation = yield* page.goto(reveal(url))
          return navigation._tag === "Committed" && Option.isSome(navigation.response)
            ? { url: navigation.url, status: navigation.response.value.status }
            : { url: navigation.url }
        })),
    back: ({ page: name }) =>
      onPage(
        name,
        (page) =>
          Effect.map(
            page.back(),
            Option.match({ onNone: () => ({}), onSome: (navigation) => ({ url: navigation.url }) })
          )
      ),
    snapshot: ({ page: name }) =>
      onPage(name, (page) =>
        Effect.map(page.snapshot(), (snapshot) => {
          if (byName.get(name) === page && !closed(page)) snapshots.set(name, snapshot)
          return capture.snapshotText === "full" ? snapshot.text : masked(snapshot.text)
        })),
    find: ({ page: name, query, role, exact }) =>
      onPage(name, (page) =>
        Effect.gen(function*() {
          let snapshot = snapshots.get(name)
          if (snapshot === undefined) {
            snapshot = yield* page.snapshot()
            if (byName.get(name) === page && !closed(page)) snapshots.set(name, snapshot)
          }
          const wanted = exact === true ? query : query.toLowerCase()
          const matches = (text: string) => exact === true ? text === wanted : text.toLowerCase().includes(wanted)
          const found: Array<{ ref: string; role: string; name: string; path: string }> = []
          const seen = new Set<string>()
          // A match without a ref of its own, such as text, is reported as the nearest element with one
          const visit = (
            node: Snapshot.Node,
            path: ReadonlyArray<string>,
            owner: { readonly node: Snapshot.Node; readonly name: string } | undefined,
            inside: boolean
          ) => {
            const nodeName = node.name._tag === "None" ? "" : node.name.value
            const nodeRole = String(node.role.role)
            const hidden = capture.snapshotText !== "full" &&
              privateName(nodeRole, node.name._tag === "Inferred" && node.name.from === "text", inside)
            const shown = hidden && node.name._tag !== "None" ? "•••" : nodeName
            const holder = Option.isSome(node.ref) ? { node, name: shown } : owner
            if (
              holder !== undefined && Option.isSome(holder.node.ref) &&
              (matches(nodeName) ||
                (node.role._tag === "Inferred" && node.role.evidence.includes("password") && matches("password")))
            ) {
              const holderRole = String(holder.node.role.role)
              const ref = holder.node.ref.value
              if ((role === undefined || holderRole === role) && !seen.has(ref)) {
                seen.add(ref)
                found.push({
                  ref,
                  role: holderRole,
                  name: holder.name,
                  path: path.join(" > ")
                })
              }
            }
            const label = shown === "" ? nodeRole : `${nodeRole} "${shown}"`
            const next = Option.isSome(node.ref) && nodeRole !== "text" ? [...path, label] : path
            for (const child of node.children) visit(child, next, holder, inside || editable.has(nodeRole))
          }
          // Matching retains the original names; only displayed names and paths follow capture policy.
          visit(snapshot.root, [], undefined, false)
          return found
        })),
    screenshot: ({ page: name }) =>
      acting(name, (page) =>
        capture.screenshots === "denied"
          ? Effect.fail(failed("NotPermitted", "The capture policy sends no screenshots"))
          : Effect.map(page.screenshot(), (png) => ({ mediaType: "image/png" as const, data: Encoding.encode(png) }))),
    click: ({ page: name, target }) =>
      acting(
        name,
        (page) =>
          Effect.as(Effect.flatMap(targeted(page, name, target), (locator) => locator.click()), `clicked ${target}`)
      ),
    fill: ({ page: name, target, value }) =>
      acting(name, (page) =>
        Effect.gen(function*() {
          const locator = yield* targeted(page, name, target)
          const revealed = reveal(value)
          yield* revealed === value ? locator.fill(value) : locator.fill(Redacted.make(revealed))
          return `filled ${target}`
        })),
    press: ({ page: name, key, target }) =>
      acting(name, (page) =>
        target === undefined
          ? Effect.as(page.keyboard.press(key), `pressed ${key}`)
          : Effect.as(
            Effect.flatMap(targeted(page, name, target), (locator) => locator.press(key)),
            `pressed ${key} on ${target}`
          )),
    select: ({ page: name, target, values }) =>
      acting(name, (page) =>
        Effect.as(
          Effect.flatMap(
            targeted(page, name, target),
            (locator) => locator.selectOption(values.map((label) => ({ label })))
          ),
          `selected ${values.join(", ")} in ${target}`
        )),
    scroll: ({ page: name, target }) =>
      acting(
        name,
        (page) =>
          Effect.as(
            Effect.flatMap(targeted(page, name, target), (locator) => locator.scrollIntoView()),
            `scrolled ${target} into view`
          )
      ),
    next: ({ page: name, event, url, within: duration }) =>
      onPage(name, (page) =>
        Effect.gen(function*() {
          const deadline = yield* within(duration)
          const subscribe: Effect.Effect<Effect.Effect<string, unknown>, unknown, Scope.Scope> = (() => {
            switch (event) {
              case "navigation":
                return Effect.map(
                  PageNavigation.next(page),
                  (wait) => Effect.map(wait, (navigation) => `${nameNow(page, name)} navigated to ${navigation.url}`)
                )
              case "popup":
                return Effect.map(Popup.next(page), (wait) =>
                  Effect.flatMap(
                    wait,
                    (popup) =>
                      Effect.flatMap(nameOf(popup), (popupName) =>
                        Effect.map(popup.url, (at) => `popup ${popupName}, at ${at} so far`))
                  ))
              case "dialog":
                return Effect.map(
                  Dialog.next(page),
                  (wait) =>
                    Effect.map(wait, (dialog) =>
                      `dialog ${dialog._tag}${"message" in dialog ? ` "${dialog.message}"` : ""} on ${
                        nameNow(page, name)
                      }`)
                )
              case "download":
                return Effect.map(
                  Download.next(page),
                  (wait) =>
                    Effect.map(wait, (download) =>
                      `download "${download.suggestedFilename}" from ${download.url}`)
                )
              case "response":
                return url === undefined
                  ? Effect.fail(failed("InvalidInput", "A response wait needs a URL pattern"))
                  : Effect.map(
                    NetworkResponse.next(page, { url }),
                    (wait) => Effect.map(wait, (response) => `${response.status} ${response.url}`)
                  )
              case "console":
                return Effect.map(
                  ConsoleMessage.next(page),
                  (wait) => Effect.map(wait, (message) => consoleLine(message, nameNow(page, name)))
                )
            }
          })()
          const wait = yield* subscribe.pipe(
            Option.isSome(deadline) ? Deadline.within(deadline.value) : (effect) => effect,
            Scope.provide(scope)
          )
          const id = `w${++waitCount}`
          waits.set(id, wait)
          return { wait: id }
        })),
    await: ({ wait }) =>
      run(Effect.suspend(() => {
        const pending = waits.get(wait)
        return pending === undefined
          ? Effect.fail(failed("InvalidInput", `No wait named ${wait}; next starts one`))
          : pending
      })),
    expect: ({ page: name, target, state, text }) =>
      acting(name, (page) =>
        Effect.gen(function*() {
          const locator = yield* targeted(page, name, target)
          switch (state) {
            case "visible":
              yield* Expect.toBeVisible(locator)
              break
            case "hidden":
              yield* Expect.toBeHidden(locator)
              break
            case "enabled":
              yield* Expect.toBeEnabled(locator)
              break
            case "disabled":
              yield* Expect.toBeDisabled(locator)
              break
            case "checked":
              yield* Expect.toBeChecked(locator)
              break
          }
          if (text !== undefined) yield* Expect.toContainText(locator, reveal(text))
          return `${target} is ${state}${text === undefined ? "" : ` and contains ${JSON.stringify(text)}`}`
        })),
    history: ({ page: name, kind, level, failed }) =>
      onPage(name, (page): Effect.Effect<ReadonlyArray<string>, unknown> => {
        switch (kind) {
          case "navigation":
            return Effect.map(
              PageNavigation.history(page),
              (history) => history.entries.map((navigation) => `${navigation._tag} ${navigation.url}`)
            )
          case "console":
            return Effect.map(
              ConsoleMessage.history(page, level === undefined ? undefined : { level }),
              (history) =>
                capture.consoleText === "omitted"
                  ? history.entries.map((message) => `console ${message.level} (text not sent)`)
                  : history.entries.map((message) => consoleLine(message, name))
            )
          case "network":
            return failed !== true
              ? Effect.map(
                NetworkResponse.history(page),
                (history) => history.entries.map((response) => `${response.status} ${response.url}`)
              )
              // A failed request, as the digest says it (CLI.md): no response for a reason other than its
              // cancellation, or a status of 400 or more
              : Effect.gen(function*() {
                const requests = yield* NetworkRequest.history(page)
                const responses = yield* NetworkResponse.history(page)
                const lines: Array<{ readonly at: number; readonly line: string }> = []
                for (const response of responses.entries) {
                  if (response.status >= 400) {
                    lines.push({ at: response.at, line: `${response.status} ${response.url}` })
                  }
                }
                for (const request of requests.entries) {
                  const hop = Option.getOrUndefined(runtime.model.hop(request.hop))
                  const end = hop === undefined ? undefined : yield* Deferred.poll(hop.end)
                  const ended = end === undefined || Option.isNone(end) ? undefined : yield* end.value
                  if (ended?._tag === "Failed" && !ended.canceled) {
                    lines.push({ at: request.at, line: `failed ${request.method} ${request.url}: ${ended.error}` })
                  }
                }
                return lines.sort((a, b) => a.at - b.at).map((each) => each.line)
              })
          case "dialog":
            return Effect.map(
              Dialog.history(page),
              (history) =>
                history.entries.map((dialog) => `${dialog._tag}${"message" in dialog ? ` "${dialog.message}"` : ""}`)
            )
          case "download":
            return Effect.map(
              Download.history(page),
              (history) => history.entries.map((download) => `"${download.suggestedFilename}" from ${download.url}`)
            )
          case "exception":
            return Effect.map(
              UncaughtException.history(page),
              (history) => history.entries.map((exception) => `${exception.name}: ${exception.message}`)
            )
        }
      }),
    route: ({ page: name, pattern, action, status, body, contentType }) =>
      onPage(name, (page) => {
        const decision = action === "abort"
          ? Route.abort()
          : action === "continue"
          ? Route.continue
          : Route.fulfill(HttpServerResponse.text(body ?? "", {
            status: status ?? 200,
            ...(contentType === undefined ? {} : { contentType })
          }))
        return Effect.flatMap(
          page.route(pattern, () => decision).pipe(Scope.provide(scope)),
          register
        )
      }),
    dialog: ({ page: name, decision, text }) =>
      onPage(name, (page) =>
        Effect.flatMap(
          Dialog.handle(page, (pending) =>
            decision === "accept"
              ? (pending._tag === "Prompt" || pending._tag === "Unknown") && text !== undefined
                ? pending.respond(text)
                : pending._tag === "BeforeUnload"
                ? pending.leave
                : pending.accept
              : pending._tag === "Alert"
              ? pending.accept
              : pending._tag === "BeforeUnload"
              ? pending.stay
              : pending.dismiss).pipe(Scope.provide(scope)),
          register
        ))
  })
  const handlerContext = yield* Tools.toolkit.toHandlers(handlers)
  const session: Session = {
    toolkit: yield* Effect.provideContext(Tools.toolkit, handlerContext),
    name: (page, given) =>
      Effect.andThen(
        pruneClosed,
        Effect.suspend(() => {
          const known = nameById.get(page.id)
          // A page named already, such as one listed as p3 before a segment kept it, takes the name it's given
          if (known !== undefined) {
            if (given === known) kept.add(known)
            return given === undefined || given === known
              ? Effect.succeed(known)
              : Effect.as(session.rename(known, given), given)
          }
          if (given !== undefined && byName.has(given)) {
            return Effect.fail(failed("InvalidInput", `A page is already named ${given}`))
          }
          return nameOf(page, given)
        })
      ),
    open,
    rename: (from, to) =>
      Effect.flatMap(pageNamed(from), (page) =>
        Effect.suspend(() => {
          if (byName.has(to)) return Effect.fail(failed("InvalidInput", `A page is already named ${to}`))
          if (!/^[A-Za-z][\w-]*$/.test(to)) {
            return Effect.fail(failed("InvalidInput", `${JSON.stringify(to)}: a name starts with a letter`))
          }
          byName.delete(from)
          kept.delete(from)
          byName.set(to, page)
          kept.add(to)
          nameById.set(page.id, to)
          const snapshot = snapshots.get(from)
          if (snapshot !== undefined) {
            snapshots.delete(from)
            snapshots.set(to, snapshot)
          }
          return Effect.void
        })),
    page: keptNamed,
    pages: Effect.map(Effect.orDie(refresh), (pages) => pages.map((page) => ({ name: nameById.get(page.id)!, page }))),
    named: (name) => Option.fromNullishOr(byName.get(name)).pipe(Option.filter((page) => !closed(page))),
    latest: (name) =>
      byName.has(name) && !closed(byName.get(name)!)
        ? Option.fromNullishOr(snapshots.get(name))
        : Option.none(),
    remove: (id) =>
      Effect.suspend(() => {
        const registration = registrations.get(id)
        if (registration === undefined) {
          return Effect.fail(
            failed(
              "InvalidInput",
              `No registration ${id}; the registrations are ${[...registrations.keys()].join(", ") || "none"}`
            )
          )
        }
        registrations.delete(id)
        return registration.remove
      }),
    reveal,
    conceal
  }
  return session
})
