/**
 * Stock WebKit launched in automation mode: a browser process for each context,
 * each reached through its inspector server's socket (`webkitInspectorSocket.ts`), as WebKit's own WebDriver
 * reaches it.
 *
 * - **A process per context.** An automation session has one profile, ephemeral. The first process is the default
 *   context; `launch` starts another for each context made, and `close` ends it.
 * - **Each process's Automation session** is a protocol client of its own over the session's target: its root
 *   session takes the generated `Automation` commands.
 * - **Each process's pages** are the inspector's `WebPage` targets on the same socket, presented to the WebKit
 *   adapter on one transport, through the envelope's endpoint (`webkitEnvelope.ts`), as `webkitStockTransport.ts`
 *   presents an attached browser's: a page proxy's id is the process's and the target's, and its context the
 *   process's.
 * - **An anchor.** A browser exits when its last window closes (QUIRKS.md, Q213), so each process keeps a window of its own,
 *   minimized and never announced: a context's process keeps its first window; the default context's announces its
 *   first window as the browser's first tab, as every backend does (Q141), and opens one more.
 * - **The port.** A browser told a port that's taken keeps running without its server, saying so on stderr; the
 *   launch tries another.
 */
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as PlatformError from "effect/PlatformError"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Random from "effect/Random"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Browser from "../Browser.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Protocol from "../protocol/Protocol.ts"
import * as SocketConnector from "../protocol/SocketConnector.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Automation from "../webkit-automation-protocol/Automation.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Launch from "./launch.ts"
import * as Link from "./link.ts"
import * as Operation from "./operation.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as Proxy from "./proxy.ts"
import * as Envelope from "./webkitEnvelope.ts"
import * as InspectorSocket from "./webkitInspectorSocket.ts"
import * as WebKitWire from "./webkitWire.ts"

/**
 * How a browser takes automation mode, by its executable's name; `None` for one this doesn't launch. WebKitGTK's
 * and WPE's MiniBrowser only: GNOME Web's automation mode opens no second page, and aborts as one closes
 * (QUIRKS.md, Q217).
 */
export const automationArguments = (executablePath: string): Option.Option<ReadonlyArray<string>> =>
  executablePath.split(/[\\/]/).at(-1) === "MiniBrowser" ? Option.some(["--automation"]) : Option.none()

/** `self`'s value, or `None` once `deadline` passes on the live clock: a launched browser's time. */
const byDeadline = (deadline: MonotonicInstant.MonotonicInstant) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.suspend(() =>
    BrowserClock.timeoutOn(BrowserClock.live, BrowserClock.millisLeft(BrowserClock.live, deadline))(self)
  )

/** What a launch takes. */
export interface Settings {
  readonly executablePath: string
  readonly headless?: boolean | undefined
  readonly args?: ReadonlyArray<string> | undefined
  readonly userDataDir?: string | undefined
  /** @default false */
  readonly coreDumps?: boolean | undefined
  /**
   * How long each process has, from its start, to answer on its inspector server and start its session, with its
   * first windows listed.
   *
   * @default "30 seconds"
   */
  readonly timeout?: Duration.Input | undefined
  /** Wraps each process's Automation transport, as the drift test's recorder does (`test/integration/record.ts`). */
  readonly wrapAutomation?: ((transport: Transport.Transport) => Transport.Transport) | undefined
}

/** What a context's process is started with. */
export interface ProcessOptions {
  readonly proxy?: Adapter.ProxyOptions | undefined
  /** The time zone, which a WebKitGTK browser takes at launch (`--time-zone`). */
  readonly timeZone?: string | undefined
  /** Whether the session accepts certificates it can't verify, a capability of the session. */
  readonly acceptInsecureCerts?: boolean | undefined
}

/** A context's browser process, and its Automation session. */
export interface Process {
  /** Why its connection ended, once it has, and what it sent before is delivered. */
  readonly closed: Effect.Effect<Transport.ConnectionLost>
  /** The context's id in the envelope: `default` for the first process. */
  readonly key: string
  readonly browserName: string
  readonly browserVersion: string
  /** The Automation session's root, for the generated `Automation` commands. */
  readonly automation: Protocol.ProtocolSession
  /** The handle of the window that keeps the process alive. */
  readonly anchor: Automation.BrowsingContextHandle
  /** Ends the process. */
  readonly close: Effect.Effect<void>
  /** Kills the process outright, as a crash would end it. */
  readonly kill: Effect.Effect<void>
}

/** The browser processes of one connection, and the transport of their pages. */
export interface Group {
  /** Every process's pages, for the WebKit adapter, in our envelope (`webkitEnvelope.ts`). */
  readonly transport: Transport.Transport
  /** The default context's process. */
  readonly first: Process
  /** A process for a new context. */
  readonly launch: (options: ProcessOptions) => Effect.Effect<Process, Launch.LaunchError>
  /** A context's process, by its key. */
  readonly process: (key: string) => Process | undefined
}

const portRange = [49152, 65535] as const

/** The port a launch tried was taken: another is tried. */
class PortTaken extends Data.TaggedError("PortTaken") {}

/** Readiness polling shares the launcher's existing connection polling policy. */
class ListenerPending extends Data.TaggedError("ListenerPending") {}

/** A procfs access failure can precede delivery of the child exit event. */
class ProcfsReadFailed extends Data.TaggedError("ProcfsReadFailed")<{ readonly cause: PlatformError.PlatformError }> {}

const attachGuidance = "Use WebKit.layerAttach with an externally managed inspector HTTP endpoint instead."
const ownershipGuidance = `Wrappers must exec MiniBrowser; fork-only wrappers are not supported. ${attachGuidance}`

/**
 * The exact spawned PID must hold the IPv4 loopback listener. The namespace's TCP table alone includes other
 * processes, so its inode must also occur in this PID's descriptors. Never inspect descendants.
 */
export const inspectorListener = Effect.fnUntraced(function*(pid: number, port: number) {
  if (process.platform !== "linux") {
    return yield* Launch.refused(
      `Launched WebKit requires Linux procfs socket ownership verification. ${attachGuidance}`
    )
  }
  const fs = yield* FileSystem.FileSystem
  return yield* Effect.gen(function*() {
    const table = yield* fs.readFileString(`/proc/${pid}/net/tcp`)
    // procfs prints the IPv4 word in host byte order, including on big-endian Linux.
    const loopback = new Uint32Array(new Uint8Array([127, 0, 0, 1]).buffer)[0]!.toString(16).toUpperCase().padStart(
      8,
      "0"
    )
    const address = `${loopback}:${port.toString(16).toUpperCase().padStart(4, "0")}`
    const inodes = new Set(
      table.trim().split("\n").slice(1).flatMap((line) => {
        const fields = line.trim().split(/\s+/)
        return fields[1] === address && fields[3] === "0A" && fields[9] !== undefined && fields[9] !== "0"
          ? [fields[9]]
          : []
      })
    )
    // Read the descriptor directory even before a listener exists: permission failures are refusals, not readiness.
    const descriptors = yield* fs.readDirectory(`/proc/${pid}/fd`)
    if (inodes.size !== 1) return undefined
    for (const fd of descriptors) {
      const target = yield* fs.readLink(`/proc/${pid}/fd/${fd}`).pipe(
        Effect.catchIf((error) => error.reason._tag === "NotFound", () => Effect.succeed(""))
      )
      const match = /^socket:\[(\d+)\]$/.exec(target)
      if (match !== null && inodes.has(match[1]!)) return match[1]!
    }
    return undefined
  }).pipe(
    Effect.mapError((cause) => new ProcfsReadFailed({ cause }))
  )
})

/** What a socket that ended was lost to. */
const lossOf = (error: Transport.TransportError) =>
  error.reason._tag === "ConnectionLost"
    ? error.reason
    : new Transport.ConnectionLost({ initiator: "remote", description: error.reason.description })

const scopeClosed = () => new Transport.ConnectionLost({ initiator: "local", description: "The scope closed" })

// ── The launcher ──────────────────────────────────────────────────────────────────────────────────────────

const startupStages = {
  spawned: "spawned",
  listener: "listener verified",
  connected: "connected",
  inspector: "inspector established"
} as const

/** One bounded record per process; each port attempt replaces the preceding attempt's stages. */
class Startup {
  readonly began = BrowserClock.now()
  attempt = 0
  port: number | undefined
  pid: number | undefined
  spawned: number | undefined
  listener: number | undefined
  connected: number | undefined
  inspector: number | undefined

  readonly operation: Operation.Record | undefined

  constructor(operation: Operation.Record | undefined) {
    this.operation = operation
  }

  reset(port: number): void {
    this.attempt++
    this.port = port
    this.pid =
      this.spawned =
      this.listener =
      this.connected =
      this.inspector =
        undefined
  }

  /** One observation per completed stage, with immutable attribution even when another port is tried. */
  mark(stage: keyof typeof startupStages): void {
    if (this[stage] !== undefined) return
    const at = this[stage] = BrowserClock.now()
    this.operation?.observe(
      `WebKit startup ${startupStages[stage]}: attempt ${this.attempt}, port ${this.port}, PID ${this.pid}, ${
        ((at - this.began) / 1e6).toFixed(3)
      }ms`
    )
  }

  failure(error: Launch.LaunchError): Launch.LaunchError {
    const stages = [
      ["spawned", this.spawned],
      ["listener verified", this.listener],
      ["connected", this.connected],
      ["inspector established", this.inspector]
    ] as const
    const reached = stages.flatMap(([name, at]) =>
      at === undefined ? [] : [`${name} at ${((at - this.began) / 1e6).toFixed(3)}ms`]
    )
    const hint = `${error.reason.hint} WebKit startup (port ${this.port ?? "unselected"}, PID ${
      this.pid ?? "unspawned"
    }; times since startup): ${reached.length === 0 ? "no stage completed" : reached.join(", ")}.`
    const reason = error.reason
    switch (reason._tag) {
      case "ConnectionFailed":
        return new Browser.BrowserError({ ...error, reason: new Browser.ConnectionFailed({ ...reason, hint }) })
      case "ProcessExited":
        return new Browser.BrowserError({ ...error, reason: new Browser.ProcessExited({ ...reason, hint }) })
      default:
        return error
    }
  }
}

/**
 * Starts one browser in automation mode, on a port nothing listens on, tried until the browser starts its server
 * there: one that's taken, it says so on stderr, and keeps running without it (QUIRKS.md, Q216).
 */
const spawnProcess = Effect.fnUntraced(function*(
  settings: Settings,
  index: number,
  options: ProcessOptions,
  deadline: MonotonicInstant.MonotonicInstant,
  startup: Startup
) {
  if (process.platform !== "linux") {
    return yield* Launch.refused(
      `Launched WebKit requires Linux procfs socket ownership verification. ${attachGuidance}`
    )
  }
  const connector = yield* SocketConnector.SocketConnector
  const scope = yield* Effect.scope
  const path = yield* Launch.executable(settings.executablePath)
  const automationArgs = automationArguments(path)
  if (Option.isNone(automationArgs)) {
    return yield* Launch.invalidInput({
      input: "executablePath",
      expected: "WebKitGTK's or WPE's MiniBrowser, which this launches in automation mode",
      hint: `${path} isn't one this launches in automation mode`
    }, "check the executable")
  }
  const directory = yield* Launch.profileDirectory(index === 0 ? settings.userDataDir : undefined, "strider-webkit-")
  const args = [
    ...automationArgs.value,
    ...(options.timeZone === undefined ? [] : [`--time-zone=${options.timeZone}`]),
    ...(settings.args ?? [])
  ]
  const attempt = Effect.gen(function*() {
    const port = yield* Random.nextIntBetween(portRange[0], portRange[1])
    startup.reset(port)
    const own = yield* Scope.fork(scope)
    return yield* Effect.gen(function*() {
      const launched = yield* Launch.spawn(path, args, directory, {
        coreDumps: settings.coreDumps,
        env: {
          WEBKIT_INSPECTOR_SERVER: `127.0.0.1:${port}`,
          ...(options.proxy === undefined ? {} : {
            http_proxy: `http://${options.proxy.server}`,
            https_proxy: `http://${options.proxy.server}`,
            HTTP_PROXY: `http://${options.proxy.server}`,
            HTTPS_PROXY: `http://${options.proxy.server}`,
            all_proxy: "",
            ALL_PROXY: "",
            no_proxy: [...Proxy.loopback, ...options.proxy.bypass].join(","),
            NO_PROXY: [...Proxy.loopback, ...options.proxy.bypass].join(",")
          }),
          XDG_DATA_HOME: `${directory}/data`,
          XDG_CACHE_HOME: `${directory}/cache`,
          XDG_CONFIG_HOME: `${directory}/config`
        }
      }).pipe(Scope.provide(own))
      startup.pid = Number(launched.handle.pid)
      startup.mark("spawned")
      let unavailable: string | undefined
      const listener = inspectorListener(Number(launched.handle.pid), port).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (error._tag === "ProcfsReadFailed") {
              unavailable =
                `Cannot read Linux procfs to verify WebKit child PID ${launched.handle.pid}: ${error.cause.message}.`
            }
          })
        )
      )
      const outcome = yield* Effect.raceAllFirst([
        Effect.gen(function*() {
          const inode = yield* listener
          if (inode === undefined) return yield* Effect.fail(new ListenerPending())
          startup.mark("listener")
          const connecting = yield* Scope.fork(own)
          return yield* Effect.gen(function*() {
            const connection = yield* connector.connect({ host: "127.0.0.1", port }).pipe(Scope.provide(connecting))
            startup.mark("connected")
            const after = yield* listener
            if (after === undefined) {
              unavailable =
                `WebKit child PID ${launched.handle.pid} no longer holds its inspector listener after connecting.`
              yield* Scope.close(connecting, Exit.void)
              return yield* Effect.never
            }
            if (after !== inode) {
              return yield* Launch.refused(
                `WebKit child PID ${launched.handle.pid} no longer holds the same inspector listener after connecting. ${ownershipGuidance}`
              )
            }
            return connection
          }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? Scope.close(connecting, exit) : Effect.void))
        }).pipe(
          // Close a rejected connection before waiting for exit; no ownership attempt resumes after a read failure.
          Effect.catchTag("ProcfsReadFailed", () => Effect.never),
          Effect.retry({
            while: (error) => error._tag === "ListenerPending" || error._tag === "SocketError",
            schedule: Schedule.spaced("100 millis")
          }),
          Effect.catchTags({
            ListenerPending: () => Effect.succeed(undefined),
            SocketError: () => Effect.succeed(undefined)
          }),
          byDeadline(deadline),
          Effect.map((connection) =>
            Option.isSome(connection) && connection.value !== undefined
              ? { _tag: "Connected" as const, connection: connection.value }
              : { _tag: "Silent" as const }
          ),
          BrowserClock.onLive
        ),
        launched.stderrLine(new RegExp(`Failed to start remote inspector server on 127\\.0\\.0\\.1:${port}`)).pipe(
          Effect.flatMap((line) =>
            Option.isSome(line) && unavailable === undefined ? Effect.succeed({ _tag: "Taken" as const }) : Effect.never
          )
        ),
        launched.handle.exitCode.pipe(Effect.exit, Effect.map((exit) => ({ _tag: "Exited" as const, exit })))
      ])
      switch (outcome._tag) {
        case "Connected":
          return { connection: outcome.connection, launched }
        case "Taken":
          return yield* Effect.fail(new PortTaken())
        case "Exited": {
          // Drain stderr if it closes, but descendants can keep it open. Neither case extends the launch deadline.
          yield* launched.stderrLine(/(?!)/).pipe(byDeadline(deadline), BrowserClock.onLive)
          const stderrTail = yield* launched.stderrTail
          return yield* Launch.fail(
            new Browser.ProcessExited({
              code: Exit.isSuccess(outcome.exit) ? Option.some(Number(outcome.exit.value)) : Option.none(),
              stderrTail,
              hint:
                `The spawned process exited before inspector ownership was verified; its stderr is in stderrTail. ${ownershipGuidance}`
            }),
            "connect"
          )
        }
        default: {
          const description = `${
            unavailable ??
              `Its inspector server on port ${port} never answered with verifiable ownership by spawned PID ${launched.handle.pid}.`
          } No child exit was observed before the launch deadline. ${ownershipGuidance}`
          return yield* unavailable !== undefined
            ? Launch.refused(description)
            : Launch.fail(
              new Browser.ConnectionFailed({ stage: "handshake", hint: `The browser didn't answer: ${description}` }),
              "connect"
            )
        }
      }
    }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? Scope.close(own, exit) : Effect.void))
  })
  return yield* attempt.pipe(
    Effect.retry({ while: (error) => error._tag === "PortTaken", times: 4 }),
    Effect.catchTag(
      "PortTaken",
      () =>
        Launch.refused(
          `Five ports in a row were taken, so the browser's inspector server never started. ${attachGuidance}`
        )
    )
  )
})

// ── A process's session ───────────────────────────────────────────────────────────────────────────────────

/** Starts one browser in automation mode and its session, for the scope, its pages announced on `pages`. */
const startProcess = Effect.fnUntraced(function*(
  settings: Settings,
  key: string,
  index: number,
  options: ProcessOptions,
  pages: Envelope.Endpoint,
  startup: Startup
) {
  // One deadline for the process to start, on the live clock: a starved machine's browser is slow at each step
  const timeout = Duration.fromInputUnsafe(settings.timeout ?? "30 seconds")
  const deadline = (BrowserClock.now() + Duration.toMillis(timeout) * 1e6) as MonotonicInstant.MonotonicInstant
  const within = `within ${Duration.format(timeout)}`
  const waitFor = <A>(deferred: Deferred.Deferred<A>, never: string) =>
    Deferred.await(deferred).pipe(
      byDeadline(deadline),
      Effect.flatMap((value) =>
        Option.isSome(value) ? Effect.succeed(value.value) : Launch.refused(`${never} ${within}`)
      )
    )
  const { connection, launched } = yield* spawnProcess(settings, index, options, deadline, startup)
  const socket = yield* InspectorSocket.connect(connection)
  startup.mark("inspector")
  const started = yield* Deferred.make<{ readonly browserName: string; readonly browserVersion: string }>()
  const automationReady = yield* Deferred.make<bigint>()
  const firstList = yield* Deferred.make<ReadonlyArray<InspectorSocket.Target>>()
  const ended = yield* Deferred.make<Transport.ConnectionLost>()
  const automationLink = yield* Link.make()
  let connectionId = 0n
  let automationTarget: bigint | undefined
  // Page targets announced, by target id, and the ones that are this process's anchors
  const announced = new Map<bigint, string>()
  const anchors = new Set<bigint>()
  // The first list's pages, which the start below announces or keeps as the anchor
  const initial = new Set<bigint>()
  let holdNext: Deferred.Deferred<bigint> | undefined
  const pageProxyIdOf = (target: bigint) => `${index}-${target}`

  const onTargets = Effect.fnUntraced(function*(list: ReadonlyArray<InspectorSocket.Target>) {
    const automation = list.find((target) => target.type === "Automation")
    if (automation !== undefined && automationTarget === undefined) {
      automationTarget = automation.id
      yield* socket.send({ _tag: "Setup", connection: connectionId, target: automation.id })
      yield* Deferred.succeed(automationReady, automation.id)
    }
    const pagesListed = list.filter((target) => target.type === "WebPage")
    if (!(yield* Deferred.isDone(firstList))) {
      for (const target of pagesListed) initial.add(target.id)
      yield* Deferred.succeed(firstList, pagesListed)
      return
    }
    for (const target of pagesListed) {
      if (announced.has(target.id) || anchors.has(target.id) || initial.has(target.id)) continue
      if (holdNext !== undefined) {
        // The anchor this process just opened
        anchors.add(target.id)
        yield* Deferred.succeed(holdNext, target.id)
        holdNext = undefined
        continue
      }
      yield* announce(target.id)
    }
    for (const [target, pageProxyId] of Array.from(announced)) {
      if (pagesListed.some((listed) => listed.id === target)) continue
      announced.delete(target)
      pages.destroyed(pageProxyId)
    }
  })

  const announce = Effect.fnUntraced(function*(target: bigint) {
    const pageProxyId = pageProxyIdOf(target)
    announced.set(target, pageProxyId)
    yield* socket.send({ _tag: "Setup", connection: connectionId, target })
    pages.created(
      pageProxyId,
      key,
      (message) => socket.send({ _tag: "SendMessageToBackend", connection: connectionId, target, message })
    )
  })

  // What the socket received, in order, then its loss, after its messages: the Automation session's end, and its
  // pages'. The default context's process is the connection's, whose pages end with it
  const lose = (reason: Transport.ConnectionLost) =>
    Effect.sync(() => {
      automationLink.lose(reason)
      if (index === 0) pages.lose(reason)
      else for (const pageProxyId of announced.values()) pages.destroyed(pageProxyId)
      announced.clear()
    }).pipe(Effect.andThen(Deferred.succeed(ended, reason)))
  yield* socket.messages.pipe(
    Stream.runForEach((message) =>
      Effect.gen(function*() {
        switch (message._tag) {
          case "DidStartAutomationSession":
            return yield* Deferred.succeed(started, message)
          case "SetTargetList":
            connectionId = message.connection
            return yield* onTargets(message.targets)
          case "SendMessageToFrontend": {
            if (message.target === automationTarget) return automationLink.receive(message.message)
            const pageProxyId = announced.get(message.target)
            if (pageProxyId !== undefined) pages.message(pageProxyId, message.message)
            return
          }
          case "DidClose":
            return
        }
      })
    ),
    Effect.matchEffect({ onFailure: (error) => lose(lossOf(error)), onSuccess: () => lose(scopeClosed()) }),
    Effect.onInterrupt(() => lose(scopeClosed())),
    Effect.forkScoped
  )

  yield* socket.send({
    _tag: "StartAutomationSession",
    sessionId: crypto.randomUUID(),
    capabilities: options.acceptInsecureCerts === true
      ? [["acceptInsecureCerts", { type: "b", value: true }]]
      : []
  }).pipe(
    Effect.catch((error) => Launch.refused(error.message))
  )
  const browser = yield* waitFor(started, "The browser didn't start a session")
  const target = yield* waitFor(automationReady, "The browser didn't list its session")
  const automationTransport: Transport.Transport = {
    send: (text) => socket.send({ _tag: "SendMessageToBackend", connection: connectionId, target, message: text }),
    messages: automationLink.messages,
    closed: automationLink.closed
  }
  const client = yield* ProtocolClient.make(
    settings.wrapAutomation === undefined ? automationTransport : settings.wrapAutomation(automationTransport),
    WebKitWire.wire
  )
  const run = <A>(effect: Effect.Effect<A, Protocol.ProtocolError, never>) =>
    effect.pipe(Effect.catch((error) => Launch.refused(`The browser's session refused: ${error.message}`)))

  // The first window: the default context's first tab, or this context's anchor
  const first = yield* waitFor(firstList, "The browser didn't list its first page")
  // The first window has loaded nothing, and the first `createBrowsingContext` takes it rather than open one
  // (MiniBrowser's `browser_window_get_or_create_web_view_for_automation`; QUIRKS.md, Q213): it's claimed first
  const claimed = (yield* run(Automation.createBrowsingContext({}).pipe(Protocol.on(client.root)))).handle
  let anchor: Automation.BrowsingContextHandle
  if (index === 0) {
    // The default context's first window is the browser's first tab, and the anchor is a window more
    for (const page of first) {
      initial.delete(page.id)
      yield* announce(page.id).pipe(Effect.catch((error) => Launch.refused(error.message)))
    }
    const opened = yield* Deferred.make<bigint>()
    holdNext = opened
    anchor = (yield* run(Automation.createBrowsingContext({}).pipe(Protocol.on(client.root)))).handle
    yield* waitFor(opened, "The browser didn't list its anchor")
  } else {
    for (const page of first) {
      initial.delete(page.id)
      anchors.add(page.id)
    }
    anchor = claimed
  }
  yield* run(Automation.hideWindowOfBrowsingContext({ handle: anchor }).pipe(Protocol.on(client.root)))
    .pipe(Effect.ignore)

  return {
    key,
    kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore),
    closed: Deferred.await(ended),
    browserName: browser.browserName,
    browserVersion: browser.browserVersion,
    automation: client.root,
    anchor
  } satisfies Omit<Process, "close">
})

// ── The group ─────────────────────────────────────────────────────────────────────────────────────────────

/** Starts the default context's browser, and the transport of every process's pages, for the scope. */
export const start: (
  settings: Settings
) => Effect.Effect<
  Group,
  Launch.LaunchError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | SocketConnector.SocketConnector
> = Effect.fnUntraced(function*(settings: Settings) {
  if (settings.headless === true) {
    return yield* Launch.invalidInput({
      input: "headless",
      expected: "false: WebKitGTK has no headless mode",
      hint: "Its window opens where DISPLAY or WAYLAND_DISPLAY says; give it one, such as Xvfb's"
    }, "check the options")
  }
  const scope = yield* Effect.scope
  const context = yield* Effect.context<
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | SocketConnector.SocketConnector
  >()
  // The pages open are announced as `Envelope.enable` asks: each process announces its own as it starts
  const pages = yield* Envelope.makeEndpoint(Effect.void)
  const processes = new Map<string, Process>()
  let next = 0
  const launch = Effect.fnUntraced(function*(options: ProcessOptions, key?: string) {
    const index = next++
    const own = yield* Scope.fork(scope)
    const startup = new Startup(Option.getOrUndefined(yield* Operation.current))
    const started = yield* startProcess(settings, key ?? `context-${index}`, index, options, pages, startup).pipe(
      Effect.mapError((error) => startup.failure(error)),
      Scope.provide(own),
      Effect.provide(context),
      Effect.onError(() => Scope.close(own, Exit.void))
    )
    const process: Process = {
      ...started,
      close: Effect.suspend(() => {
        processes.delete(started.key)
        return Scope.close(own, Exit.void)
      })
    }
    processes.set(process.key, process)
    return process
  })
  // The connection lives as long as the default context's browser
  const first = yield* launch({}, "default")
  yield* Effect.addFinalizer(() => Effect.sync(() => pages.lose(scopeClosed())))
  return {
    transport: pages.transport,
    first,
    launch: (options) => launch(options),
    process: (key) => processes.get(key)
  } satisfies Group
})
