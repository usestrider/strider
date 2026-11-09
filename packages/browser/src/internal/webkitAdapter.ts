/**
 * The WebKit backend adapter, for stock WebKit (PROTOCOL.md, Backend adapters). It keeps the correlation tables from
 * WebKit's ids to L1's, folds WebKit's events into facts, configures every new target before its scripts run, and
 * carries out L1's operations. Attached, it looks through a browser's remote inspector (`webkitStockTransport.ts`);
 * launched, WebKit's Automation protocol drives it as well (`webkitAutomation.ts`).
 *
 * It is built on the adapter kit (`adapterKit.ts`): its state is one object (`webkitAdapter/state.ts`), and each
 * part of it a module that takes the state: pages, targets and their gate (`targets.ts`), frames, documents and how
 * they end (`tree.ts`), navigations (`navigation.ts`), realms and evaluation (`evaluation.ts`), the console
 * (`console.ts`), the network and its bodies (`network.ts`), obligations (`obligations.ts`), declarations
 * (`declare.ts`), screenshots (`capture.ts`), cookies (`storage.ts`), and what a launched browser's Automation
 * session does: contexts, pages, dialogs and the viewport (`automation.ts`), and input, frames and file inputs
 * (`input.ts`). Its capabilities are `capabilities.ts`'. This module connects them.
 */
import * as Cache from "effect/Cache"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Browser from "../Browser.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Transport from "../protocol/Transport.ts"
import type * as L1Target from "../Target.ts"
import * as VideoWriter from "../VideoWriter.ts"
import type * as Adapter from "./adapter.ts"
import * as Kit from "./adapterKit.ts"
import * as Declarations from "./declarations.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"
import * as Automation from "./webkitAdapter/automation.ts"
import * as Capabilities from "./webkitAdapter/capabilities.ts"
import * as Capture from "./webkitAdapter/capture.ts"
import * as Console from "./webkitAdapter/console.ts"
import * as Declare from "./webkitAdapter/declare.ts"
import * as Evaluation from "./webkitAdapter/evaluation.ts"
import * as Input from "./webkitAdapter/input.ts"
import * as Navigation from "./webkitAdapter/navigation.ts"
import * as Network from "./webkitAdapter/network.ts"
import * as Obligations from "./webkitAdapter/obligations.ts"
import * as State from "./webkitAdapter/state.ts"
import * as Storage from "./webkitAdapter/storage.ts"
import * as Targets from "./webkitAdapter/targets.ts"
import type * as WebKitAutomation from "./webkitAutomation.ts"
import * as Envelope from "./webkitEnvelope.ts"
import type * as WebKitVideo from "./webkitVideo.ts"
import * as WebKitWire from "./webkitWire.ts"

export { attachedCapabilities, launchedCapabilities } from "./webkitAdapter/capabilities.ts"

// ── The fold ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every event the fold handles, each with its handler. */
const handlers = Kit.handlers<State.Event>()
Targets.register(handlers)
Navigation.register(handlers)
Evaluation.register(handlers)
Console.register(handlers)
Network.register(handlers)
Obligations.register(handlers)

const fold = (state: State.State): ProtocolClient.Fold => ({
  events: handlers.events,
  apply: (session, method, params) =>
    Effect.suspend(() => {
      handlers.apply(method, params, State.eventOf(state, session))
      return state.buffer.flush
    }),
  lost: (session) => Effect.sync(() => Targets.lost(state, session)),
  ended: (session, reason) =>
    Effect.suspend(() => {
      Targets.ended(state, session, reason)
      return state.buffer.flush
    })
})

// ── Connecting ────────────────────────────────────────────────────────────────────────────────────────────

export interface Options extends Adapter.ConnectOptions {
  readonly video?: WebKitVideo.Settings | undefined
  /** The browser's version, where the transport knows it: an attached browser's inspector doesn't say. */
  readonly revision?: string | undefined
  /**
   * Stock WebKit launched in automation mode: its browser processes, a context's each, whose Automation
   * sessions make and drive pages. Without it, the adapter is attached through the remote inspector, and only looks.
   */
  readonly automation?: WebKitAutomation.Group | undefined
}

const refuse = (capability: string, hint: string) => () => Effect.fail(Kit.unsupported(capability, hint))

const noPages = "stock WebKit's inspector makes no contexts or pages, and closes none"

/**
 * Connects the WebKit adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: Options
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(transport: Transport.Transport, options: Options) {
    // Launched, the session names the browser; attached, the inspector server says nothing of it, and has no
    // session of its own to ask (QUIRKS.md, Q203)
    const info = options.automation !== undefined
      ? new Browser.Info({
        product: `${options.automation.first.browserName} (stock WebKit)`,
        version: options.automation.first.browserVersion,
        protocol: "webkit",
        revision: `webkitgtk-${options.automation.first.browserVersion}`
      })
      : new Browser.Info({
        product: "WebKit (stock)",
        version: options.revision ?? "unknown",
        protocol: "webkit",
        revision: options.revision ?? "unknown"
      })
    const writer = yield* Effect.serviceOption(VideoWriter.VideoWriter)
    const video = options.video !== undefined && Option.isSome(writer)
    const capabilities = yield* SubscriptionRef.make(
      options.automation !== undefined
        ? Capabilities.launchedCapabilities(info, video)
        : Capabilities.attachedCapabilities(info, video)
    )
    const buffer = yield* Kit.makeFactBuffer(options.sink)
    let state!: State.State
    let root!: ProtocolClient.Session
    const helpers = yield* Cache.makeWith(
      (id: L1Target.RealmId) => Evaluation.installHelper(state, id),
      { capacity: Evaluation.madeCapacity, timeToLive: Evaluation.keepMade }
    )
    const anchors = yield* Cache.makeWith(
      (key: string) => Evaluation.makeAnchor(state, key),
      { capacity: Evaluation.madeCapacity, timeToLive: Evaluation.keepMade }
    )
    const pairing = yield* Semaphore.make(1)
    const client = yield* ProtocolClient.make(transport, WebKitWire.wire, {
      fold: (control) => {
        buffer.connect(control)
        state = State.make({
          connect: options,
          ids: Kit.makeIds(),
          buffer,
          control,
          root: () => root,
          capabilities,
          helpers,
          anchors,
          pairing,
          automation: options.automation
        })
        return fold(state)
      }
    })
    root = client.root
    yield* buffer.run(() => buffer.emit({ _tag: "UserContextAdded", context: state.defaultContext, isDefault: true }))
    // Pages that existed before are announced before the reply, and adopted
    yield* Envelope.enable().pipe(
      Protocol.on(root),
      Effect.catch((error) =>
        Launch.fail(new Browser.ConnectionFailed({ stage: "handshake", hint: error.message }), "connect")
      )
    )
    yield* root.drainObserved
    state.attachedAtConnect = false

    const attached = {
      ownership: "attached" as const,
      info,
      capabilities,
      pauseScope: "browser",
      defaultContext: state.defaultContext,
      closed: client.closed,
      createUserContext: refuse("userContexts", noPages),
      removeUserContext: refuse("userContexts", noPages),
      createPage: refuse("userContexts", noPages),
      closePage: refuse("userContexts", noPages),
      viewportSize: (id) =>
        Effect.map(State.pageOf(state, id), (page) => Declarations.viewportSize(state.registry, State.placement(page))),
      activatePage: refuse("emulation.focus", "stock WebKit's inspector has no Emulation domain"),
      navigate: (id, url, options) => Navigation.navigateByScript(state, id, url, options),
      reload: (id, options) => Navigation.reload(state, id, options),
      traverse: refuse(
        "navigation.traverse",
        "stock WebKit's inspector reports a traversal under the old document's URL, with no realm (QUIRKS.md, Q215)"
      ),
      realm: (document, world) => Evaluation.realmFor(state, document, world),
      evaluate: (realm, call) => Evaluation.evaluate(state, realm, call),
      releaseHandles: (list) => Evaluation.releaseHandles(state, list),
      dispatchInput: refuse("input.native", "stock WebKit's inspector protocol has no Input domain"),
      resolve: (obligation, decision) => Obligations.resolve(state, obligation, decision),
      declare: (scope, declaration) => Declare.declare(state, scope, declaration),
      screenshot: (page, options) => Capture.screenshot(state, page, options),
      pdf: refuse("pdf", "WebKit has no print-to-PDF"),
      accessibilityTree: refuse("capability.axTree", "WebKit reads accessibility one node at a time"),
      screencast: refuse("capability.screencast", "stock WebKit's inspector has no Screencast domain"),
      video: (id) => Capture.video(state, id, options.video, writer),
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
      cookies: (context) => Storage.cookiesAttached(state, context),
      setCookies: (context, list) => Storage.setCookiesAttached(state, context, list),
      clearCookies: (context) => Storage.clearCookiesAttached(state, context),
      grantPermissions: refuse("permissions", "stock WebKit's inspector has no Emulation domain"),
      resetPermissions: refuse("permissions", "stock WebKit's inspector has no Emulation domain"),
      responseBody: (hop) => Network.responseBody(state, hop),
      contentFrame: refuse("frames.contentFrame", "stock WebKit's inspector can't say which frame an iframe holds"),
      captureRequestBody: (request, limit) => Network.captureRequestBody(state, request, limit),
      requestBody: (hop) => Network.requestBody(state, hop),
      pausedRequestBody: (obligation) => Obligations.pausedRequestBody(state, obligation),
      pausedResponseBody: (obligation) => Obligations.pausedResponseBody(state, obligation),
      setInputFiles: refuse("fileChooser", "stock WebKit's inspector can't set a file input's files"),
      downloadPath: refuse("downloads", "stock WebKit's inspector reports no downloads"),
      cancelDownload: refuse("downloads.cancel", "stock WebKit's inspector reports no downloads")
    } satisfies Adapter.AdapterConnection
    if (options.automation === undefined) return attached
    return {
      ...attached,
      ownership: "launched",
      createUserContext: (options) => Automation.createUserContextLaunched(state, options),
      removeUserContext: (id) => Automation.removeUserContextLaunched(state, id),
      createPage: (id) => Automation.createPageLaunched(state, id),
      closePage: (id, options) => Automation.closePageLaunched(state, id, options),
      activatePage: (id) => Automation.activatePageLaunched(state, id),
      navigate: (id, url, options) => Automation.navigateLaunched(state, id, url, options),
      dispatchInput: (page, events) => Input.dispatchInputLaunched(state, page, events),
      cookies: (context) => Storage.cookiesLaunched(state, context),
      setCookies: (context, list) => Storage.setCookiesLaunched(state, context, list),
      clearCookies: (context) => Storage.clearCookiesLaunched(state, context),
      setInputFiles: (node, files) => Input.setInputFilesLaunched(state, node, files),
      contentFrame: (node) => Input.contentFrameLaunched(state, node)
    } satisfies Adapter.AdapterConnection
  }
)
