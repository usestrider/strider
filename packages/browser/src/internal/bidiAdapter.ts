/**
 * The WebDriver BiDi backend adapter (PROTOCOL.md, Backend adapters), for Firefox and any BiDi
 * endpoint. It keeps the tables from BiDi's ids to L1's, folds BiDi's events into facts, and carries out L1's
 * operations.
 *
 * It is built on the adapter kit (`adapterKit.ts`): its state is one object (`bidiAdapter/state.ts`), and each part
 * of it a module that takes the state: the navigable tree (`tree.ts`), navigations (`navigation.ts`), realms and
 * evaluation (`evaluation.ts`), the network and its bodies (`network.ts`), obligations (`obligations.ts`), input
 * (`input.ts`), declarations (`declare.ts`), contexts, pages and downloads (`contexts.ts`), cookies and
 * permissions (`storage.ts`), and captures (`capture.ts`). This module connects them.
 *
 * - **One session.** Every event arrives on the connection's one session; the fold routes it by the context
 *   in its parameters.
 * - **No pause.** BiDi scopes declarations natively, by context or user context, so a new context needs no
 *   pause: preload scripts and overrides registered for its user context apply before its scripts run.
 * - **Realms come before commits.** Firefox creates a new document's realm before `navigationCommitted`, after
 *   destroying the old one. A main-world realm created for a context whose document already had one belongs
 *   to the next commit, and is held until then; one destroyed first is never reported.
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as BrowsingContext from "../bidi-protocol/BrowsingContext.ts"
import * as Session from "../bidi-protocol/Session.ts"
import * as Browser from "../Browser.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Transport from "../protocol/Transport.ts"
import * as L1Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Kit from "./adapterKit.ts"
import * as Capture from "./bidiAdapter/capture.ts"
import * as Contexts from "./bidiAdapter/contexts.ts"
import * as Declare from "./bidiAdapter/declare.ts"
import * as Evaluation from "./bidiAdapter/evaluation.ts"
import * as Input from "./bidiAdapter/input.ts"
import * as Navigation from "./bidiAdapter/navigation.ts"
import * as Network from "./bidiAdapter/network.ts"
import * as Obligations from "./bidiAdapter/obligations.ts"
import * as State from "./bidiAdapter/state.ts"
import * as Storage from "./bidiAdapter/storage.ts"
import * as Tree from "./bidiAdapter/tree.ts"
import * as BidiWire from "./bidiWire.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

/** The backend's capabilities, for a browser it connected to; the documentation tools read them too. */
export const capabilities = (info: Browser.Info, ownership: Adapter.ConnectOptions["ownership"]) => {
  const evidence = `BiDi adapter static profile, ${info.product} ${info.version}`
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("input.topLevelDesignMode", "unsupported", [
        "Firefox cannot focus an input in a top-level design-mode document; native typing reaches the document body"
      ]),
      entry("userContexts", "supported"),
      entry("userContexts.proxy", "supported", [
        "HTTP proxy endpoints for HTTP and HTTPS destinations; loopback stays direct"
      ]),
      entry("userContexts.proxy.credentials", ownership === "launched" ? "partial" : "unsupported", [
        "requires a freshly launched browser; one credential pair per proxy endpoint for the connection lifetime"
      ]),
      entry("isolatedWorlds", "supported"),
      entry("pauseOnStart.frames", "supported", [
        "nothing is paused: WebDriver BiDi applies the context's scripts and settings to each new document itself"
      ]),
      entry("pauseOnStart.workers", "unsupported", ["preload scripts don't run in workers"]),
      entry("initScripts.workers", "unsupported", ["WebDriver BiDi's preload scripts run in documents only"]),
      entry("pauseOnStart.popups", "supported", [
        "nothing is paused: WebDriver BiDi applies the context's scripts and settings to each new popup itself"
      ]),
      entry("input.native", "unsupported", ["WebDriver actions, not native input"]),
      entry("input.webdriver", "supported"),
      entry("interception.request", "supported"),
      entry("interception.response", "supported"),
      entry("interception.auth", "supported"),
      entry("network.challenges", "supported"),
      entry("bodies", "supported", ["only with a body collection declared before the request"]),
      entry("console", "partial", [
        "a dedicated worker's messages are attributed to its page, and shared and service workers' aren't reported"
      ]),
      entry("prompts", "supported"),
      entry("prompts.kind", "supported"),
      entry("navigation.sameDocument", "supported"),
      entry("navigation.traverse", "supported"),
      entry("frames.contentFrame", "supported"),
      entry("screenshot.format", "supported"),
      entry("storageState.partitioned", "supported"),
      entry("popups.opener", "supported"),
      entry("network.failure", "partial", ["BiDi reports failure text without a cancellation flag"]),
      entry("network.headersSent", "supported"),
      entry("input.touch", "supported"),
      entry("close.runBeforeUnload", "supported"),
      entry(
        "fileChooser",
        "partial",
        ownership === "launched"
          ? ["the input gets a cancel event as the chooser opens, before any decision"]
          : [
            "an attached session leaves file choosers to the browser, since a session's prompt settings are the whole browser's and dismissing would cancel the user's own"
          ]
      ),
      entry("downloads", "supported"),
      entry("downloads.progress", "unsupported", ["WebDriver BiDi reports a download's start and end only"]),
      entry("downloads.cancel", "unsupported", ["WebDriver BiDi has no command to cancel a download"]),
      entry("screenshot", "supported"),
      entry("pdf", "supported"),
      entry("evaluation.userActivation", "supported"),
      entry("input.insertText", "partial", [
        "WebDriver BiDi has no command for it, so each character is typed as a key"
      ]),
      entry("input.pointerModifiers", "supported", ["modifiers are held as keys; a mouse event's flags are ignored"]),
      entry("input.keyboardLayout", "partial", [
        "WebDriver BiDi sends a key as its value: the code is Firefox's for that key on a US keyboard, and there is no AltGr or dead key"
      ]),
      entry("input.dragAndDrop", "unsupported", [
        "Firefox starts an HTML drag from WebDriver actions, and never drops it"
      ]),
      entry("webSocketFrames", "unsupported", ["WebDriver BiDi has no WebSocket frame events"]),
      entry("networkConnections", "unsupported", [
        "WebDriver BiDi reports a WebSocket's handshake as a request, and not its frames or its close"
      ]),
      entry("networkConnections.eventSource", "unsupported", ["WebDriver BiDi reports an EventSource as a request"]),
      entry("workers.shared", "unsupported", ["Firefox reports shared workers, but not whose context they are in"]),
      entry("workers.service", "unsupported", ["Firefox reports service workers, but not whose context they are in"]),
      entry("workers.evaluate", "unsupported", ["Firefox can't evaluate in a worker realm"]),
      entry("exceptions.kind", "partial", ["an unhandled rejection is reported as a throw, so its kind is unknown"]),
      entry("network.servedBy", "partial", [
        "a cache and a service worker look alike: both are cacheOrServiceWorker (Firefox's fromCache)"
      ]),
      entry("cookies", "supported"),
      entry("permissions", "supported", ["granted per origin; reset sets the ones granted here back to prompt"]),
      entry("permissions.anyOrigin", "unsupported", ["WebDriver BiDi grants a permission to one origin"]),
      entry("interception.responseBody", "unsupported", [
        "WebDriver BiDi has no body for a response paused as it starts"
      ]),
      entry("interception.responseFulfill", "unsupported", ["Firefox doesn't implement network.provideResponse there"]),
      entry("interception.responseHeaders", "supported"),
      entry("interception.continueUrl", "unsupported", ["Firefox aborts a request continued with a new URL"]),
      entry("interception.abortReason", "unsupported", ["WebDriver BiDi has one failure for every reason"]),
      entry("interception.redirects", "supported"),
      entry("emulation.viewport", "supported"),
      entry("emulation.viewport.mobile", "unsupported", ["WebDriver BiDi has no mobile viewport"]),
      entry("emulation.userAgent", "supported"),
      entry("emulation.locale", "supported"),
      entry("emulation.timezone", "supported"),
      entry("emulation.geolocation", "supported"),
      entry("emulation.geolocation.unavailable", "unsupported", ["Firefox rejects an unavailable position"]),
      entry("emulation.media", "unsupported", ["Firefox doesn't implement emulation.setMediaFeaturesOverride"]),
      entry("emulation.network.offline", "supported"),
      entry("emulation.network.throttling", "unsupported", ["WebDriver BiDi can only take a page offline"]),
      entry("emulation.cpuSlowdown", "unsupported", ["WebDriver BiDi has no CPU throttling"]),
      entry("emulation.javaScript", "unsupported", ["Firefox doesn't implement emulation.setScriptingEnabled"]),
      entry("emulation.extraHTTPHeaders", "supported"),
      entry("emulation.touch", "unsupported", ["Firefox doesn't implement emulation.setTouchOverride"]),
      entry("emulation.focus", "unsupported", ["WebDriver BiDi has no focus emulation"]),
      entry("screenshot.cssScale", "unsupported", ["WebDriver BiDi captures device pixels only"]),
      entry("screenshot.omitBackground", "unsupported", ["WebDriver BiDi has no background override"]),
      entry("pdf.headerFooter", "unsupported", ["WebDriver BiDi prints no header or footer"]),
      entry("pdf.preferCssPageSize", "unsupported", ["WebDriver BiDi prints at the size it is given"]),
      entry("cookies.partitioned", "unsupported", ["Firefox doesn't say which partition a cookie is in"]),
      entry("snapshot.clickListeners", "unsupported", ["WebDriver BiDi can't list event listeners"]),
      entry("capability.virtualAuthenticator", "unsupported", [
        "Firefox implements authenticators through classic WebDriver, not this BiDi transport"
      ]),
      entry("capability.axTree", "unsupported", ["WebDriver BiDi has no accessibility tree"]),
      entry("capability.screencast", "unsupported", [
        "Firefox's browsingContext.startScreencast records a WebM file on the browser's host, and streams no frames"
      ]),
      ownership === "launched"
        ? entry("capability.video", "supported", ["written where the page's context downloads to"])
        : entry("capability.video", "unsupported", [
          "Firefox writes the file on its own host, out of the program's reach"
        ])
    ]
  })
}
/** Settings for connecting the BiDi adapter. */
export interface ConnectOptions extends Adapter.ConnectOptions {
  /**
   * Whether to start a session with `session.new`, as a browser's `/session` endpoint needs, or use the one
   * the connection already has.
   *
   * @default "new"
   */
  readonly session?: "new" | "existing" | undefined
}

// ── The fold ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every event the fold handles, each with its handler. */
const handlers = Kit.handlers<State.Event>()
Contexts.register(handlers)
Navigation.register(handlers)
Evaluation.register(handlers)
Network.register(handlers)
Obligations.register(handlers)

/** A fresh tree of the browsing contexts, and how far the session's events had come when it was taken. */
const snapshot = (state: State.State) =>
  Effect.map(
    state.root().sendSequenced(BrowsingContext.getTree({})),
    ({ received, result }) => ({ tree: result, received })
  )

const fold = (state: State.State): ProtocolClient.Fold => ({
  events: handlers.events,
  apply: (_session, method, params) =>
    Effect.suspend(() => {
      handlers.apply(method, params, { state })
      return state.buffer.flush
    }),
  lost: (session) =>
    Effect.sync(() => {
      // Rebuild from a fresh tree: contexts that are gone end, new ones are adopted
      state.control.sync(
        session,
        Effect.map(snapshot(state), ({ received, tree }) => ({
          through: received,
          apply: Effect.suspend(() => {
            Tree.reconcile(state, tree)
            return state.buffer.flush
          })
        }))
      )
    }),
  ended: (_session, reason) =>
    Effect.suspend(() => {
      if (reason.why === "connectionLost") State.releaseProxy(state)
      if (reason.why === "connectionLost" || reason.why === "modelUnavailable") {
        const why: L1Target.CloseReason = reason.why === "connectionLost"
          ? Kit.closed()
          : new L1Target.ModelUnavailable({})
        for (const navigable of Array.from(state.navigables.values())) {
          if (navigable.parent === undefined) {
            Tree.removeNavigable(state, navigable, why, `bidi: the session ended (${reason.why})`)
          }
        }
      }
      return state.buffer.flush
    })
})

// ── Connecting ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Connects the BiDi adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: ConnectOptions
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(transport: Transport.Transport, options: ConnectOptions) {
    const buffer = yield* Kit.makeFactBuffer(options.sink)
    const cleanupScope = yield* Effect.scope
    let state!: State.State
    let root!: ProtocolClient.Session
    const client = yield* ProtocolClient.make(transport, BidiWire.wire, {
      fold: (control) => {
        buffer.connect(control)
        state = State.make({ cleanupScope, connect: options, ids: Kit.makeIds(), buffer, control, root: () => root })
        return fold(state)
      }
    })
    root = client.root
    yield* Effect.addFinalizer(() => Effect.sync(() => State.releaseProxy(state)))
    const on = Protocol.on(root)

    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(
        new Browser.ConnectionFailed({
          stage: "handshake",
          hint: error.message.includes("Maximum number of active sessions")
            ? `${error.message}: Firefox allows one WebDriver BiDi session at a time, and another client holds it; a session ends with session.end, not when its connection closes, or with the browser`
            : error.message
        }),
        "connect"
      )
    let product = "WebDriver BiDi"
    let version = ""
    if ((options.session ?? "new") === "new") {
      const created = yield* Session.new_({
        capabilities: {
          alwaysMatch: {
            // A session's prompt settings are the whole browser's: an attached one leaves the user's file choosers
            // alone
            unhandledPromptBehavior: {
              default: "ignore",
              file: options.ownership === "launched" ? "dismiss" : "ignore"
            }
          }
        }
      }).pipe(on, Effect.catch(failConnect))
      product = created.capabilities.browserName
      version = created.capabilities.browserVersion
      // Firefox keeps a session after its socket closes, and allows one: a session this connection started ends
      // with it, or every later client is refused until the browser restarts
      yield* Effect.addFinalizer(() =>
        Session.end().pipe(on, Effect.timeoutOption("1 second"), Effect.ignore, BrowserClock.onLive)
      )
    }
    const info = new Browser.Info({ product, version, protocol: "bidi", revision: version })
    // The default context is mapped before subscribing: Firefox reports the contexts that exist as the subscription
    // is answered, and a tab in `"default"` mapped before it would land in a context of its own
    yield* buffer.run(() => buffer.emit({ _tag: "UserContextAdded", context: state.defaultContext, isDefault: true }))
    yield* Session.subscribe({ events: ["browsingContext", "script", "network", "log", "input"] }).pipe(
      on,
      Effect.catch(failConnect)
    )
    const { tree } = yield* snapshot(state).pipe(Effect.catch(failConnect))
    yield* buffer.run(() => {
      Tree.reconcile(state, tree)
      state.adopting = false
    })
    const capabilitySet = yield* SubscriptionRef.make(capabilities(info, options.ownership))

    return {
      ownership: options.ownership,
      info,
      capabilities: capabilitySet,
      pauseScope: "context",
      defaultContext: state.defaultContext,
      closed: client.closed,
      createUserContext: (options) => Contexts.createUserContext(state, options),
      removeUserContext: (id) => Contexts.removeUserContext(state, id),
      createPage: (id) => Contexts.createPage(state, id),
      closePage: (id, options) => Contexts.closePage(state, id, options),
      viewportSize: (id) =>
        Effect.map(
          State.navigableById(state, id),
          (page) => Declarations.viewportSize(state.registry, State.placement(page))
        ),
      activatePage: (id) => Contexts.activatePage(state, id),
      navigate: (id, url, options) => Navigation.navigate(state, id, url, options),
      reload: (id, options) => Navigation.reload(state, id, options),
      traverse: (id, delta) => Navigation.traverse(state, id, delta),
      realm: (document, world) => Evaluation.realm(state, document, world),
      evaluate: (realm, call) => Evaluation.evaluate(state, realm, call),
      releaseHandles: (list) => Evaluation.releaseHandles(state, list),
      dispatchInput: (page, events, frame) => Input.dispatchInput(state, page, events, frame),
      contentFrame: (node) => Input.contentFrame(state, node),
      setInputFiles: (node, files) => Input.setInputFiles(state, node, files),
      resolve: (obligation, decision) => Obligations.resolve(state, obligation, decision),
      pausedRequestBody: (obligation) => Obligations.pausedRequestBody(state, obligation),
      pausedResponseBody: (obligation) => Obligations.pausedResponseBody(state, obligation),
      declare: (scope, declaration) => Declare.declare(state, scope, declaration),
      screenshot: (page, options) => Capture.screenshot(state, page, options),
      pdf: (page, options) => Capture.pdf(state, page, options),
      accessibilityTree: () =>
        Effect.fail(Kit.unsupported("capability.axTree", "WebDriver BiDi has no accessibility tree")),
      screencast: () =>
        Effect.fail(
          Kit.unsupported(
            "capability.screencast",
            "Firefox's browsingContext.startScreencast records a WebM file on the browser's host, and streams no frames"
          )
        ),
      video: (page) => Capture.video(state, page),
      createAuthenticator: () =>
        Effect.fail(
          Kit.unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP")
        ),
      releaseAuthenticator: () => Effect.void,
      authenticatorCredentials: () =>
        Effect.fail(
          Kit.unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP")
        ),
      updateAuthenticator: () =>
        Effect.fail(
          Kit.unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP")
        ),
      cookies: (context) => Storage.cookies(state, context),
      setCookies: (context, list) => Storage.setCookies(state, context, list),
      clearCookies: (context) => Storage.clearCookies(state, context),
      grantPermissions: (context, origin, permissions) => Storage.grantPermissions(state, context, origin, permissions),
      resetPermissions: (context) => Storage.resetPermissions(state, context),
      responseBody: (hop) => Network.responseBody(state, hop),
      requestBody: (hop) => Network.requestBody(state, hop),
      downloadPath: (download) => Contexts.downloadPath(state, download),
      cancelDownload: (download) => Contexts.cancelDownload(state, download)
    } satisfies Adapter.AdapterConnection
  }
)
