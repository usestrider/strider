/**
 * A session's daemon (CLI.md). `strider start` starts one per session, in the session's
 * directory: it holds the browser, the session's one context and the toolkit's pages, snapshots, waits and
 * registrations, and serves the session's commands over its Unix socket, one connection each.
 *
 * - **Commands** are parsed here, with `effect/cli`, into the toolkit's tools and the session commands. Their
 *   output, and `effect/cli`'s help and errors, go back over the socket; the exit code is the command's.
 * - **Lifetime.** It ends at `strider stop`, after its idle timeout, or when `--owner-pid` exits, and deletes
 *   the session's directory unless told to keep it. A profile in `--user-data-dir` is never deleted.
 * - **Segments.** `strider run file.ts` imports the file here and runs its default export, with
 *   `CurrentSession` and a scope of its own; pages it returns are named into the session.
 */
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
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import type * as SocketServer from "effect/socket/SocketServer"
import * as Stream from "effect/Stream"
import * as CapturePolicy from "../../ai/CapturePolicy.ts"
import * as Bidi from "../../bidi/Bidi.ts"
import * as Browser from "../../Browser.ts"
import * as Chromium from "../../chromium/Chromium.ts"
import * as CurrentSession from "../../cli/CurrentSession.ts"
import * as Firefox from "../../firefox/Firefox.ts"
import * as Ledger from "../../Ledger.ts"
import * as Page from "../../Page.ts"
import type * as SocketConnector from "../../protocol/SocketConnector.ts"
import * as StorageState from "../../StorageState.ts"
import type * as UserContext from "../../UserContext.ts"
import * as WebKit from "../../webkit/WebKit.ts"
import * as Handles from "../handles.ts"
import * as ToolkitImpl from "../toolkit.ts"
import type * as Tools from "../tools.ts"
import * as ExportTest from "./exportTest.ts"
import * as Node from "./node.ts"
import * as Recorder from "./recorder.ts"
import * as Session from "./session.ts"

// ── The session ──

/** How a command shows a tool's outcome: its text, and the files it wrote. */
type Present = (
  outcome: any
) => Effect.Effect<{ readonly text: string; readonly files?: ReadonlyArray<string> }, never, FileSystem.FileSystem>

interface Daemon {
  readonly name: string
  readonly paths: ReturnType<typeof Session.paths>
  readonly browser: ExportTest.Browser
  readonly secretVariables: Readonly<Record<string, string>>
  /** The state file the session started from, which the exported test reads too. */
  readonly state: string | undefined
  /** The session whose state this one started from, which the exported test can't read. */
  readonly fork: string | undefined
  /** The profile directory the session's browser runs on, when it isn't the session's own. */
  readonly userDataDir: string | undefined
  readonly context: UserContext.UserContext
  readonly session: ToolkitImpl.Session
  readonly scope: Scope.Scope
  /** The steps `export test` writes, and how the session came to know the pages no command opened. */
  readonly recorder: Recorder.Recorder
  readonly stop: (keep: boolean) => void
  readonly lastActivity: () => number
  readonly idleTimeout: string
  readonly owner: number | undefined
  shots: number
}

/** A tool's final result, as the toolkit's `handle` gives it; the toolkit's tools give no preliminary ones. */
const callTool = (daemon: Daemon, tool: keyof Tools.Tools, params: Record<string, unknown>) =>
  Effect.flatMap(daemon.session.toolkit.handle(tool, params as never), Stream.runLast)

/** A tool call's target as a query on its page, for the exported test: a ref is the locator its snapshot names. */
const targetOf = (daemon: Daemon, params: Record<string, unknown>) => {
  const page = typeof params.page === "string" ? params.page : undefined
  return typeof params.target === "string" && page !== undefined
    ? ExportTest.queryOf(params.target, Option.getOrUndefined(daemon.session.latest(page)))
    : undefined
}

/** The tools that act on a page, and so may open a popup as they run. */
const actions = new Set(["newPage", "goto", "back", "click", "fill", "press", "select", "scroll"])

/** The page a command names, by id, as the session knows it now, or as its pages list it. */
const named = (daemon: Daemon, page: unknown): Effect.Effect<ReadonlyArray<string>> =>
  typeof page !== "string" ? Effect.succeed([]) : Option.match(daemon.session.named(page), {
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
  page?: unknown
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
  name: string,
  params: Record<string, unknown>,
  outcome: unknown,
  target: string | undefined,
  running: Recorder.Running | undefined
) => {
  const result = typeof outcome === "string" ? outcome : handleOf(outcome)
  daemon.recorder.record({ _tag: "Tool", tool: name, params, target, result }, running)
  const id = (page: unknown) =>
    typeof page === "string" ? Option.getOrUndefined(daemon.session.named(page))?.id : undefined
  // A page newPage opened or control took, and a popup await collected, is declared by its step
  const declared = name === "newPage" || name === "control"
    ? id(result)
    : name === "await" && result !== undefined
    ? id(/^popup (\S+),/.exec(result)?.[1])
    : undefined
  if (declared !== undefined) daemon.recorder.declared(declared)
  // A popup wait gives the next popup its page opens
  const opener = id(params.page)
  if (name === "next" && params.event === "popup" && result !== undefined && opener !== undefined) {
    daemon.recorder.waiting(result, opener)
  }
}

/** The handle a tool call printed: a wait's, a route's or dialog handler's registration, or a page's name. */
const handleOf = (outcome: unknown): string | undefined => {
  const made = outcome as { readonly wait?: string; readonly registration?: string; readonly page?: string }
  return made.wait ?? made.registration ?? made.page
}

class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly error: string
  readonly reason?: string | undefined
  readonly message: string
}> {}

const elapsedSince = (started: number) => `${Math.round(performance.now() - started)} ms`

/** The session's flags, which come before the command. */
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
  const tool = (
    name: keyof Tools.Tools,
    params: Record<string, unknown>,
    present: Present = plain
  ) => toolWith(name, params, present)
  const toolWith = (
    name: keyof Tools.Tools,
    params: Record<string, unknown>,
    present: Present
  ) =>
    recording(
      getDaemon(),
      actions.has(name) ? "action" : undefined,
      (running) => toolIn(name, params, present, running),
      params.page
    )
  const toolIn = Effect.fnUntraced(function*(
    name: keyof Tools.Tools,
    params: Record<string, unknown>,
    present: Present,
    running: Recorder.Running | undefined
  ) {
    const config = yield* root
    const started = performance.now()
    const page = typeof params.page === "string" ? params.page : undefined
    // Read before the call: a ref is the locator its snapshot named, which the call may replace
    const target = targetOf(getDaemon(), params)
    const result = yield* Effect.orDie(callTool(getDaemon(), name, params))
    const last = Option.getOrThrow(result)
    if (last.isFailure) {
      const failure = last.result as Tools.ToolFailure
      if (config.json) {
        yield* Console.log(
          JSON.stringify({ page, outcome: { _tag: "Failed", ...failure }, elapsed: elapsedSince(started) })
        )
      }
      return yield* Effect.fail(new CommandFailed(failure))
    }
    const value = last.result as { readonly outcome: unknown; readonly sinceLast: ReadonlyArray<string> }
    const shown = yield* present(value.outcome)
    record(getDaemon(), name, params, value.outcome, target, running)
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
      tool("pages", {}, (outcome: ReadonlyArray<{ page: string; url: string }>) =>
        Effect.succeed({
          text: outcome.map((each) => `${each.page}  ${each.url}`).join("\n") || "no pages"
        }))
  )
  const snapshot = Command.make(
    "snapshot",
    {},
    () => Effect.flatMap(pageFlag, (page) => tool("snapshot", { page }, (text: string) => Effect.succeed({ text })))
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
            (found: ReadonlyArray<{ ref: string; role: string; name: string; path: string }>) =>
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
          tool("screenshot", { page }, (outcome: { data: string }) =>
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
          tool("goto", params, (outcome: { url: string; status?: number }) =>
            Effect.succeed({ text: `at ${outcome.url}${outcome.status === undefined ? "" : ` (${outcome.status})`}` }))
      )
  )
  const back = Command.make(
    "back",
    {},
    () =>
      Effect.flatMap(pageFlag, (page) =>
        tool("back", { page }, (outcome: { url?: string }) =>
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
      event: Argument.Literals("event", ["navigation", "popup", "dialog", "download", "response", "console"]),
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
          tool("next", params, (outcome: { wait: string }) =>
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
      state: Argument.Literals("state", ["visible", "hidden", "enabled", "disabled", "checked"]),
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
      kind: Argument.Literals("kind", ["navigation", "console", "network", "dialog", "download", "exception"]),
      level: Flag.Literals("level", ["debug", "log", "info", "warning", "error"]).pipe(
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
          tool("history", params, (entries: ReadonlyArray<string>) =>
            Effect.succeed({ text: entries.length === 0 ? `no ${kind} recorded` : entries.join("\n") }))
      )
  )
  const route = Command.make(
    "route",
    {
      pattern: Argument.String("pattern"),
      action: Argument.Literals("action", ["abort", "continue", "fulfill"]),
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
          tool("route", params, (outcome: { registration: string }) =>
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
          decision: Argument.Literals("decision", ["accept", "dismiss"]),
          text: Flag.String("text").pipe(Flag.optional)
        },
        ({ decision, text }) =>
          Effect.flatMap(
            onPage((page) => ({ page, decision, ...(Option.isSome(text) ? { text: text.value } : {}) })),
            (params) =>
              tool("dialog", params, (outcome: { registration: string }) =>
                Effect.succeed({
                  text: `${outcome.registration}: dialogs ${decision}ed; strider remove ${outcome.registration} ends it`
                }))
          )
      )
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
      ),
      Command.make("name", { name: Argument.String("name") }, ({ name }) =>
        Effect.gen(function*() {
          const from = yield* pageFlag
          yield* getDaemon().session.rename(from, name).pipe(Effect.mapError((failure) => new CommandFailed(failure)))
          getDaemon().recorder.record({ _tag: "Rename", from, to: name })
          yield* Console.log(`${from} is now ${name}`)
        }))
    ])
  )
  // The browser's own tabs: an attached browser's, or a launched one's first
  const tabs = Command.make(
    "tabs",
    {},
    () =>
      tool("tabs", {}, (outcome: ReadonlyArray<{ tab: string; url: string }>) =>
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
        yield* tool("control", params, (outcome: { page: string; url: string }) =>
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
    { file: Argument.String("file") },
    ({ file }) =>
      Effect.gen(function*() {
        // Every page named first, so what's new after the segment is its own
        const before = new Map((yield* getDaemon().session.pages).map((each) => [each.page.id, each.name]))
        return yield* recording(getDaemon(), "segment", (running) =>
          Effect.gen(function*() {
            const ran = yield* Effect.exit(segment(getDaemon(), file))
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
          const text = yield* exportState(getDaemon())
          const resolved = yield* resolvePath(path)
          yield* fs.writeFileString(resolved, text, { mode: 0o600 }).pipe(Effect.mapError(failedWith))
          yield* Console.log(`saved the session's state to ${resolved}, readable by you alone`)
        })),
      Command.make("export", {}, () => Effect.flatMap(exportState(getDaemon()), Console.log)).pipe(
        Command.withDescription("The state as JSON, for a session that forks this one"),
        Command.unlisted
      )
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
        }))
    ])
  )
  const info = Command.make("info", {}, () =>
    Effect.gen(function*() {
      const pages = yield* getDaemon().session.pages
      yield* Console.log(JSON.stringify({
        name: getDaemon().name,
        browser: getDaemon().browser._tag === "Launch"
          ? getDaemon().browser.backend
          : `attached ${getDaemon().browser.backend}`,
        pages: pages.map((each) => each.name),
        idle: Math.round((performance.now() - getDaemon().lastActivity()) / 1000),
        idleTimeout: getDaemon().idleTimeout,
        owner: getDaemon().owner ?? null,
        dir: getDaemon().paths.dir
      }))
    })).pipe(Command.withDescription("The session, as JSON, for strider sessions"), Command.unlisted)
  const stop = Command.make(
    "stop",
    { keep: Flag.Boolean("keep").pipe(Flag.withDefault(false)) },
    ({ keep }) =>
      Effect.gen(function*() {
        getDaemon().stop(keep)
        yield* Console.log(
          keep
            ? `stopping ${getDaemon().name}; its directory stays at ${getDaemon().paths.dir}`
            : `stopping ${getDaemon().name}`
        )
      })
  )

  return root.pipe(
    Command.withSubcommands([
      pages,
      snapshot,
      find,
      screenshot,
      goto,
      back,
      click,
      fill,
      press,
      select,
      scroll,
      next,
      awaitCommand,
      expect,
      history,
      route,
      dialog,
      remove,
      page,
      tabs,
      control,
      release,
      run,
      state,
      exportCommand,
      info,
      stop
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
  const state = yield* daemon.context.exportStorageState.pipe(Effect.mapError(failedWith))
  // The codec for saving, which writes each Redacted value in full
  return yield* Schema.encodeEffect(StorageState.Json)(state).pipe(Effect.orDie)
})

/** `strider run`: the file's default export, with `CurrentSession` and a scope of its own. */
const segment = Effect.fnUntraced(function*(daemon: Daemon, file: string) {
  const paths = yield* Path.Path
  const resolved = yield* resolvePath(file)
  const url = yield* paths.toFileUrl(resolved).pipe(Effect.mapError(failedWith))
  // A query of its own, so an edited file is imported again
  const module = (yield* Effect.tryPromise({
    try: () => import(`${url.href}?run=${Date.now()}`),
    catch: (error) =>
      new CommandFailed({ error: "SegmentFailed", message: `${resolved} didn't load: ${String(error)}` })
  })) as { readonly default?: unknown }
  if (!Effect.isEffect(module.default)) {
    return yield* Effect.fail(
      new CommandFailed({
        error: "InvalidInput",
        message: `${resolved} has no default export that is an Effect; a segment exports one, run with CurrentSession`
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
  const value = yield* Effect.scoped(
    (module.default as Effect.Effect<unknown, unknown, CurrentSession.CurrentSession | Scope.Scope>).pipe(
      Effect.provideService(CurrentSession.CurrentSession, current)
    )
  ).pipe(Effect.mapError(failedWith))
  // Pages it returns are named into the session
  const returned = value !== null && typeof value === "object" ? Object.entries(value) : []
  const named: Array<string> = []
  for (const [key, each] of returned) {
    if (!Page.isPage(each)) continue
    const name = yield* daemon.session.name(each as Page.Page).pipe(
      Effect.mapError((failure) => new CommandFailed(failure))
    )
    named.push(`${key} is ${name}`)
  }
  yield* Console.log(`ran ${resolved}${named.length === 0 ? "" : `; ${named.join(", ")}`}`)
})

// ── Serving ──

/** A Console that keeps what a command prints, to send over the socket. */
const capture = (lines: Array<Session.Response>): Console.Console => {
  const text = (args: ReadonlyArray<unknown>) =>
    args.map((each) => typeof each === "string" ? each : String(each)).join(" ")
  const out = (...args: ReadonlyArray<unknown>) => void lines.push({ _tag: "Out", text: text(args) })
  const err = (...args: ReadonlyArray<unknown>) => void lines.push({ _tag: "Err", text: text(args) })
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

/** One connection: a command, run and answered, which an `Interrupt` line after it interrupts. */
const serve = (daemon: Daemon, tree: ReturnType<typeof commands>, touch: () => void) => (socket: Socket.Socket) =>
  Effect.scoped(Effect.gen(function*() {
    const reader = yield* socket.reader
    const writer = yield* socket.writer
    const requests = yield* Queue.unbounded<Session.Request>()
    let buffered = ""
    yield* Effect.gen(function*() {
      while (true) {
        for (const chunk of yield* reader.pull) {
          buffered += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
        }
        let end: number
        while ((end = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, end)
          buffered = buffered.slice(end + 1)
          if (line !== "") yield* Queue.offer(requests, JSON.parse(line) as Session.Request)
        }
      }
    }).pipe(Effect.ignore, Effect.forkScoped)
    const request = yield* Queue.take(requests)
    if (request._tag === "Tool") {
      // A tool called as a model calls it, for strider mcp: its encoded result, then the exit code
      touch()
      const params = (request.params ?? {}) as Record<string, unknown>
      const target = targetOf(daemon, params)
      const lines: Array<Session.Response> = []
      yield* recording(daemon, actions.has(request.tool) ? "action" : undefined, (running) =>
        Effect.gen(function*() {
          const exit = yield* Effect.exit(callTool(daemon, request.tool as keyof Tools.Tools, params))
          if (Exit.isSuccess(exit) && Option.isSome(exit.value)) {
            const result = exit.value.value
            if (!result.isFailure) {
              const outcome = (result.result as { readonly outcome: unknown }).outcome
              record(daemon, request.tool, params, outcome, target, running)
            }
            lines.push({ _tag: "ToolResult", failure: result.isFailure, value: result.encodedResult })
            lines.push({ _tag: "Exit", code: 0 })
          } else {
            lines.push({ _tag: "Err", text: `${request.tool} isn't one of the session's tools, or it died` })
            lines.push({ _tag: "Exit", code: 1 })
          }
        }), params.page)
      touch()
      for (const line of lines) yield* writer.write(`${JSON.stringify(line)}\n`).pipe(Effect.ignore)
      return
    }
    if (request._tag !== "Command") return
    touch()
    const lines: Array<Session.Response> = []
    const fiber = yield* Command.runWith(tree, { version: "0.1.0" })(request.argv).pipe(
      Effect.provideService(Console.Console, capture(lines)),
      Effect.provideService(WorkingDirectory, request.cwd),
      Effect.exit,
      Effect.forkScoped
    )
    yield* Effect.flatMap(
      Queue.take(requests),
      (next) => next._tag === "Interrupt" ? Fiber.interrupt(fiber) : Effect.void
    ).pipe(
      Effect.forkScoped
    )
    const exit = yield* Fiber.join(fiber)
    touch()
    let code = 0
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
      if (failure !== undefined) {
        const error = failure.error as { readonly _tag?: string; readonly error?: string; readonly message?: string }
        const tag = error._tag === "CommandFailed" ? error.error ?? "Error" : error._tag ?? "Error"
        code = Session.exitCodes[tag] ?? (error._tag === "CommandFailed" ? 1 : Session.exitCodes.CliError!)
        if (error._tag === "CommandFailed") lines.push({ _tag: "Err", text: `${tag}: ${error.message}` })
      } else if (exit.cause.reasons.every((reason) => reason._tag === "Interrupt")) {
        lines.push({ _tag: "Err", text: "interrupted; the session goes on" })
        code = 130
      } else {
        lines.push({ _tag: "Err", text: `the command died: ${String(exit.cause)}` })
        code = 1
      }
    }
    for (const line of [...lines, { _tag: "Exit", code } satisfies Session.Response]) {
      yield* writer.write(`${JSON.stringify(line)}\n`).pipe(Effect.ignore)
    }
  }))

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
}): Effect.Effect<ExportTest.Browser, CommandFailed> => {
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
    // An HTTP endpoint, or a WebSocket to /devtools/, is Chromium's; any other WebSocket WebDriver BiDi's
    ...Option.toArray(Option.map(flags.attach, (endpoint) =>
      /^https?:|\/devtools\//.test(endpoint)
        ? { _tag: "Attach", backend: "chromium", endpoint } as const
        : { _tag: "Attach", backend: "bidi", endpoint: bidiEndpoint(endpoint) } as const))
  ]
  return given.length === 1
    ? Effect.succeed(given[0]!)
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
  userDataDir: string
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
      ? Chromium.layerConnect(browser.endpoint)
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
const forked = Effect.fnUntraced(function*(rootDir: string, name: string) {
  const net = yield* Effect.promise(() => Node.net())
  const text = yield* Effect.callback<string, CommandFailed>((resume) => {
    const socket = net.createConnection(Session.paths(rootDir, name).socket)
    let buffered = ""
    let out = ""
    socket.on(
      "connect",
      () => socket.write(`${JSON.stringify({ _tag: "Command", argv: ["-s", name, "state", "export"], cwd: "/" })}\n`)
    )
    socket.on("data", (data) => {
      buffered += new TextDecoder().decode(data)
      let end: number
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffered.slice(0, end)) as Session.Response
        buffered = buffered.slice(end + 1)
        if (line._tag === "Out") out += line.text
        if (line._tag === "Exit") {
          socket.end()
          resume(
            line.code === 0
              ? Effect.succeed(out)
              : Effect.fail(new CommandFailed({ error: "InvalidInput", message: `${name} couldn't export its state` }))
          )
        }
      }
    })
    socket.on(
      "error",
      (error) =>
        resume(
          Effect.fail(
            new CommandFailed({ error: "InvalidInput", message: `No session named ${name} to fork: ${error.message}` })
          )
        )
    )
  })
  return text
})

const decodeState = (text: string, from: string) =>
  Schema.decodeEffect(StorageState.Json)(text.trim()).pipe(
    Effect.mapError((error) =>
      new CommandFailed({ error: "InvalidInput", message: `${from} isn't a saved state: ${error.message}` })
    )
  )

/** `strider start`, run in the daemon: the session, from its start to its end. */
export const start = Command.make(
  "start",
  {
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
    idle: Flag.String("idle").pipe(
      Flag.withDescription("Stop after this duration without commands (default: 1 hour)"),
      Flag.withDefault("1 hour")
    ),
    ownerPid: Flag.Int("owner-pid").pipe(Flag.withDescription("Stop when this process exits"), Flag.optional),
    secret: Flag.KeyValuePair("secret").pipe(
      Flag.withDescription("Bind a secret name to an environment variable, as name=VARIABLE; repeat for more secrets"),
      Flag.withDefault({})
    )
  },
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
      const browser = yield* browserOf(flags)
      let idle: Duration.Duration
      try {
        idle = Duration.fromInputUnsafe(flags.idle as Duration.Input)
      } catch {
        return yield* Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: `--idle ${flags.idle} isn't a duration, such as "30 minutes"`
          })
        )
      }
      const rootDir = Session.root(process.env, (yield* Effect.promise(() => Node.os())).tmpdir())
      const paths = Session.paths(rootDir, flags.name)
      yield* fs.makeDirectory(rootDir, { recursive: true, mode: 0o700 }).pipe(Effect.mapError(failedWith))
      // The directory is the session's claim: taken when it exists
      if (yield* fs.exists(paths.dir).pipe(Effect.orElseSucceed(() => false))) {
        const lock = yield* fs.readFileString(paths.lock).pipe(Effect.option)
        const pid = Option.flatMap(lock, (text) => Option.fromUndefinedOr(Number.parseInt(text, 10) || undefined))
        return yield* Effect.fail(
          new CommandFailed({
            error: "InvalidInput",
            message: Option.exists(pid, Node.alive)
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
          ? Effect.all([fs.remove(paths.socket), fs.remove(paths.lock)], { discard: true }).pipe(Effect.ignore)
          : fs.remove(paths.dir, { recursive: true }).pipe(Effect.ignore)
      )
      yield* fs.writeFileString(paths.lock, `${process.pid}\n`).pipe(Effect.mapError(failedWith))
      for (const dir of [paths.downloads, paths.artifacts]) {
        yield* fs.makeDirectory(dir).pipe(Effect.mapError(failedWith))
      }
      // The session's own profile directory, made here: a launcher uses a directory it is given as it is
      if (Option.isNone(flags.userDataDir)) yield* fs.makeDirectory(paths.profile).pipe(Effect.mapError(failedWith))
      const userDataDir = Option.getOrElse(flags.userDataDir, () => paths.profile)
      // What the session launches and makes is in the CLI's ledger, which strider prune reads if it dies
      const os = yield* Effect.promise(() => Node.os())
      const ledger = yield* Layer.build(Ledger.layer(Session.ledgerRoot(process.env, os.homedir())))
      const services = yield* Layer.build(layerOf(browser, userDataDir)).pipe(
        Effect.provideContext(ledger),
        Effect.mapError(failedWith)
      )
      const instance = Context.get(services, Browser.Browser)
      const scope = yield* Effect.scope
      // Every page of the session keeps rendering while another is in front, as a person's would: focus is
      // emulated where the backend can, and Firefox opens new pages as windows (QUIRKS.md, Q19 and Q71)
      const focus = ExportTest.focusFor(browser)
      const context = yield* instance.newContext({
        ...Option.match(initial, { onNone: () => ({}), onSome: (storageState) => ({ storageState }) }),
        focus,
        // The session's own directory, which strider stop --keep keeps
        downloads: { directory: paths.downloads }
      }).pipe(
        Effect.mapError(failedWith)
      )
      const recorder = Recorder.make()
      const session = yield* ToolkitImpl.makeSession({
        context,
        secrets,
        capture: CapturePolicy.local,
        // The session can take the browser's own tabs with control
        browser: instance,
        // A page no command opened, for the exported test to declare
        seen: (seen) =>
          seen._tag === "Listed"
            ? recorder.listed({ id: seen.page.id, name: seen.name, index: seen.index })
            : recorder.popup({ id: seen.page.id, name: seen.name, opener: seen.opener.id, openerName: seen.openerName })
      })
      const stopped = yield* Deferred.make<boolean>()
      let last = performance.now()
      const daemon: Daemon = {
        name: flags.name,
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
        // After the command that asked has had its answer
        stop: (keepIt) => void setTimeout(() => Deferred.doneUnsafe(stopped, Exit.succeed(keepIt)), 50),
        lastActivity: () => last,
        idleTimeout: Duration.format(idle),
        owner: Option.getOrUndefined(flags.ownerPid)
      }
      const nodeServer = yield* Effect.promise(() => import("@effect/platform-node/NodeSocketServer"))
      const server: SocketServer.SocketServer["Service"] = yield* nodeServer.make({ path: paths.socket }).pipe(
        Effect.mapError(failedWith)
      )
      const touch = () => void (last = performance.now())
      const tree = commands(() => daemon)
      yield* server.run(serve(daemon, tree, touch)).pipe(Effect.ignore, Effect.forkScoped)
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
      ready(
        `session ${flags.name} · ${instance.info.product} ${where} · focus ${focus} · idle timeout ${
          Duration.format(idle)
        }${Option.isSome(flags.ownerPid) ? ` · ends with process ${flags.ownerPid.value}` : ""}${
          Option.isSome(flags.state)
            ? ` · state from ${flags.state.value}`
            : Option.isSome(flags.fork)
            ? ` · forked from ${flags.fork.value}`
            : ""
        }`,
        paths.log
      )
      keep = yield* Deferred.await(stopped)
    }).pipe(Effect.scoped)
)

let announced = false

/** Tells the client the session serves, then sends the daemon's own output to its log. */
const ready = (text: string, log: string) => {
  const process = Node.process
  process.stdout.write(`${JSON.stringify({ _tag: "Ready", text } satisfies Session.Started)}\n`)
  announced = true
  void Node.fs().then((fs) => {
    const append = (chunk: unknown) => {
      try {
        fs.appendFileSync(log, typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array))
      } catch {
        // The directory went with the session
      }
      return true
    }
    ;(process.stdout as { write: (chunk: unknown) => boolean }).write = append
    ;(process.stderr as { write: (chunk: unknown) => boolean }).write = append
  })
}

/** The daemon: `strider start`'s flags, the session they describe, and its end. */
export const daemon = (argv: ReadonlyArray<string>) => {
  const lines: Array<Session.Response> = []
  return Command.runWith(Command.make("strider").pipe(Command.withSubcommands([start])), { version: "0.1.0" })(argv)
    .pipe(
      Effect.provideService(Console.Console, capture(lines)),
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.sync(() => {
          if (announced) return
          const failure = Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === "Fail") : undefined
          const error = failure?.error as
            | { readonly _tag?: string; readonly error?: string; readonly message?: string }
            | undefined
          const text = [
            ...lines.map((line) => line._tag === "Out" || line._tag === "Err" ? line.text : ""),
            ...(error?._tag === "CommandFailed" ? [`${error.error}: ${error.message}`] : [])
          ].filter((line) => line !== "").join("\n")
          Node.process.stdout.write(
            `${
              JSON.stringify(
                {
                  _tag: "Failed",
                  text: text === ""
                    ? `the session didn't start: ${String(Exit.isFailure(exit) ? exit.cause : "")}`
                    : text,
                  code: error?._tag === "CommandFailed"
                    ? Session.exitCodes[error.error ?? ""] ?? 1
                    : Session.exitCodes.CliError!
                } satisfies Session.Started
              )
            }\n`
          )
        })
      )
    )
}
