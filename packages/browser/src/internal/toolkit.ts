/**
 * The agent toolkit's handlers (review 20, candidate 5): the tools of `tools.ts`, bound to one context.
 *
 * - **Pages by name.** A page is named when it is created (`newPage`'s `name`, or `p1`, `p2`…) or first seen,
 *   as a popup is. Every page tool names its page; there is no current one.
 * - **Targets** are a ref, checked against the page's latest snapshot, or a locator string that maps to one
 *   query; a bad one fails at once.
 * - **The digest.** The context's and each page's event channels are recorded from the start, and each result
 *   takes what they recorded since the previous call: navigations, popups, dialogs and who decided them,
 *   downloads, uncaught exceptions, console errors and failed requests. No tool waits after it acts.
 * - **Secrets.** A `%name%` in a parameter is the secret's value at dispatch, and every result and digest line
 *   has the values put back as `%name%`.
 * - **Capture.** The policy decides whether screenshots are sent, whether an editable field's text is masked in
 *   snapshots, and how much console text the digest carries.
 */
import type * as Toolkit from "effect/ai/Toolkit"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import type * as CapturePolicy from "../ai/CapturePolicy.ts"
import * as ConsoleMessage from "../ConsoleMessage.ts"
import * as Deadline from "../Deadline.ts"
import type * as Declaration from "../Declaration.ts"
import * as Dialog from "../Dialog.ts"
import * as Download from "../Download.ts"
import * as Expect from "../Expect.ts"
import type * as Locator from "../Locator.ts"
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
import * as Tools from "./tools.ts"

/** What a toolkit is bound to. */
export interface Options {
  readonly context: UserContext.UserContext
  readonly secrets: Readonly<Record<string, Redacted.Redacted<string>>>
  readonly capture: CapturePolicy.CapturePolicy
}

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

const editable = new Set(["textbox", "searchbox", "combobox", "spinbutton"])

/** Snapshot text with an editable field's own text masked: its lines under an editable role's line. */
export const masked = (text: string): string => {
  const lines = text.split("\n")
  let inside: number | undefined = undefined
  return lines.map((line) => {
    const indent = line.length - line.trimStart().length
    if (inside !== undefined && indent <= inside) inside = undefined
    if (inside !== undefined && line.trimStart().startsWith("- text:")) return `${" ".repeat(indent)}- text: "•••"`
    const role = /^\s*- ([a-z]+)/.exec(line)?.[1]
    if (role !== undefined && editable.has(role) && line.endsWith(":")) inside = indent
    return line
  }).join("\n")
}

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
    if (/^e\d+$/.test(target)) {
      const snapshot = latest(name)
      if (Option.isNone(snapshot) || !snapshot.value.refs.has(target as Snapshot.RefId)) {
        const elsewhere = owner(target)
        return invalid(
          Option.isSome(elsewhere) && elsewhere.value !== name
            ? `the ref is from ${elsewhere.value}'s snapshot; take a snapshot of ${name} for its refs`
            : Option.isNone(snapshot)
            ? `${name} has no snapshot yet; call snapshot first`
            : `${name}'s latest snapshot has no ${target}`
        )
      }
      return Effect.succeed(snapshot.value.ref(target as Snapshot.RefId))
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

/** The pages, snapshots and digest a toolkit keeps, which the CLI's session commands share (review 20). */
export interface Session {
  readonly toolkit: Toolkit.WithHandler<Tools.Tools>
  /** Names a page: `given`, which must be free, or the next `p1`, `p2`…; a named page keeps its name. */
  readonly name: (page: Page.Page, given?: string) => Effect.Effect<string, Tools.ToolFailure>
  /** Renames a page. */
  readonly rename: (from: string, to: string) => Effect.Effect<void, Tools.ToolFailure>
  /** The page with a name; fails, naming the others, when there is none. */
  readonly page: (name: string) => Effect.Effect<Page.Page, Tools.ToolFailure>
  /** The context's pages, each named. */
  readonly pages: Effect.Effect<ReadonlyArray<{ readonly name: string; readonly page: Page.Page }>>
  /** A page's latest snapshot, which its refs are checked against. */
  readonly latest: (name: string) => Option.Option<Snapshot.Snapshot<Locator.Locator>>
  /** Ends a route or dialog handler that `route` or `dialog` declared, by its registration (`r1`). */
  readonly remove: (registration: string) => Effect.Effect<void, Tools.ToolFailure>
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
  const reveal = (text: string): Effect.Effect<string, Tools.ToolFailure> =>
    Effect.suspend(() => {
      let missing: string | undefined
      const out = text.replace(/%([A-Za-z_][\w-]*)%/g, (whole, name: string) => {
        const secret = secrets.find((each) => each.name === name)
        if (secret === undefined) {
          missing = name
          return whole
        }
        return secret.value
      })
      return missing === undefined
        ? Effect.succeed(out)
        : Effect.fail(failed("InvalidInput", `No secret named ${missing}; the secrets are ${names(secrets)}`))
    })
  const names = (list: ReadonlyArray<{ readonly name: string }>) =>
    list.length === 0 ? "none" : list.map((each) => `%${each.name}%`).join(", ")
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
  let counter = 0
  const snapshots = new Map<string, Snapshot.Snapshot<Locator.Locator>>()
  const digest: Array<string> = []

  const nameOf = (page: Page.Page, given?: string): Effect.Effect<string> =>
    Effect.suspend(() => {
      const known = nameById.get(page.id)
      if (known !== undefined) return Effect.succeed(known)
      let name = given
      while (name === undefined || byName.has(name)) name = `p${++counter}`
      byName.set(name, page)
      nameById.set(page.id, name)
      return Effect.as(watchPage(page, name), name)
    })
  const nameOfEntry = (id: Target.NavigableId): string => nameById.get(id) ?? id

  /** The context's pages, each named, the new ones `p1`, `p2`… */
  const refresh = Effect.gen(function*() {
    const pages = yield* context.pages
    for (const page of pages) yield* nameOf(page)
    return pages
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

  // ── The digest ──
  const note = (line: string) => void digest.push(line)
  const drainEffect = Effect.fnUntraced(
    function*<A>(channel: Events.Channel<A>, each: (value: A) => Effect.Effect<void>) {
      const queue = yield* Events.recorded(channel, () => true).pipe(Scope.provide(scope))
      yield* Effect.gen(function*() {
        while (true) yield* each((yield* Queue.take(queue)).value)
      }).pipe(Effect.ignore, Effect.forkIn(scope))
    }
  )
  const drain = <A>(channel: Events.Channel<A>, each: (value: A) => void) =>
    drainEffect(channel, (value) => Effect.sync(() => each(value)))
  const consoleLine = (message: ConsoleMessage.ConsoleMessage, where: string) =>
    capture.consoleText === "full"
      ? `console ${message.level} on ${where}: ${message.text}`
      : `console ${message.level} on ${where} (text not sent)`
  const originName = (origin: Target.EventOrigin) => origin._tag === "Page" ? nameOfEntry(origin.page) : "a worker"

  const watchPage = (page: Page.Page, name: string): Effect.Effect<void> =>
    Effect.gen(function*() {
      const pageEntry = Handles.page(page).entry
      yield* drain(pageEntry.events.navigation, (navigation) => {
        if (navigation.outcome._tag === "Committed" || navigation.outcome._tag === "SameDocument") {
          note(`${name} navigated to ${navigation.url}`)
        }
      })
      yield* drainEffect(pageEntry.events.popup, (popup) =>
        Option.match(runtime.page(popup.page), {
          onNone: () => Effect.void,
          onSome: (opened) =>
            Effect.flatMap(nameOf(opened), (popupName) =>
              Effect.sync(() =>
                note(`popup ${popupName} opened from ${name}${
                  Option.match(popup.url, {
                    onNone: () => "",
                    onSome: (url) => ` at ${url}`
                  })
                }`)
              ))
        }))
      yield* drain(pageEntry.events.dialog, (prompt) =>
        note(`dialog ${prompt.kind}${prompt.message === "" ? "" : ` "${prompt.message}"`} on ${name}`))
      yield* Effect.forkIn(
        Effect.flatMap(page.closed, (reason) =>
          Effect.sync(() =>
            note(`${name} closed: ${reason._tag}`)
          )),
        scope
      )
    })

  yield* drain(entry.events.autoResolution, (resolution) => {
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
  })
  yield* drain(entry.events.response, ({ response, hop }) => {
    if (response.status >= 400) note(`${hop.request.method} ${response.url} answered ${response.status}`)
  })
  // A request that failed: no response, for a reason other than its cancellation (CLI.md, the digest)
  yield* drainEffect(entry.events.request, (request) =>
    Option.match(runtime.model.hop(request.hop), {
      onNone: () => Effect.void,
      onSome: (hop) =>
        Deferred.await(hop.end).pipe(
          Effect.flatMap((end) =>
            Effect.sync(() => {
              if (end._tag === "Failed" && !end.canceled) note(`${request.method} ${request.url} failed: ${end.error}`)
            })
          ),
          Effect.forkIn(scope),
          Effect.asVoid
        )
    }))
  yield* drain(entry.events.console, (message) => {
    if (message.level === "error" && capture.consoleText !== "omitted") {
      note(consoleLine(message, originName(message.origin)))
    }
  })
  yield* drain(
    entry.events.exception,
    (exception) => note(`uncaught ${exception.name}: ${exception.message} on ${originName(exception.origin)}`)
  )
  yield* drain(
    entry.events.download,
    (download) =>
      note(`download "${download.suggestedFilename}" on ${nameOfEntry(download.page.id)} from ${download.url}`)
  )
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
  // (Firefox's background tabs, QUIRKS.md Q71), with no tool to bring it forward
  const acting = <A, R>(name: string, f: (page: Page.Page) => Effect.Effect<A, unknown, R>) =>
    onPage(name, (page) => Effect.andThen(page.activate, f(page)))
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

  const handlers = Tools.toolkit.of({
    pages: () =>
      run(Effect.gen(function*() {
        const pages = yield* refresh
        return yield* Effect.forEach(pages, (page) =>
          Effect.map(page.url, (url) => ({ page: nameById.get(page.id)!, url: String(url) })))
      })),
    newPage: ({ name, url }) =>
      run(Effect.gen(function*() {
        if (name !== undefined && byName.has(name)) {
          return yield* Effect.fail(failed("InvalidInput", `A page is already named ${name}`))
        }
        const page = yield* context.newPage.pipe(Scope.provide(scope))
        const named = yield* nameOf(page, name)
        if (url !== undefined) yield* page.goto(yield* reveal(url))
        return { page: named, url: String(yield* page.url) }
      })),
    goto: ({ page: name, url }) =>
      onPage(name, (page) =>
        Effect.gen(function*() {
          const navigation = yield* page.goto(yield* reveal(url))
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
          snapshots.set(name, snapshot)
          return capture.snapshotText === "full" ? snapshot.text : masked(snapshot.text)
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
          const revealed = yield* reveal(value)
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
                  (wait) => Effect.map(wait, (navigation) => `${name} navigated to ${navigation.url}`)
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
                      `dialog ${dialog._tag}${"message" in dialog ? ` "${dialog.message}"` : ""} on ${name}`)
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
                    (wait) =>
                      Effect.map(wait, (response) =>
                        `${response.status} ${response.url}`)
                  )
              case "console":
                return Effect.map(
                  ConsoleMessage.next(page),
                  (wait) => Effect.map(wait, (message) => consoleLine(message, name))
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
          if (text !== undefined) yield* Expect.toContainText(locator, yield* reveal(text))
          return `${target} is ${state}${text === undefined ? "" : ` and contains ${JSON.stringify(text)}`}`
        })),
    history: ({ page: name, kind }) =>
      onPage(name, (page): Effect.Effect<ReadonlyArray<string>, unknown> => {
        switch (kind) {
          case "navigation":
            return Effect.map(
              PageNavigation.history(page),
              (history) => history.entries.map((navigation) => `${navigation._tag} ${navigation.url}`)
            )
          case "console":
            return Effect.map(
              ConsoleMessage.history(page),
              (history) =>
                capture.consoleText === "omitted"
                  ? history.entries.map((message) => `console ${message.level} (text not sent)`)
                  : history.entries.map((message) => consoleLine(message, name))
            )
          case "network":
            return Effect.map(
              NetworkResponse.history(page),
              (history) => history.entries.map((response) => `${response.status} ${response.url}`)
            )
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
          page.route(pattern, () => Effect.succeed(decision)).pipe(Scope.provide(scope)),
          register
        )
      }),
    dialog: ({ page: name, decision, text }) =>
      onPage(name, (page) =>
        Effect.flatMap(
          Dialog.handle(page, (pending) =>
            Effect.succeed(
              decision === "accept"
                ? pending._tag === "Prompt" && text !== undefined
                  ? pending.respond(text)
                  : pending._tag === "BeforeUnload"
                  ? pending.leave
                  : pending.accept
                : pending._tag === "Alert"
                ? pending.accept
                : pending._tag === "BeforeUnload"
                ? pending.stay
                : pending.dismiss
            )).pipe(Scope.provide(scope)),
          register
        ))
  })
  const handlerContext = yield* Tools.toolkit.toHandlers(handlers)
  const session: Session = {
    toolkit: yield* Effect.provideContext(Tools.toolkit, handlerContext),
    name: (page, given) =>
      Effect.suspend(() => {
        const known = nameById.get(page.id)
        if (known !== undefined) return Effect.succeed(known)
        if (given !== undefined && byName.has(given)) {
          return Effect.fail(failed("InvalidInput", `A page is already named ${given}`))
        }
        return nameOf(page, given)
      }),
    rename: (from, to) =>
      Effect.flatMap(pageNamed(from), (page) =>
        Effect.suspend(() => {
          if (byName.has(to)) return Effect.fail(failed("InvalidInput", `A page is already named ${to}`))
          if (!/^[A-Za-z][\w-]*$/.test(to)) {
            return Effect.fail(failed("InvalidInput", `${JSON.stringify(to)}: a name starts with a letter`))
          }
          byName.delete(from)
          byName.set(to, page)
          nameById.set(page.id, to)
          const snapshot = snapshots.get(from)
          if (snapshot !== undefined) {
            snapshots.delete(from)
            snapshots.set(to, snapshot)
          }
          return Effect.void
        })),
    page: pageNamed,
    pages: Effect.map(Effect.orDie(refresh), (pages) => pages.map((page) => ({ name: nameById.get(page.id)!, page }))),
    latest: (name) => Option.fromNullishOr(snapshots.get(name)),
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
      })
  }
  return session
})
