/**
 * Stock WebKit launched in automation mode (review 23, candidates 3, 4 and 6): a browser process for each context,
 * each reached through its inspector server's socket (`webkitInspectorSocket.ts`), as WebKit's own WebDriver
 * reaches it.
 *
 * - **A process per context.** An automation session has one profile, ephemeral. The first process is the default
 *   context; `launch` starts another for each context made, and `close` ends it.
 * - **Each process's Automation session** is a protocol client of its own over the session's target: its root
 *   session takes the generated `Automation` commands.
 * - **Each process's pages** are the inspector's `WebPage` targets on the same socket, presented to the WebKit
 *   adapter on one transport in Playwright's envelope, as `webkitStockTransport.ts` presents an attached
 *   browser's: a page proxy's id is the process's and the target's, its context the process's, and its ids are
 *   qualified as that transport qualifies them (QUIRKS.md, Q195).
 * - **An anchor.** A browser exits when its last window closes (QUIRKS.md, Q213), so each process keeps a window of its own,
 *   minimized and never announced: a context's process keeps its first window; the default context's announces its
 *   first window as the browser's first tab, as every backend does (Q141), and opens one more.
 * - **The port.** A browser told a port that's taken keeps running without its server, saying so on stderr; the
 *   launch tries another.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Queue from "effect/Queue"
import * as Random from "effect/Random"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Browser from "../Browser.ts"
import type * as Protocol from "../protocol/Protocol.ts"
import * as Protocols from "../protocol/Protocol.ts"
import * as SocketConnector from "../protocol/SocketConnector.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Reason from "../Reason.ts"
import * as Automation from "../webkit-automation-protocol/Automation.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as InspectorSocket from "./webkitInspectorSocket.ts"
import * as WebKitStockTransport from "./webkitStockTransport.ts"
import * as WebKitWire from "./webkitWire.ts"

/**
 * How a browser takes automation mode, by its executable's name; `None` for one this doesn't launch. WebKitGTK's
 * and WPE's MiniBrowser only: GNOME Web's automation mode opens no second page, and aborts as one closes (review 23,
 * decision 3; QUIRKS.md, Q217).
 */
export const automationArguments = (executablePath: string): Option.Option<ReadonlyArray<string>> =>
  executablePath.split(/[\\/]/).at(-1) === "MiniBrowser" ? Option.some(["--automation"]) : Option.none()

/** What a launch takes. */
export interface Settings {
  readonly executablePath: string
  readonly headless?: boolean | undefined
  readonly args?: ReadonlyArray<string> | undefined
  readonly userDataDir?: string | undefined
}

/** What a context's process is started with. */
export interface ProcessOptions {
  /** The time zone, which a WebKitGTK browser takes at launch (`--time-zone`). */
  readonly timeZone?: string | undefined
  /** Whether the session accepts certificates it can't verify, a capability of the session. */
  readonly acceptInsecureCerts?: boolean | undefined
}

/** A context's browser process, and its Automation session. */
export interface Process {
  /** Why its connection ended, once it has. */
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
}

/** The browser processes of one connection, and the transport of their pages. */
export interface Group {
  /** Every process's pages, for the WebKit adapter, in Playwright's envelope. */
  readonly transport: Transport.Transport
  /** The default context's process. */
  readonly first: Process
  /** A process for a new context. */
  readonly launch: (options: ProcessOptions) => Effect.Effect<Process, Browser.BrowserError>
  /** A context's process, by its key. */
  readonly process: (key: string) => Process | undefined
}

const portRange = [49152, 65535] as const

/** Every process's pages on one transport, and the announcements the adapter reads from it. */
const makePages = Effect.fnUntraced(function*() {
  const incoming = yield* Queue.unbounded<string>()
  const lost = Deferred.makeUnsafe<Transport.ConnectionLost>()
  const deliver = (message: Record<string, unknown>) => Queue.offerUnsafe(incoming, JSON.stringify(message))
  // Each page proxy's way to its target, by its id
  const routes = new Map<string, (message: string) => Effect.Effect<void, Transport.TransportError>>()
  let enabled = false
  const held: Array<Record<string, unknown>> = []
  const announce = (message: Record<string, unknown>) => {
    if (enabled) deliver(message)
    else held.push(message)
  }
  const answering = new Map<string, string>()
  const transport: Transport.Transport = {
    send: (text) =>
      Effect.suspend(() => {
        const message = JSON.parse(text) as Record<string, unknown>
        const { pageProxyId, ...rest } = message
        if (typeof pageProxyId !== "string") {
          if (message.method === "Playwright.enable") {
            // The pages open now are announced before the reply, as Playwright's build does
            enabled = true
            for (const each of held.splice(0)) deliver(each)
            deliver({ id: message.id, result: {} })
          } else {
            deliver({ id: message.id, error: { code: -32601, message: `'${String(message.method)}' was not found` } })
          }
          return Effect.void
        }
        const route = routes.get(pageProxyId)
        if (route === undefined) {
          deliver({
            id: message.id,
            pageProxyId,
            error: { code: -32602, message: "Cannot find page proxy with provided 'pageProxyId'" }
          })
          return Effect.void
        }
        return route(
          JSON.stringify(
            WebKitStockTransport.unqualifyOutgoing(rest as Record<string, unknown>, pageProxyId, answering)
          )
        )
      }),
    messages: Stream.fromQueue(incoming).pipe(Stream.interruptWhen(Deferred.await(lost))),
    closed: Deferred.await(lost)
  }
  return {
    transport,
    lost,
    created: (
      pageProxyId: string,
      browserContextId: string,
      route: (message: string) => Effect.Effect<void, Transport.TransportError>
    ) => {
      routes.set(pageProxyId, route)
      announce({ method: "Playwright.pageProxyCreated", params: { pageProxyId, browserContextId } })
    },
    destroyed: (pageProxyId: string) => {
      if (!routes.delete(pageProxyId)) return
      announce({ method: "Playwright.pageProxyDestroyed", params: { pageProxyId } })
    },
    message: (pageProxyId: string, text: string) =>
      announce({
        ...WebKitStockTransport.qualifyIncoming(JSON.parse(text) as Record<string, unknown>, pageProxyId, answering),
        pageProxyId
      })
  }
})

type Pages = Effect.Success<ReturnType<typeof makePages>>

const refused = (hint: string) => Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint }), "connect")

/** Starts one browser in automation mode, on a free port, and its session, for the scope. */
const startProcess = Effect.fnUntraced(function*(
  settings: Settings,
  key: string,
  index: number,
  options: ProcessOptions,
  pages: Pages
) {
  const connector = yield* SocketConnector.SocketConnector
  const path = yield* Launch.executable(settings.executablePath)
  const automationArgs = automationArguments(path)
  if (Option.isNone(automationArgs)) {
    return yield* Launch.fail(
      new Reason.InvalidInput({
        input: "executablePath",
        expected: "WebKitGTK's or WPE's MiniBrowser, which this launches in automation mode",
        hint: `${path} isn't one this launches in automation mode`
      }),
      "check the executable"
    )
  }
  const directory = yield* Launch.profileDirectory(index === 0 ? settings.userDataDir : undefined, "strider-webkit-")
  const args = [
    ...automationArgs.value,
    ...(options.timeZone === undefined ? [] : [`--time-zone=${options.timeZone}`]),
    ...(settings.args ?? [])
  ]
  // A port nothing listens on, tried until the browser starts its server there: one that's taken, it says so on
  // stderr, and keeps running without it (QUIRKS.md, Q216)
  let connection: SocketConnector.Connection | undefined
  let launched: Launch.Launched | undefined
  for (let attempt = 0; attempt < 5 && connection === undefined; attempt++) {
    const port = yield* Random.nextIntBetween(portRange[0], portRange[1])
    const own = yield* Scope.fork(yield* Effect.scope)
    const process = yield* Launch.spawn(path, args, directory, {
      env: {
        WEBKIT_INSPECTOR_SERVER: `127.0.0.1:${port}`,
        XDG_DATA_HOME: `${directory}/data`,
        XDG_CACHE_HOME: `${directory}/cache`,
        XDG_CONFIG_HOME: `${directory}/config`
      }
    }).pipe(Scope.provide(own))
    const outcome = yield* Effect.raceFirst(
      Effect.gen(function*() {
        for (let tries = 0; tries < 100; tries++) {
          const opened = yield* connector.connect({ host: "127.0.0.1", port }).pipe(Scope.provide(own), Effect.option)
          if (Option.isSome(opened)) return { _tag: "Connected" as const, connection: opened.value }
          yield* Effect.sleep("100 millis")
        }
        return { _tag: "Silent" as const }
      }),
      process.stderrLine(new RegExp(`Failed to start remote inspector server on 127\\.0\\.0\\.1:${port}`)).pipe(
        Effect.map((line) => Option.isSome(line) ? { _tag: "Taken" as const } : { _tag: "Exited" as const })
      )
    )
    if (outcome._tag === "Connected") {
      connection = outcome.connection
      launched = process
    } else if (outcome._tag === "Taken") {
      yield* Scope.close(own, Exit.void)
    } else {
      return yield* Launch.notReady(process, `Its inspector server on port ${port} never answered`)
    }
  }
  if (connection === undefined || launched === undefined) {
    return yield* refused("Five ports in a row were taken, so the browser's inspector server never started")
  }

  // The session
  const socket = yield* InspectorSocket.connect(connection)
  const started = yield* Deferred.make<{ readonly browserName: string; readonly browserVersion: string }>()
  const automationReady = yield* Deferred.make<bigint>()
  const firstList = yield* Deferred.make<ReadonlyArray<InspectorSocket.Target>>()
  const automationIncoming = yield* Queue.unbounded<string>()
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
            if (message.target === automationTarget) return Queue.offerUnsafe(automationIncoming, message.message)
            const pageProxyId = announced.get(message.target)
            if (pageProxyId !== undefined) pages.message(pageProxyId, message.message)
            return
          }
          case "DidClose":
            return
        }
      })
    ),
    Effect.ignore,
    Effect.ensuring(Effect.sync(() => {
      for (const pageProxyId of announced.values()) pages.destroyed(pageProxyId)
      announced.clear()
    })),
    Effect.forkScoped
  )

  yield* socket.send({
    _tag: "StartAutomationSession",
    sessionId: crypto.randomUUID(),
    capabilities: options.acceptInsecureCerts === true
      ? [["acceptInsecureCerts", { type: "b", value: true }]]
      : []
  }).pipe(
    Effect.catch((error) => refused(error.message))
  )
  const browser = yield* Deferred.await(started).pipe(
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => refused("The browser never started a session") })
  )
  const target = yield* Deferred.await(automationReady).pipe(
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => refused("The browser never listed its session") })
  )
  const client = yield* ProtocolClient.make(
    {
      send: (text) => socket.send({ _tag: "SendMessageToBackend", connection: connectionId, target, message: text }),
      messages: Stream.fromQueue(automationIncoming).pipe(Stream.interruptWhen(socket.closed)),
      closed: socket.closed
    },
    WebKitWire.wire
  )
  const run = <A>(effect: Effect.Effect<A, Protocols.ProtocolError, never>) =>
    effect.pipe(Effect.catch((error) => refused(`The browser's session refused: ${error.message}`)))

  // The first window: the default context's first tab, or this context's anchor
  const first = yield* Deferred.await(firstList).pipe(
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => refused("The browser never listed its first page") })
  )
  // The first window has loaded nothing, and the first `createBrowsingContext` takes it rather than open one
  // (MiniBrowser's `browser_window_get_or_create_web_view_for_automation`; QUIRKS.md, Q213): it's claimed first
  const claimed = (yield* run(Automation.createBrowsingContext({}).pipe(Protocols.on(client.root)))).handle
  let anchor: Automation.BrowsingContextHandle
  if (index === 0) {
    // The default context's first window is the browser's first tab, and the anchor is a window more
    for (const page of first) {
      initial.delete(page.id)
      yield* announce(page.id).pipe(Effect.catch((error) => refused(error.message)))
    }
    const opened = yield* Deferred.make<bigint>()
    holdNext = opened
    anchor = (yield* run(Automation.createBrowsingContext({}).pipe(Protocols.on(client.root)))).handle
    yield* Deferred.await(opened).pipe(
      Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => refused("The browser never listed its anchor") })
    )
  } else {
    for (const page of first) {
      initial.delete(page.id)
      anchors.add(page.id)
    }
    anchor = claimed
  }
  yield* run(Automation.hideWindowOfBrowsingContext({ handle: anchor }).pipe(Protocols.on(client.root)))
    .pipe(Effect.ignore)

  return {
    key,
    closed: socket.closed,
    browserName: browser.browserName,
    browserVersion: browser.browserVersion,
    automation: client.root,
    anchor
  } satisfies Omit<Process, "close">
})

/** Starts the default context's browser, and the transport of every process's pages, for the scope. */
export const start: (
  settings: Settings
) => Effect.Effect<
  Group,
  Browser.BrowserError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | SocketConnector.SocketConnector
> = Effect.fnUntraced(function*(settings: Settings) {
  if (settings.headless === true) {
    return yield* Launch.fail(
      new Reason.InvalidInput({
        input: "headless",
        expected: "false: WebKitGTK has no headless mode",
        hint: "Its window opens where DISPLAY or WAYLAND_DISPLAY says; give it one, such as Xvfb's"
      }),
      "check the options"
    )
  }
  const scope = yield* Effect.scope
  const context = yield* Effect.context<
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | SocketConnector.SocketConnector
  >()
  const pages = yield* makePages()
  const processes = new Map<string, Process>()
  let next = 0
  const launch = Effect.fnUntraced(function*(options: ProcessOptions, key?: string) {
    const index = next++
    const own = yield* Scope.fork(scope)
    const started = yield* startProcess(settings, key ?? `context-${index}`, index, options, pages).pipe(
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
  const first = yield* launch({}, "default")
  // The connection lives as long as the default context's browser
  yield* Effect.forkIn(Effect.flatMap(first.closed, (lost) => Deferred.succeed(pages.lost, lost)), scope)
  yield* Effect.addFinalizer(() =>
    Deferred.succeed(pages.lost, new Transport.ConnectionLost({ initiator: "local", description: "The scope closed" }))
  )
  return {
    transport: pages.transport,
    first,
    launch: (options) => launch(options),
    process: (key) => processes.get(key)
  } satisfies Group
})
