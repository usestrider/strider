/**
 * A session's daemon (CLI.md). `strider start` starts one per session, in the session's
 * directory: it holds the browser, the session's one context and the toolkit's pages, snapshots, waits and
 * registrations, and serves the session's commands over its Unix socket, one connection each.
 *
 * - **Commands** are parsed here, with `effect/cli`, into the toolkit's tools and the session commands. Their
 *   output, and `effect/cli`'s help and errors, go back over the socket; the exit code is the command's.
 * - **Lifetime.** It ends at `strider stop`, after its idle timeout, or when `--owner-pid` exits, and deletes
 *   the session's directory unless told to keep it. A profile in `--user-data-dir` is never deleted.
 * - **Segments.** `strider run file.ts` imports the default segment, decodes its arguments and runs its callback
 *   with `CurrentSession` and a scope of its own; returned values are printed and pages named into the session.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as Cause from "effect/Cause"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Predicate from "effect/Predicate"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as CapturePolicy from "../../ai/CapturePolicy.ts"
import * as Bidi from "../../bidi/Bidi.ts"
import * as Browser from "../../Browser.ts"
import * as Chromium from "../../chromium/Chromium.ts"
import * as CurrentSession from "../../cli/CurrentSession.ts"
import * as Segment from "../../cli/Segment.ts"
import * as Firefox from "../../firefox/Firefox.ts"
import * as Ledger from "../../Ledger.ts"
import * as Operation from "../../Operation.ts"
import * as Page from "../../Page.ts"
import type * as SocketConnector from "../../protocol/SocketConnector.ts"
import * as StorageState from "../../StorageState.ts"
import type * as UserContext from "../../UserContext.ts"
import * as WebKit from "../../webkit/WebKit.ts"
import * as Handles from "../handles.ts"
import * as OperationImpl from "../operation.ts"
import * as Serialization from "../serialization.ts"
import * as ToolkitImpl from "../toolkit.ts"
import * as Tools from "../tools.ts"
import * as Attach from "./attach.ts"
import * as Client from "./client.ts"
import * as ExportTest from "./exportTest.ts"
import * as Node from "./node.ts"
import * as Protocol from "./protocol.ts"
import * as Recorder from "./recorder.ts"
import * as SegmentResult from "./segmentResult.ts"
import * as Session from "./session.ts"

type Viewport = { readonly width: number; readonly height: number }

const parseViewport = (text: string) => {
  const match = /^([0-9]+)x([0-9]+)$/.exec(text)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  return match !== null && Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
    ? Effect.succeed({ width, height })
    : Effect.fail(
      new CommandFailed({
        error: "InvalidInput",
        message: "A viewport is WIDTHxHEIGHT in positive integer CSS pixels, such as 1440x1000"
      })
    )
}

/** Replaces a CLI override only after its successor has been accepted by the backend. */
export const setViewport = (
  owner: { readonly scope: Scope.Scope; readonly viewports: Map<string, Scope.Closeable> },
  page: { readonly id: string; readonly emulate: Page.Page["emulate"] },
  viewport: Viewport
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const scope = yield* Scope.fork(owner.scope)
      yield* page.emulate({ viewport }).pipe(
        Scope.provide(scope),
        restore,
        Effect.onError(() => Scope.close(scope, Exit.void))
      )
      const previous = owner.viewports.get(page.id)
      owner.viewports.set(page.id, scope)
      if (previous !== undefined) yield* Scope.close(previous, Exit.void)
    })
  )

// ── The session ──

/** How a command shows a tool's outcome: its text, and the files it wrote. */
type Present<K extends Tools.ToolName> = (
  outcome: Tools.Outcome<K>
) => Effect.Effect<{ readonly text: string; readonly files?: ReadonlyArray<string> }, never, FileSystem.FileSystem>

interface Daemon {
  readonly name: string
  readonly strictCapture: boolean
  readonly paths: ReturnType<typeof Session.paths>
  readonly browser: ExportTest.Browser
  readonly secretVariables: Readonly<Record<string, string>>
  /** The state file the session started from, which the exported test reads too. */
  readonly state: string | undefined
  /** The session whose state this one started from, which the exported test can't read. */
  readonly fork: string | undefined
  /** The profile directory the session's browser runs on, when it isn't the session's own. */
  readonly userDataDir: string | undefined
  readonly viewport: Viewport | undefined
  readonly viewports: Map<string, Scope.Closeable>
  readonly context: UserContext.UserContext
  readonly session: ToolkitImpl.Session
  readonly scope: Scope.Scope
  /** The steps `export test` writes, and how the session came to know the pages no command opened. */
  readonly recorder: Recorder.Recorder
  /** Stops the session, keeping its directory or not, once the answer to `request` is written. */
  readonly stop: (keep: boolean, request: Request) => void
  readonly lastActivity: () => number
  readonly idleTimeout: string
  readonly owner: number | undefined
  shots: number
}

/**
 * A tool's final result, as the toolkit's `handle` gives it, its success decoded by the tool's Schema, or its
 * failure; the toolkit's tools give no preliminary results.
 */
const callTool = Effect.fnUntraced(function*<K extends Tools.ToolName>(daemon: Daemon, call: Tools.Call<K>) {
  const schemas = Tools.schemas[call.tool]
  const params = yield* Schema.encodeEffect(schemas.parametersSchema)(call.params).pipe(
    Effect.mapError(ToolkitImpl.toFailure)
  )
  const results = yield* daemon.session.toolkit.handle(call.tool, params).pipe(Effect.mapError(ToolkitImpl.toFailure))
  const last = yield* Stream.runLast(results).pipe(Effect.mapError(ToolkitImpl.toFailure))
  if (Option.isNone(last)) {
    return yield* Effect.fail(new Tools.ToolFailure({ error: "NoResult", message: `${call.tool} gave no result` }))
  }
  if (last.value.isFailure) return yield* Effect.fail(ToolkitImpl.toFailure(last.value.result))
  return yield* Schema.decodeUnknownEffect(schemas.successSchema)(last.value.encodedResult).pipe(Effect.orDie)
})

/** The page a tool call names, if its tool takes one. */
const pageOf = (call: Tools.Call): string | undefined => "page" in call.params ? call.params.page : undefined

/** A tool call's target as a query on its page, for the exported test: a ref is the locator its snapshot names. */
const targetOf = (daemon: Daemon, call: Tools.Call) => {
  const page = pageOf(call)
  return "target" in call.params && call.params.target !== undefined && page !== undefined
    ? ExportTest.queryOf(call.params.target, Option.getOrUndefined(daemon.session.latest(page)))
    : undefined
}

/** The tools that act on a page, and so may open a popup as they run. */
const actions: ReadonlySet<Tools.ToolName> = new Set([
  "newPage",
  "goto",
  "back",
  "click",
  "fill",
  "press",
  "select",
  "scroll"
])

/** The page a command names, by id, as the session knows it now, or as its pages list it. */
const named = (daemon: Daemon, page: string | undefined): Effect.Effect<ReadonlyArray<string>> =>
  page === undefined ? Effect.succeed([]) : Option.match(daemon.session.named(page), {
    onSome: (found) => Effect.succeed([found.id]),
    onNone: () =>
      Effect.map(
        daemon.session.pages,
        (pages) => pages.filter((each) => each.name === page).map((each) => each.page.id)
      )
  })

/**
 * Runs a tool call or command that may open pages, as the recorder's: an action acts on the page it names and on a
 * page it opens, from the moment the toolkit opens it, and the popups of those are its own; a segment's pages are
 * its placeholder's.
 */
const recording = <A, E, R>(
  daemon: Daemon,
  kind: Recorder.Running["kind"] | undefined,
  effect: (running: Recorder.Running | undefined) => Effect.Effect<A, E, R>,
  page?: string | undefined
) =>
  kind === undefined ? effect(undefined) : Effect.acquireUseRelease(
    Effect.map(named(daemon, page), (pages) => daemon.recorder.begin(kind, pages)),
    (running) =>
      effect(running).pipe(Effect.provideService(ToolkitImpl.Opened, (opened) => void running.pages.add(opened))),
    (running) => Effect.sync(() => daemon.recorder.end(running))
  )

/** Records a successful tool call for `export test`, with the pages it declares and the popup waits it starts. */
const record = (
  daemon: Daemon,
  call: Tools.Call,
  outcome: unknown,
  target: string | undefined,
  running: Recorder.Running | undefined
) => {
  const result = typeof outcome === "string" ? outcome : handleOf(outcome)
  daemon.recorder.record({ _tag: "Tool", ...call, target, result }, running)
  const id = (page: string | undefined) =>
    page === undefined ? undefined : Option.getOrUndefined(daemon.session.named(page))?.id
  // A page newPage opened or control took, and a popup await collected, is declared by its step
  const declared = call.tool === "newPage" || call.tool === "control"
    ? id(result)
    : call.tool === "await" && result !== undefined
    ? id(/^popup (\S+),/.exec(result)?.[1])
    : undefined
  if (declared !== undefined) daemon.recorder.declared(declared)
  // A popup wait gives the next popup its page opens
  const opener = id(pageOf(call))
  if (call.tool === "next" && call.params.event === "popup" && result !== undefined && opener !== undefined) {
    daemon.recorder.waiting(result, opener)
  }
}

/** The handle a tool call printed: a wait's, a route's or dialog handler's registration, or a page's name. */
const handleOf = (outcome: unknown): string | undefined => {
  for (const key of ["wait", "registration", "page"]) {
    if (Predicate.hasProperty(outcome, key) && typeof outcome[key] === "string") return outcome[key]
  }
  return undefined
}

/** Why a command failed: the error's tag, its reason's, and its message. */
class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly error: string
  readonly reason?: string | undefined
  readonly message: string
  readonly output?: string | undefined
}> {
  /** The exit code of its module's error, or 1. */
  get code(): number {
    return Session.exitCodes[this.error] ?? 1
  }
}

const elapsedSince = (started: number) => `${Math.round(performance.now() - started)} ms`

/** The session's flags, accepted before and after the command. */
export const selectors = {
  session: Flag.String("session").pipe(Flag.withAlias("s"), Flag.withDescription("The session"), Flag.optional),
  page: Flag.String("page").pipe(Flag.withAlias("p"), Flag.withDescription("The page, by name"), Flag.optional)
}
export const output = {
  json: Flag.Boolean("json").pipe(Flag.withDescription("Print the result as JSON"), Flag.withDefault(false))
}
const root = Command.make("strider").pipe(Command.withSharedFlags({ ...selectors, ...output }))

/** The commands of a session, bound to it. */
export const commands = (getDaemon: () => Daemon) => {
  const pageFlag = Effect.flatMap(root, (config) =>
    Option.match(config.page, {
      onNone: () =>
        Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: "Every page command names its page with -p; strider pages lists them"
          })
        ),
      onSome: Effect.succeed
    }))

  const plain = (outcome: unknown) =>
    Effect.succeed({ text: typeof outcome === "string" ? outcome : JSON.stringify(outcome) })
  /** Runs a tool and prints its result, as text or JSON; a failed one fails the command. */
  const tool = <K extends Tools.ToolName>(
    name: K,
    params: Tools.Params<K>,
    present: Present<K> = plain
  ) => {
    const call = Tools.call(name, params)
    return recording(
      getDaemon(),
      actions.has(name) ? "action" : undefined,
      (running) => toolIn(call, present, running),
      pageOf(call)
    )
  }
  const toolIn = Effect.fnUntraced(function*<K extends Tools.ToolName>(
    call: Tools.Call<K>,
    present: Present<K>,
    running: Recorder.Running | undefined
  ) {
    const config = yield* root
    const started = performance.now()
    const page = pageOf(call)
    // Read before the call: a ref is the locator its snapshot named, which the call may replace
    const target = targetOf(getDaemon(), call)
    const result = yield* Effect.result(callTool(getDaemon(), call))
    if (Result.isFailure(result)) {
      const failure = result.failure
      if (config.json) {
        yield* Console.log(
          JSON.stringify({ page, outcome: { _tag: "Failed", ...failure }, elapsed: elapsedSince(started) })
        )
      }
      return yield* Effect.fail(new CommandFailed(failure))
    }
    const value = result.success
    const shown = yield* present(value.outcome)
    record(getDaemon(), call, value.outcome, target, running)
    if (config.json) {
      yield* Console.log(JSON.stringify({
        page,
        outcome: { _tag: "Ok", value: value.outcome },
        elapsed: elapsedSince(started),
        sinceLast: value.sinceLast,
        files: shown.files ?? []
      }))
      return
    }
    // A one-line outcome carries where and how long; a longer one has them after it
    const where = `${page === undefined ? "" : `${page} · `}${elapsedSince(started)}`
    yield* Console.log(
      shown.text.includes("\n")
        ? `${shown.text}\n(${where})`
        : `${shown.text}${page === undefined ? "" : ` on ${page}`} · ${elapsedSince(started)}`
    )
    for (const file of shown.files ?? []) yield* Console.log(`  ${file}`)
    if (value.sinceLast.length > 0) yield* Console.log(`since last: ${value.sinceLast.join(" · ")}`)
  })

  const target = Argument.String("target").pipe(
    Argument.withDescription("A ref from the page's latest snapshot, or role=…, text=…, label=…, testid=…, css=…")
  )
  const onPage = <A extends object>(build: (page: string) => A) => Effect.map(pageFlag, build)

  const pages = Command.make(
    "pages",
    {},
    () =>
      tool("pages", {}, (outcome) =>
        Effect.succeed({
          text: outcome.map((each) => `${each.page}  ${each.url}`).join("\n") || "no pages"
        }))
  )
  const snapshot = Command.make(
    "snapshot",
    {},
    () => Effect.flatMap(pageFlag, (page) => tool("snapshot", { page }, (text) => Effect.succeed({ text })))
  )
  const find = Command.make(
    "find",
    {
      query: Argument.String("query").pipe(Argument.withDescription("Text a name contains, or equals with --exact")),
      role: Flag.String("role").pipe(Flag.withDescription("Only elements with this role"), Flag.optional),
      exact: Flag.Boolean("exact").pipe(Flag.withDefault(false))
    },
    ({ exact, query, role }) =>
      Effect.flatMap(
        onPage((page) => ({
          page,
          query,
          ...(Option.isSome(role) ? { role: role.value } : {}),
          ...(exact ? { exact } : {})
        })),
        (params) =>
          tool(
            "find",
            params,
            (found) =>
              Effect.succeed({
                text: found.length === 0
                  ? `nothing in the latest snapshot matches ${JSON.stringify(query)}`
                  : found.map((each) =>
                    `${each.ref}  ${each.role}${each.name === "" ? "" : ` "${each.name}"`}${
                      each.path === "" ? "" : `  (${each.path})`
                    }`
                  ).join("\n")
              })
          )
      )
  )
  const screenshot = Command.make(
    "screenshot",
    {},
    () =>
      Effect.flatMap(
        pageFlag,
        (page) =>
          tool("screenshot", { page }, (outcome) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const file = `${getDaemon().paths.artifacts}/${page}-${++getDaemon().shots}.png`
              const bytes = Encoding.decode(outcome.data)
              if (bytes._tag === "Success") yield* Effect.orDie(fs.writeFile(file, bytes.success))
              return { text: `screenshot of ${page}`, files: [file] }
            }))
      )
  )
  const goto = Command.make(
    "goto",
    { url: Argument.String("url") },
    ({ url }) =>
      Effect.flatMap(
        onPage((page) => ({ page, url })),
        (params) =>
          tool("goto", params, (outcome) =>
            Effect.succeed({ text: `at ${outcome.url}${outcome.status === undefined ? "" : ` (${outcome.status})`}` }))
      )
  )
  const back = Command.make(
    "back",
    {},
    () =>
      Effect.flatMap(pageFlag, (page) =>
        tool("back", { page }, (outcome) =>
          Effect.succeed({
            text: outcome.url === undefined ? "no history entry to go back to" : `back at ${outcome.url}`
          })))
  )
  const click = Command.make(
    "click",
    { target },
    ({ target }) => Effect.flatMap(onPage((page) => ({ page, target })), (params) => tool("click", params))
  )
  const fill = Command.make(
    "fill",
    { target, value: Argument.String("value") },
    ({ target, value }) => Effect.flatMap(onPage((page) => ({ page, target, value })), (params) => tool("fill", params))
  )
  const press = Command.make(
    "press",
    { key: Argument.String("key"), target: Flag.String("target").pipe(Flag.optional) },
    ({ key, target }) =>
      Effect.flatMap(
        onPage((page) => ({ page, key, ...(Option.isSome(target) ? { target: target.value } : {}) })),
        (params) => tool("press", params)
      )
  )
  const select = Command.make(
    "select",
    { target, values: Argument.String("label").pipe(Argument.variadic()) },
    ({ target, values }) =>
      Effect.flatMap(onPage((page) => ({ page, target, values })), (params) => tool("select", params))
  )
  const scroll = Command.make(
    "scroll",
    { target },
    ({ target }) => Effect.flatMap(onPage((page) => ({ page, target })), (params) => tool("scroll", params))
  )
  const next = Command.make(
    "next",
    {
      event: Argument.Literals("event", Tools.Event.literals),
      url: Flag.String("url").pipe(Flag.optional),
      within: Flag.String("within").pipe(Flag.optional)
    },
    ({ event, url, within }) =>
      Effect.flatMap(
        onPage((page) => ({
          page,
          event,
          ...(Option.isSome(url) ? { url: url.value } : {}),
          ...(Option.isSome(within) ? { within: within.value } : {})
        })),
        (params) =>
          tool("next", params, (outcome) =>
            Effect.succeed({
              text: `${outcome.wait}: waiting for the next ${event} from now${
                Option.isSome(within) ? `, for at most ${within.value}` : ""
              }`
            }))
      )
  )
  const awaitCommand = Command.make("await", { wait: Argument.String("wait") }, ({ wait }) => tool("await", { wait }))
  const expect = Command.make(
    "expect",
    {
      target,
      state: Argument.Literals("state", Tools.ExpectedState.literals),
      text: Flag.String("text").pipe(Flag.optional)
    },
    ({ target, state, text }) =>
      Effect.flatMap(
        onPage((page) => ({ page, target, state, ...(Option.isSome(text) ? { text: text.value } : {}) })),
        (params) => tool("expect", params)
      )
  )
  const history = Command.make(
    "history",
    {
      kind: Argument.Literals("kind", Tools.HistoryKind.literals),
      level: Flag.Literals("level", Tools.ConsoleLevel.literals).pipe(
        Flag.withDescription("Console messages at this level"),
        Flag.optional
      ),
      failed: Flag.Boolean("failed").pipe(
        Flag.withDescription("Network requests that failed, or were answered 400 or more"),
        Flag.withDefault(false)
      )
    },
    ({ failed, kind, level }) =>
      Effect.flatMap(
        onPage((page) => ({
          page,
          kind,
          ...(Option.isSome(level) ? { level: level.value } : {}),
          ...(failed ? { failed } : {})
        })),
        (params) =>
          tool("history", params, (entries) =>
            Effect.succeed({ text: entries.length === 0 ? `no ${kind} recorded` : entries.join("\n") }))
      )
  )
  const route = Command.make(
    "route",
    {
      pattern: Argument.String("pattern"),
      action: Argument.Literals("action", Tools.RouteAction.literals),
      status: Flag.Int("status").pipe(Flag.optional),
      body: Flag.String("body").pipe(Flag.optional),
      contentType: Flag.String("content-type").pipe(Flag.optional)
    },
    ({ pattern, action, status, body, contentType }) =>
      Effect.flatMap(
        onPage((page) => ({
          page,
          pattern,
          action,
          ...(Option.isSome(status) ? { status: status.value } : {}),
          ...(Option.isSome(body) ? { body: body.value } : {}),
          ...(Option.isSome(contentType) ? { contentType: contentType.value } : {})
        })),
        (params) =>
          tool("route", params, (outcome) =>
            Effect.succeed({
              text: `${outcome.registration}: ${action} ${pattern}; strider remove ${outcome.registration} ends it`
            }))
      )
  )
  const dialog = Command.make("dialog").pipe(
    Command.withSubcommands([
      Command.make(
        "handle",
        {
          decision: Argument.Literals("decision", Tools.DialogDecision.literals),
          text: Flag.String("text").pipe(Flag.optional)
        },
        ({ decision, text }) =>
          Effect.flatMap(
            onPage((page) => ({ page, decision, ...(Option.isSome(text) ? { text: text.value } : {}) })),
            (params) =>
              tool("dialog", params, (outcome) =>
                Effect.succeed({
                  text: `${outcome.registration}: dialogs ${decision}ed; strider remove ${outcome.registration} ends it`
                }))
          )
      ).pipe(Command.withDescription(Tools.dialog.description!))
    ])
  )
  const remove = Command.make(
    "remove",
    { registration: Argument.String("registration") },
    ({ registration }) =>
      Effect.gen(function*() {
        yield* getDaemon().session.remove(registration).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
        getDaemon().recorder.record({ _tag: "Remove", registration })
        yield* Console.log(`removed ${registration}`)
      })
  )

  // ── Session commands ──
  const page = Command.make("page").pipe(
    Command.withSubcommands([
      Command.make("viewport", { size: Argument.String("size") }, ({ size }) =>
        Effect.gen(function*() {
          const viewport = yield* parseViewport(size)
          const name = yield* pageFlag
          const daemon = getDaemon()
          const page = yield* daemon.session.page(name).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
          yield* setViewport(daemon, page, viewport).pipe(Effect.mapError(failedWith))
          daemon.recorder.record({ _tag: "Viewport", page: name, viewport })
          yield* Console.log(`${name} viewport ${viewport.width}x${viewport.height}`)
        })).pipe(Command.withDescription("Set the selected page's viewport in CSS pixels")),
      Command.make(
        "new",
        { name: Flag.String("name").pipe(Flag.optional), url: Argument.String("url").pipe(Argument.optional) },
        ({ name, url }) =>
          recording(getDaemon(), "action", (running) =>
            Effect.gen(function*() {
              // The name is checked before the page opens, and a page whose navigation fails is closed, so a
              // page new that failed leaves no page, as the exported test, which leaves it out, has none. A
              // secret's %name% in the URL is its value, as goto puts it in, and a failure names it again
              const { name: named, page: opened } = yield* getDaemon().session.open({
                name: Option.getOrUndefined(name),
                url: Option.getOrUndefined(url)
              }).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
              getDaemon().recorder.record({ _tag: "NewPage", page: named, url: Option.getOrUndefined(url) }, running)
              getDaemon().recorder.declared(opened.id)
              yield* Console.log(`${named}${Option.isSome(url) ? ` at ${url.value}` : ""}`)
            }))
      ).pipe(Command.withDescription(Tools.newPage.description!)),
      Command.make("name", { name: Argument.String("name") }, ({ name }) =>
        Effect.gen(function*() {
          const from = yield* pageFlag
          yield* getDaemon().session.rename(from, name).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
          getDaemon().recorder.record({ _tag: "Rename", from, to: name })
          yield* Console.log(`${from} is now ${name}`)
        })).pipe(Command.withDescription("Give an existing page a new name"))
    ])
  )
  // The browser's own tabs: an attached browser's, or a launched one's first
  const tabs = Command.make(
    "tabs",
    {},
    () =>
      tool("tabs", {}, (outcome) =>
        Effect.succeed({
          text: outcome.map((each) => `${each.tab}  ${each.url}`).join("\n") ||
            "no tabs beyond the session's pages"
        }))
  )
  const control = Command.make(
    "control",
    {
      tab: Argument.String("tab").pipe(Argument.withDescription("A tab's id, from strider tabs"), Argument.optional),
      url: Flag.String("url").pipe(Flag.withDescription("A URL pattern that matches exactly one tab"), Flag.optional),
      name: Flag.String("name").pipe(Flag.optional)
    },
    ({ name, tab, url }) =>
      Effect.gen(function*() {
        const params = {
          ...(Option.isSome(tab) ? { tab: tab.value } : {}),
          ...(Option.isSome(url) ? { url: url.value } : {}),
          ...(Option.isSome(name) ? { name: name.value } : {})
        }
        yield* tool("control", params, (outcome) =>
          Effect.succeed({
            text: `${outcome.page} at ${outcome.url}, controlled until strider release -p ${outcome.page}`
          }))
      })
  )
  const release = Command.make(
    "release",
    {},
    () => Effect.flatMap(pageFlag, (page) => tool("release", { page }))
  )
  const run = Command.make(
    "run",
    {
      file: Argument.String("file"),
      args: Flag.String("arg").pipe(
        Flag.withDescription("A segment argument: key=value, key=@file.json, or key=@@literal"),
        Flag.atLeast(0)
      )
    },
    ({ args, file }) =>
      Effect.gen(function*() {
        // Every page named first, so what's new after the segment is its own
        const before = new Map((yield* getDaemon().session.pages).map((each) => [each.page.id, each.name]))
        return yield* recording(getDaemon(), "segment", (running) =>
          Effect.gen(function*() {
            const { json } = yield* root
            const ran = yield* Effect.exit(segment(getDaemon(), file, args, json))
            const after = yield* getDaemon().session.pages
            // The pages it gave the session, which its placeholder declares, by the names they have now
            const pages = after.filter((each) =>
              !before.has(each.page.id) && !getDaemon().recorder.declares(each.page.id)
            )
            if (Exit.isSuccess(ran)) {
              getDaemon().recorder.record({ _tag: "Segment", file, pages: pages.map((each) => each.name) }, running)
              for (const each of pages) getDaemon().recorder.declared(each.page.id)
            }
            // A page it renamed, as keeping one under a new name does, is renamed in the test too
            for (const each of after) {
              const from = before.get(each.page.id)
              if (from !== undefined && from !== each.name) {
                getDaemon().recorder.record({ _tag: "Rename", from, to: each.name })
              }
            }
            return yield* ran
          }))
      })
  )
  const state = Command.make("state").pipe(
    Command.withSubcommands([
      Command.make("save", { path: Argument.String("path") }, ({ path }) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const text = yield* exportState(getDaemon()).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
          const resolved = yield* resolvePath(path)
          yield* fs.writeFileString(resolved, text, { mode: 0o600 }).pipe(Effect.mapError(failedWith))
          yield* Console.log(`saved the session's state to ${resolved}, readable by you alone`)
        })).pipe(Command.withDescription("Save storage state to a file"))
    ])
  )
  const exportCommand = Command.make("export").pipe(
    Command.withSubcommands([
      Command.make("test", { path: Argument.String("path") }, ({ path }) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const resolved = yield* resolvePath(path)
          const { placeholders, text } = ExportTest.render({
            name: getDaemon().name,
            browser: getDaemon().browser,
            viewport: getDaemon().viewport,
            secrets: getDaemon().secretVariables,
            state: getDaemon().state,
            fork: getDaemon().fork,
            userDataDir: getDaemon().userDataDir,
            steps: getDaemon().recorder.steps
          })
          yield* fs.writeFileString(resolved, text).pipe(Effect.mapError(failedWith))
          // The commands it repeats, not what the session saw of its pages
          const commands = getDaemon().recorder.steps.filter((step) => step._tag !== "Popup" && step._tag !== "Listed")
          yield* Console.log(`wrote ${commands.length} steps to ${resolved}`)
          for (const placeholder of placeholders) yield* Console.log(`  a placeholder for ${placeholder}`)
        })).pipe(Command.withDescription("Write the recorded session as a TypeScript test"))
    ])
  )
  const stop = Command.make(
    "stop",
    { keep: Flag.Boolean("keep").pipe(Flag.withDefault(false)) },
    ({ keep }) =>
      Effect.gen(function*() {
        getDaemon().stop(keep, yield* CurrentRequest)
        yield* Console.log(
          keep
            ? `stopping ${getDaemon().name}; its directory stays at ${getDaemon().paths.dir}`
            : `stopping ${getDaemon().name}`
        )
      })
  )

  return root.pipe(
    Command.withSubcommands([
      pages.pipe(Command.withDescription(Tools.pages.description!)),
      snapshot.pipe(Command.withDescription(Tools.snapshot.description!)),
      find.pipe(Command.withDescription(Tools.find.description!)),
      screenshot.pipe(Command.withDescription(Tools.screenshot.description!)),
      goto.pipe(Command.withDescription(Tools.goto.description!)),
      back.pipe(Command.withDescription(Tools.back.description!)),
      click.pipe(Command.withDescription(Tools.click.description!)),
      fill.pipe(Command.withDescription(Tools.fill.description!)),
      press.pipe(Command.withDescription(Tools.press.description!)),
      select.pipe(Command.withDescription(Tools.select.description!)),
      scroll.pipe(Command.withDescription(Tools.scroll.description!)),
      next.pipe(Command.withDescription(Tools.next.description!)),
      awaitCommand.pipe(Command.withDescription(Tools.await.description!)),
      expect.pipe(Command.withDescription(Tools.expect.description!)),
      history.pipe(Command.withDescription(Tools.history.description!)),
      route.pipe(Command.withDescription(Tools.route.description!)),
      dialog.pipe(Command.withDescription("Register how the page handles dialogs.")),
      remove.pipe(Command.withDescription("Remove a route or dialog handler by its registration.")),
      page.pipe(Command.withDescription("Open or name pages in the session.")),
      tabs.pipe(Command.withDescription(Tools.tabs.description!)),
      control.pipe(Command.withDescription(Tools.control.description!)),
      release.pipe(Command.withDescription(Tools.release.description!)),
      run.pipe(Command.withDescription("Run a TypeScript segment in the session.")),
      state.pipe(Command.withDescription("Save the session’s storage state.")),
      exportCommand.pipe(Command.withDescription("Export the recorded session as a test.")),
      stop.pipe(Command.withDescription("Stop the session; optionally keep its directory."))
    ])
  )
}

const failedWith = (error: unknown) => new CommandFailed(ToolkitImpl.toFailure(error))

/** The request's working directory, against which paths are resolved. */
class WorkingDirectory
  extends Context.Service<WorkingDirectory, string>()("@usestrider/browser/cli/WorkingDirectory")
{}

const resolvePath = Effect.fnUntraced(function*(path: string) {
  const paths = yield* Path.Path
  const cwd = yield* WorkingDirectory
  return paths.resolve(cwd, path)
})

const exportState = Effect.fnUntraced(function*(daemon: Daemon) {
  const state = yield* daemon.context.exportStorageState.pipe(Effect.mapError(ToolkitImpl.toFailure))
  // The codec for saving, which writes each Redacted value in full
  return yield* Schema.encodeEffect(StorageState.Json)(state).pipe(Effect.orDie)
})

/** `strider run`: the file's default export, with `CurrentSession` and a scope of its own. */
const segment = Effect.fnUntraced(function*(daemon: Daemon, file: string, args: ReadonlyArray<string>, json: boolean) {
  const started = performance.now()
  const resolved = yield* resolvePath(file)
  const status: { phase: typeof SegmentResult.Failure.Type["phase"] } = { phase: "load" }
  // Collect operation evidence without imposing a new deadline on the entire segment.
  const operation = yield* OperationImpl.start("strider run")
  const ran = yield* executeSegment(daemon, resolved, args, (next) => {
    status.phase = next
  }).pipe(
    Effect.provideService(Operation.Current, operation),
    Effect.flatMap((value) => {
      status.phase = "serialize"
      return Effect.map(SegmentResult.serialize(value, daemon.session, daemon.strictCapture), (result) => ({
        result,
        handle: Page.isPage(value)
      }))
    }),
    Effect.exit
  )
  const durationMs = Math.round(performance.now() - started)
  if (Exit.isFailure(ran)) {
    if (Cause.hasInterruptsOnly(ran.cause)) return yield* Effect.failCause(ran.cause)
    const error = Cause.squash(ran.cause)
    const failure = error instanceof CommandFailed ? error : error instanceof Serialization.Unserializable
      ? { error: "NotSerializable", message: `${error.path}: ${error.hint}` }
      : ToolkitImpl.toFailure(error ?? String(error))
    const detail = error as {
      readonly hint?: unknown
      readonly reason?: { readonly hint?: unknown }
      readonly operation?: unknown
    }
    const givenHint = detail?.hint ?? detail?.reason?.hint
    const hint = Option.isOption(givenHint) ? Option.getOrUndefined(givenHint) : givenHint
    const lastStep = operation.progress.at(-1)
    const step = typeof detail?.operation === "string" ?
      detail.operation :
      status.phase === "execute" && lastStep?.state !== "ok"
      ? lastStep?.step
      : undefined
    const result = daemon.session.conceal({
      file: resolved,
      error: failure.error,
      ...("reason" in failure && typeof failure.reason === "string" ? { reason: failure.reason } : {}),
      message: daemon.strictCapture ? "Segment failed; details masked by capture strict" : failure.message,
      ...(typeof hint === "string" ? { hint: daemon.strictCapture ? "•••" : hint } : {}),
      phase: status.phase,
      ...(step === undefined ? {} : { step }),
      durationMs
    })
    return yield* Effect.fail(
      new CommandFailed({
        ...result,
        output: json ?
          yield* Schema.encodeEffect(Schema.fromJsonString(SegmentResult.Failure))(result).pipe(Effect.orDie) :
          `${result.error}${result.reason === undefined ? "" : `{${result.reason}}`}: ${result.message}${
            result.hint === undefined || result.message.includes(result.hint) ? "" : `\n  hint: ${result.hint}`
          }\n  ${result.file}: ${result.phase}${step === undefined ? "" : ` at ${result.step}`}${
            result.phase === "execute" || result.phase === "serialize" ? "; earlier steps remain done" : ""
          }`
      })
    )
  }
  const result = { file: daemon.session.conceal(resolved), ...ran.value.result, durationMs }
  yield* Console.log(
    json
      ? yield* Schema.encodeEffect(Schema.fromJsonString(SegmentResult.Result))(result).pipe(Effect.orDie)
      : `ran ${result.file} → ${SegmentResult.preview(result.value, ran.value.handle)}`
  )
})

const segmentArguments = Effect.fnUntraced(function*(given: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const args = new Map<string, unknown>()
  for (const argument of given) {
    const equals = argument.indexOf("=")
    if (equals < 1) {
      return yield* Effect.fail(
        new CommandFailed({ error: "InvalidInput", message: "--arg expects key=value or key=@file.json" })
      )
    }
    const key = argument.slice(0, equals)
    if (args.has(key)) {
      return yield* Effect.fail(
        new CommandFailed({ error: "InvalidInput", message: `--arg ${key} was given more than once` })
      )
    }
    const value = argument.slice(equals + 1)
    if (value.startsWith("@@")) args.set(key, value.slice(1))
    else if (value.startsWith("@")) {
      const file = yield* resolvePath(value.slice(1))
      const text = yield* fs.readFileString(file).pipe(
        Effect.mapError((error) =>
          new CommandFailed({ error: "InvalidInput", message: `--arg ${key}: ${error.message}` })
        )
      )
      args.set(
        key,
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
          Effect.mapError((error) =>
            new CommandFailed({ error: "InvalidInput", message: `--arg ${key}: ${file}: ${error.message}` })
          )
        )
      )
    } else args.set(key, value)
  }
  return Object.fromEntries(args)
})

const executeSegment = Effect.fnUntraced(function*(
  daemon: Daemon,
  resolved: string,
  args: ReadonlyArray<string>,
  phase: (phase: "arguments" | "execute") => void
) {
  const paths = yield* Path.Path
  const url = yield* paths.toFileUrl(resolved).pipe(Effect.mapError(failedWith))
  // A query of its own, so an edited file is imported again
  const module = (yield* Effect.tryPromise({
    try: () => import(`${url.href}?run=${Date.now()}`),
    catch: (error) =>
      new CommandFailed({ error: "SegmentFailed", message: `${resolved} didn't load: ${String(error)}` })
  })) as { readonly default?: unknown }
  if (!Segment.isSegment(module.default)) {
    return yield* Effect.fail(
      new CommandFailed({
        error: "InvalidInput",
        message: `${resolved} must default-export Segment.make(schema, args => effect) from @usestrider/browser/cli`
      })
    )
  }
  const current: CurrentSession.CurrentSession = {
    context: daemon.context,
    page: (name) =>
      daemon.session.page(name).pipe(
        Effect.mapError((failure) => new CurrentSession.PageNotFound({ name, hint: failure.message }))
      ),
    // The page's ownership moves to the session's scope, which then closes it
    keep: Effect.fnUntraced(function*(page: Page.Page, name?: CurrentSession.PageName | string) {
      const named = yield* daemon.session.name(page, name).pipe(
        Effect.mapError((failure) => new CurrentSession.NameTaken({ name: name ?? "", hint: failure.message }))
      )
      yield* Handles.page(page).runtime.model.transfer(page.id, daemon.scope)
      return CurrentSession.PageName.make(named)
    })
  }
  const segment = module.default
  return yield* Effect.scoped(
    (Effect.gen(function*() {
      phase("arguments")
      const input = yield* segmentArguments(args)
      const decoded = yield* Schema.decodeUnknownEffect(segment.schema, { onExcessProperty: "error" })(input).pipe(
        Effect.mapError((error) => new CommandFailed({ error: "InvalidInput", message: error.message }))
      )
      phase("execute")
      return yield* segment.run(decoded)
    }) as Effect.Effect<
      unknown,
      unknown,
      CurrentSession.CurrentSession | Scope.Scope | FileSystem.FileSystem | Path.Path | WorkingDirectory
    >).pipe(
      Effect.provideService(CurrentSession.CurrentSession, current)
    )
  )
})

// ── Serving ──

/** The call a command runs in, so `stop` ends the session once that call's answer is written. */
class CurrentRequest extends Context.Service<CurrentRequest, Request>()("@usestrider/browser/cli/CurrentRequest") {}

interface Request {
  readonly client: number
  readonly id: string
}

/** A Console that sends what a command prints over its call. */
const capture = (send: (line: Protocol.Output) => void): Console.Console => {
  const text = (args: ReadonlyArray<unknown>) =>
    args.map((each) => typeof each === "string" ? each : String(each)).join(" ")
  const out = (...args: ReadonlyArray<unknown>) => send({ _tag: "Out", text: text(args) })
  const err = (...args: ReadonlyArray<unknown>) => send({ _tag: "Err", text: text(args) })
  const nothing = () => {}
  return {
    assert: nothing,
    clear: nothing,
    count: nothing,
    countReset: nothing,
    debug: err,
    dir: out,
    dirxml: out,
    error: err,
    group: nothing,
    groupCollapsed: nothing,
    groupEnd: nothing,
    info: out,
    log: out,
    table: out,
    time: nothing,
    timeEnd: nothing,
    timeLog: nothing,
    trace: err,
    warn: err
  }
}

/**
 * A command's exit code, from how it ended, and what to print about it: a failed command's tag and message, with
 * its module's code; effect/cli's own errors, which it printed, 2; an interruption 130; a defect 1.
 */
const exitOf = (exit: Exit.Exit<unknown, unknown>): { readonly code: number; readonly message?: string } => {
  if (Exit.isSuccess(exit)) return { code: 0 }
  const error = Cause.findErrorOption(exit.cause)
  if (Option.isSome(error)) {
    return error.value instanceof CommandFailed
      ? { code: error.value.code, message: error.value.output ?? `${error.value.error}: ${error.value.message}` }
      : { code: Session.exitCodes.CliError! }
  }
  return Cause.hasInterruptsOnly(exit.cause)
    ? { code: 130, message: "interrupted; the session goes on" }
    : { code: 1, message: `the command died: ${Cause.pretty(exit.cause)}` }
}

/**
 * A tool called as a model calls it, for strider mcp: its parameters, encoded, decoded by its Schema, and its result
 * encoded by its Schema, or its failure.
 */
const callAsModel = Effect.fnUntraced(function*<K extends Tools.ToolName>(
  daemon: Daemon,
  tool: K,
  encoded: unknown,
  touch: () => void
) {
  const params = yield* Schema.decodeUnknownEffect(Tools.schemas[tool].parametersSchema)(encoded).pipe(
    Effect.mapError((error) => new Tools.ToolFailure({ error: "InvalidInput", message: error.message }))
  )
  const call = Tools.call(tool, params)
  return yield* recording(daemon, actions.has(tool) ? "action" : undefined, (running) =>
    Effect.gen(function*() {
      touch()
      const target = targetOf(daemon, call)
      const success = yield* callTool(daemon, call)
      record(daemon, call, success.outcome, target, running)
      return yield* Schema.encodeEffect(Tools.schemas[tool].successSchema)(success).pipe(Effect.orDie)
    }).pipe(Effect.ensuring(Effect.sync(touch))), pageOf(call))
})

/** The session's calls: its commands, its tools as a model calls them, what it is, and its state. */
const handlers = (daemon: Daemon, tree: ReturnType<typeof commands>, version: string, touch: () => void) =>
  Protocol.Rpcs.of({
    Command: ({ argv, cwd }, { client, requestId }) =>
      Stream.callback<Protocol.Output, Protocol.CommandExit, Command.Environment>((queue) =>
        Effect.gen(function*() {
          touch()
          const send = (line: Protocol.Output) => void Queue.offerUnsafe(queue, line)
          const exit = yield* Command.runWith(tree, { version })(argv).pipe(
            Effect.provideService(Console.Console, capture(send)),
            Effect.provideService(WorkingDirectory, cwd),
            Effect.provideService(CurrentRequest, { client: client.id, id: String(requestId) }),
            Effect.exit
          )
          const { code, message } = exitOf(exit)
          if (message !== undefined) send({ _tag: "Err", text: message })
          if (code !== 0) return yield* new Protocol.CommandExit({ code })
          yield* Queue.end(queue)
        }).pipe(Effect.ensuring(Effect.sync(touch)))
      ),
    Tool: ({ params, tool }) => callAsModel(daemon, tool, params, touch),
    Info: () =>
      Effect.map(daemon.session.pages, (pages) => ({
        name: daemon.name,
        browser: daemon.browser._tag === "Launch" ? daemon.browser.backend : `attached ${daemon.browser.backend}`,
        pages: pages.map((each) => each.name),
        idle: Math.round((performance.now() - daemon.lastActivity()) / 1000),
        idleTimeout: daemon.idleTimeout,
        owner: daemon.owner ?? null,
        dir: daemon.paths.dir
      })),
    State: () => exportState(daemon)
  })

/**
 * The socket's RPC protocol, which tells `written` of each answer it has written, so `stop` ends the session once
 * its own answer is written.
 */
const protocolTelling = (written: (request: Request) => void) =>
  Layer.effect(RpcServer.Protocol)(Effect.map(RpcServer.makeProtocolSocketServer, (protocol) =>
    RpcServer.Protocol.of({
      ...protocol,
      send: (client, response, transferables) =>
        Effect.tap(protocol.send(client, response, transferables), () =>
          Effect.sync(() => {
            if (response._tag === "Exit") written({ client, id: String(response.requestId) })
          }))
    })))

// ── Starting ──

/** The browser a start names: exactly one. */
/**
 * A WebDriver BiDi endpoint as the session connects to it: Firefox's remote agent answers at `/session`, which an
 * endpoint with no path leaves out, so it's added, as `Firefox.layerConnect` adds it; any other is taken as given.
 */
const bidiEndpoint = (endpoint: string): string => {
  const url = URL.parse(endpoint)
  return url !== null && /^wss?:$/.test(url.protocol) && (url.pathname === "" || url.pathname === "/")
    ? new URL("/session", url).href
    : endpoint
}

const browserOf = (flags: {
  readonly chromium: Option.Option<string>
  readonly firefox: Option.Option<string>
  readonly webkit: Option.Option<string>
  readonly attach: Option.Option<string>
}): Effect.Effect<Pick<Prepared, "browser" | "connectionEndpoint">, CommandFailed> => {
  const given = [
    ...Option.toArray(
      Option.map(flags.chromium, (path) => ({ _tag: "Launch", backend: "chromium", executablePath: path }) as const)
    ),
    ...Option.toArray(
      Option.map(flags.firefox, (path) => ({ _tag: "Launch", backend: "firefox", executablePath: path }) as const)
    ),
    ...Option.toArray(
      Option.map(flags.webkit, (path) => ({ _tag: "Launch", backend: "webkit", executablePath: path }) as const)
    ),
    // HTTP is detected below; WebSocket classification preserves the existing BiDi handling.
    ...Option.toArray(Option.map(flags.attach, (endpoint) =>
      /^https?:|\/devtools\//.test(endpoint)
        ? { _tag: "Attach", backend: "chromium", endpoint } as const
        : { _tag: "Attach", backend: "bidi", endpoint: bidiEndpoint(endpoint) } as const))
  ]
  return given.length === 1
    ? given[0]!._tag === "Attach" && /^https?:/.test(given[0]!.endpoint)
      ? Attach.detect(given[0]!.endpoint).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.mapError((error) => new CommandFailed({ error: "InvalidInput", message: error.message }))
      )
      : Effect.succeed({ browser: given[0]!, connectionEndpoint: undefined })
    : Effect.fail(
      new CommandFailed({
        error: "InvalidInput",
        message:
          "A session names its browser: exactly one of --chromium, --firefox or --webkit with an absolute path, or --attach with an endpoint; strider browsers lists the paths"
      })
    )
}

const layerOf = (
  browser: ExportTest.Browser,
  userDataDir: string,
  connectionEndpoint: string | undefined
): Layer.Layer<
  Browser.Browser,
  Browser.BrowserError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Socket.WebSocketConstructor
  | SocketConnector.SocketConnector
> => {
  if (browser._tag === "Attach") {
    return browser.backend === "chromium"
      ? Chromium.layerConnect(connectionEndpoint ?? browser.endpoint)
      : browser.backend === "webkit"
      ? WebKit.layerAttach(browser.endpoint)
      : Bidi.layerConnect(browser.endpoint)
  }
  const options = { executablePath: browser.executablePath, userDataDir }
  switch (browser.backend) {
    case "chromium":
      return Chromium.layer(options)
    case "firefox":
      return Firefox.layer(options)
    case "webkit":
      return WebKit.layer(options)
  }
}

/** The state of a running session, for `--fork`. */
const forked = (rootDir: string, name: string) =>
  Effect.scoped(Effect.flatMap(Client.session(rootDir, name), (client) => client.State())).pipe(
    Effect.mapError((error) =>
      new CommandFailed({
        error: "InvalidInput",
        message: error instanceof Tools.ToolFailure
          ? `${name} couldn't export its state: ${error.message}`
          : `No session named ${name} to fork: ${error.message}`
      })
    )
  )

const decodeState = (text: string, from: string) =>
  Schema.decodeEffect(StorageState.Json)(text.trim()).pipe(
    Effect.mapError((error) =>
      new CommandFailed({ error: "InvalidInput", message: `${from} isn't a saved state: ${error.message}` })
    )
  )

/** The capture policies `--capture` names, `CapturePolicy`'s presets. */
const captures = ["local", "strict"] as const

/** Launch and lifetime flags shared with MCP help. */
export const startFlags = {
  name: Flag.String("name").pipe(Flag.withDescription("The session's name: lowercase letters, digits and dashes")),
  chromium: Flag.String("chromium").pipe(
    Flag.withDescription("Launch Chromium from this executable path; choose exactly one browser or --attach"),
    Flag.optional
  ),
  firefox: Flag.String("firefox").pipe(
    Flag.withDescription("Launch Firefox from this executable path; choose exactly one browser or --attach"),
    Flag.optional
  ),
  webkit: Flag.String("webkit").pipe(
    Flag.withDescription(
      "Launch stock WebKit from this MiniBrowser executable path; choose exactly one browser or --attach"
    ),
    Flag.optional
  ),
  attach: Flag.String("attach").pipe(
    Flag.withDescription("Attach to the browser at this endpoint instead of launching one"),
    Flag.optional
  ),
  userDataDir: Flag.String("user-data-dir").pipe(
    Flag.withDescription("Use this profile directory; it is kept when the session stops"),
    Flag.optional
  ),
  state: Flag.String("state").pipe(
    Flag.withDescription("Load initial storage state from this file; cannot be combined with --fork"),
    Flag.optional
  ),
  fork: Flag.String("fork").pipe(
    Flag.withDescription("Copy initial storage state from this running session; cannot be combined with --state"),
    Flag.optional
  ),
  viewport: Flag.String("viewport").pipe(
    Flag.withDescription("Viewport WIDTHxHEIGHT in positive integer CSS pixels for new pages"),
    Flag.optional
  ),
  idle: Flag.String("idle").pipe(
    Flag.withDescription("Stop after this duration without commands (default: 1 hour)"),
    Flag.withDefault("1 hour")
  ),
  ownerPid: Flag.Int("owner-pid").pipe(Flag.withDescription("Stop when this process exits"), Flag.optional),
  secret: Flag.KeyValuePair("secret").pipe(
    Flag.withDescription("Bind a secret name to an environment variable, as name=VARIABLE; repeat for more secrets"),
    Flag.withDefault({})
  ),
  capture: Flag.Literals("capture", captures).pipe(
    Flag.withDescription(
      "What snapshots, screenshots and digests may hold: local allows everything, for pages you trust; strict denies screenshots, masks fields' text and leaves console text out (default: local)"
    ),
    Flag.withDefault("local")
  )
}

/** `strider start`, run in the daemon: the session, from its start to its end. */
export const start = Command.make(
  "start",
  startFlags,
  (flags) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const process = Node.process
      if (!Session.nameRule.test(flags.name)) {
        return yield* Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: `${JSON.stringify(flags.name)}: a name is lowercase letters, digits and dashes, at most 32`
          })
        )
      }
      const viewport = Option.isSome(flags.viewport) ? yield* parseViewport(flags.viewport.value) : undefined
      const { browser, connectionEndpoint } = yield* browserOf(flags)
      // What Duration.fromInput reads, as a Schema decodes it from text
      const parsed = Schema.decodeUnknownOption(Schema.DurationFromString)(flags.idle)
      if (Option.isNone(parsed)) {
        return yield* Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: `--idle ${flags.idle} isn't a duration, such as "30 minutes"`
          })
        )
      }
      const idle = parsed.value
      const version = yield* Session.version
      const rootDir = Session.root(process.env, (yield* Effect.promise(() => Node.os())).tmpdir())
      const paths = Session.paths(rootDir, flags.name)
      yield* fs.makeDirectory(rootDir, { recursive: true, mode: 0o700 }).pipe(Effect.mapError(failedWith))
      // The directory is the session's claim: taken when it exists
      if (yield* fs.exists(paths.dir).pipe(Effect.orElseSucceed(() => false))) {
        // Its lock names the daemon holding it, which a process reusing its id isn't
        const running = Option.isSome(yield* Session.holder(fs, paths.dir))
        return yield* Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: running
              ? `A session named ${flags.name} is running; strider stop -s ${flags.name} ends it`
              : `A session named ${flags.name} ended without cleaning up, and its directory remains at ${paths.dir}; strider prune ${flags.name} removes it`
          })
        )
      }
      // Secrets are read from this environment, which the command's shell gave it
      const secrets: Record<string, Redacted.Redacted<string>> = {}
      for (const [name, variable] of Object.entries(flags.secret)) {
        secrets[name] = yield* Config.Redacted(variable).pipe(
          Effect.mapError(() =>
            new CommandFailed({ error: "InvalidInput", message: `--secret ${name}=${variable}: ${variable} isn't set` })
          )
        )
      }
      const stateFile = flags.state
      const forkOf = flags.fork
      const initial = Option.isSome(stateFile)
        ? Option.some(
          yield* Effect.flatMap(
            fs.readFileString(stateFile.value).pipe(Effect.mapError(failedWith)),
            (text) => decodeState(text, stateFile.value)
          )
        )
        : Option.isSome(forkOf)
        ? Option.some(yield* Effect.flatMap(forked(rootDir, forkOf.value), (text) => decodeState(text, forkOf.value)))
        : Option.none<StorageState.StorageState>()
      yield* fs.makeDirectory(paths.dir, { mode: 0o700 }).pipe(Effect.mapError(failedWith))
      let keep = false
      yield* Effect.addFinalizer(() =>
        keep
          // The socket may be gone with its server already, which leaves the lock to remove still
          ? Effect.forEach([paths.socket, paths.lock], (path) => fs.remove(path).pipe(Effect.ignore), { discard: true })
          : fs.remove(paths.dir, { recursive: true }).pipe(Effect.ignore)
      )
      yield* fs.writeFileString(paths.lock, Schema.encodeSync(Session.Lock)(Session.self())).pipe(
        Effect.mapError(failedWith)
      )
      // What the daemon logs goes to the session's log, as it has no output of its own
      const log = yield* Logger.toFile(Logger.formatSimple, paths.log).pipe(Effect.mapError(failedWith))
      keep = yield* serve(flags, {
        browser,
        connectionEndpoint,
        idle,
        paths,
        initial,
        stateFile,
        forkOf,
        secrets,
        version,
        viewport
      }).pipe(
        Effect.provide(Logger.layer([log]))
      )
    }).pipe(Effect.scoped)
).pipe(Command.withDescription("Start a named browser session"))

/** What `start` found before the session's browser: where the session lives, its browser, and how it starts. */
interface Prepared {
  readonly viewport: Viewport | undefined
  readonly browser: ExportTest.Browser
  /** The probed socket for this startup only; the spec and exports keep the supplied endpoint. */
  readonly connectionEndpoint: string | undefined
  readonly idle: Duration.Duration
  readonly paths: ReturnType<typeof Session.paths>
  readonly initial: Option.Option<StorageState.StorageState>
  readonly stateFile: Option.Option<string>
  readonly forkOf: Option.Option<string>
  readonly secrets: Readonly<Record<string, Redacted.Redacted<string>>>
  readonly version: string
}

/** The session: its browser, context and toolkit, served until it stops; whether to keep its directory then. */
const serve = Effect.fnUntraced(
  function*(flags: Command.Command.Config.Infer<typeof startFlags>, prepared: Prepared) {
    const fs = yield* FileSystem.FileSystem
    const process = Node.process
    const { browser, connectionEndpoint, forkOf, idle, initial, paths, secrets, stateFile, version, viewport } =
      prepared
    for (const dir of [paths.downloads, paths.artifacts]) {
      yield* fs.makeDirectory(dir).pipe(Effect.mapError(failedWith))
    }
    // The session's own profile directory, made here: a launcher uses a directory it is given as it is
    if (Option.isNone(flags.userDataDir)) yield* fs.makeDirectory(paths.profile).pipe(Effect.mapError(failedWith))
    const userDataDir = Option.getOrElse(flags.userDataDir, () => paths.profile)
    // What the session launches and makes is in the CLI's ledger, which strider prune reads if it dies
    const os = yield* Effect.promise(() => Node.os())
    const ledger = yield* Layer.build(Ledger.layer(Session.ledgerRoot(process.env, os.homedir())))
    const services = yield* Layer.build(layerOf(browser, userDataDir, connectionEndpoint)).pipe(
      Effect.provideContext(ledger),
      Effect.mapError(failedWith)
    )
    const instance = Context.get(services, Browser.Browser)
    const scope = yield* Effect.scope
    // Every page of the session keeps rendering while another is in front, as a person's would: focus is
    // emulated where the backend can, and Firefox opens new pages as windows (QUIRKS.md, Q19 and Q71)
    const focus = ExportTest.focusFor(browser)
    const capabilities = yield* instance.capabilities
    const reportsDownloads = capabilities.entries.every((entry) =>
      entry.name !== "downloads" || entry.status !== "unsupported"
    )
    const inspector = browser._tag === "Attach" && browser.backend === "webkit"
    if (inspector && (Option.isSome(initial) || viewport !== undefined)) {
      return yield* Effect.fail(
        new CommandFailed({
          error: "InvalidInput",
          message:
            "An attached WebKit inspector uses its existing default context; --state, --fork and --viewport require a browser that can create contexts"
        })
      )
    }
    const context = yield* (inspector ? instance.defaultContext.control : instance.newContext({
      ...Option.match(initial, { onNone: () => ({}), onSome: (storageState) => ({ storageState }) }),
      focus,
      ...(viewport === undefined ? {} : { emulation: { viewport } }),
      // The session's own directory, which strider stop --keep keeps
      downloads: reportsDownloads ? { directory: paths.downloads } : undefined
    })).pipe(Effect.mapError(failedWith))
    const recorder = Recorder.make()
    const session = yield* ToolkitImpl.makeSession({
      context,
      secrets,
      capture: flags.capture === "strict" ? CapturePolicy.strict : CapturePolicy.local,
      // The inspector shares the default context; its tabs still require explicit control.
      discoverContextPages: !inspector,
      // The session can take the browser's own tabs with control
      browser: instance,
      // A page no command opened, for the exported test to declare
      seen: (seen) =>
        seen._tag === "Listed"
          ? recorder.listed({ id: seen.page.id, name: seen.name, index: seen.index })
          : recorder.popup({ id: seen.page.id, name: seen.name, opener: seen.opener.id, openerName: seen.openerName })
    })
    const stopped = yield* Deferred.make<boolean>()
    // The stop asked for, which ends the session once its answer is written
    let stopping: (Request & { readonly keep: boolean }) | undefined
    let last = performance.now()
    const daemon: Daemon = {
      name: flags.name,
      strictCapture: flags.capture === "strict",
      viewport,
      viewports: new Map(),
      paths,
      browser,
      secretVariables: flags.secret,
      state: Option.getOrUndefined(Option.map(stateFile, (file) => file)),
      // --state wins over --fork, as the context above was made
      fork: Option.isSome(stateFile) ? undefined : Option.getOrUndefined(forkOf),
      userDataDir: Option.getOrUndefined(flags.userDataDir),
      context,
      session,
      scope,
      recorder,
      shots: 0,
      stop: (keepIt, request) => void (stopping = { ...request, keep: keepIt }),
      lastActivity: () => last,
      idleTimeout: flags.idle.replace(/\s+/g, " "),
      owner: Option.getOrUndefined(flags.ownerPid)
    }
    const touch = () => void (last = performance.now())
    const written = (request: Request) => {
      if (stopping !== undefined && stopping.client === request.client && stopping.id === request.id) {
        Deferred.doneUnsafe(stopped, Exit.succeed(stopping.keep))
      }
    }
    yield* Layer.build(
      RpcServer.layer(Protocol.Rpcs, { disableTracing: true }).pipe(
        Layer.provide(Protocol.Rpcs.toLayer(handlers(daemon, commands(() => daemon), version, touch))),
        Layer.provide(protocolTelling(written)),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(NodeSocketServer.layer({ path: paths.socket }))
      )
    ).pipe(Effect.mapError(failedWith))
    yield* Effect.gen(function*() {
      while (true) {
        yield* Effect.sleep("1 second")
        if (performance.now() - last > Duration.toMillis(idle)) return yield* Deferred.succeed(stopped, false)
        if (Option.isSome(flags.ownerPid) && !Node.alive(flags.ownerPid.value)) {
          return yield* Deferred.succeed(stopped, false)
        }
      }
    }).pipe(Effect.forkScoped)
    const where = browser._tag === "Launch" ? `at ${browser.executablePath}` : `attached to ${browser.endpoint}`
    yield* ready(
      yield* Announce,
      `session ${flags.name} · ${browser.backend} · ${instance.info.product} ${where} · focus ${focus} · idle timeout ${daemon.idleTimeout}${
        Option.isSome(flags.ownerPid) ? ` · ends with process ${flags.ownerPid.value}` : ""
      }${flags.capture === "strict" ? " · capture strict" : ""}${
        Option.isSome(flags.state)
          ? ` · state from ${flags.state.value}`
          : Option.isSome(flags.fork)
          ? ` · forked from ${flags.fork.value}`
          : ""
      }${viewport === undefined ? "" : ` · requested viewport default ${viewport.width}x${viewport.height}`}`
    )
    return yield* Deferred.await(stopped)
  }
)

let announced = false

/**
 * Tells the client that started the daemon what became of the start, over the socket it listens on: the spec,
 * once the session serves, or why it couldn't start.
 */
const announce = (path: string, started: Protocol.Started) =>
  Effect.scoped(Effect.gen(function*() {
    const socket = yield* NodeSocket.makeNet({ path })
    // Reading opens the connection, which writing waits for
    yield* socket.reader
    const writer = yield* socket.writer
    yield* writer.write(`${Schema.encodeSync(Protocol.StartedJson)(started)}\n`)
  })).pipe(Effect.ignore, Effect.ensuring(Effect.sync(() => void (announced = true))))

/** Tells the client the session serves. */
const ready = (path: string, text: string) => announce(path, { _tag: "Ready", text })

/** Where the client that started the daemon listens for what became of the start. */
class Announce extends Context.Service<Announce, string>()("@usestrider/browser/cli/Announce") {}

/**
 * The daemon: `strider start`'s flags, the session they describe, and its end. `announceTo` is the socket the
 * client that started it listens on.
 */
export const daemon = (announceTo: string, argv: ReadonlyArray<string>) => {
  const lines: Array<string> = []
  return Effect.flatMap(
    Session.version,
    (version) => Command.runWith(Command.make("strider").pipe(Command.withSubcommands([start])), { version })(argv)
  ).pipe(
    Effect.provideService(Console.Console, capture((line) => void lines.push(line.text))),
    Effect.provideService(Announce, announceTo),
    Effect.exit,
    Effect.flatMap((exit) => {
      if (announced) return Effect.void
      const { code, message } = exitOf(exit)
      const text = [...lines, ...(message === undefined ? [] : [message])].join("\n")
      return announce(announceTo, { _tag: "Failed", text: text === "" ? "the session didn't start" : text, code })
    })
  )
}
