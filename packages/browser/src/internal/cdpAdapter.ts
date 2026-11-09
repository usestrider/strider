/**
 * The CDP backend adapter (PROTOCOL.md, Backend adapters). It keeps the correlation tables from CDP's ids to L1's,
 * folds CDP's events into facts, configures every new target before its scripts run, and carries out L1's
 * operations.
 *
 * It is built on the adapter kit (`adapterKit.ts`): its state is one object (`cdpAdapter/state.ts`), and each part
 * of it a module that takes the state: targets and their gate (`targets.ts`), frames and navigations
 * (`navigation.ts`), realms and evaluation (`evaluation.ts`), the network and its bodies (`network.ts`),
 * obligations (`obligations.ts`), input (`input.ts`), declarations (`declare.ts`), contexts, pages and downloads
 * (`contexts.ts`), cookies and permissions (`storage.ts`), and captures (`capture.ts`). This module connects them.
 *
 * - **Facts** follow what CDP does: realms are created after commit, the initial `about:blank` realm survives into
 *   the first same-origin document, children of a replaced document end without a CDP event, and navigation
 *   outcomes are reported only on affirmative evidence.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Browser from "../Browser.ts"
import * as BrowserCdp from "../cdp/Browser.ts"
import * as Target from "../cdp/Target.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Transport from "../protocol/Transport.ts"
import * as VideoWriter from "../VideoWriter.ts"
import type * as Adapter from "./adapter.ts"
import * as Kit from "./adapterKit.ts"
import * as Capture from "./cdpAdapter/capture.ts"
import * as Claims from "./cdpAdapter/claims.ts"
import * as Contexts from "./cdpAdapter/contexts.ts"
import * as Declare from "./cdpAdapter/declare.ts"
import * as Evaluation from "./cdpAdapter/evaluation.ts"
import * as Input from "./cdpAdapter/input.ts"
import * as Navigation from "./cdpAdapter/navigation.ts"
import * as Network from "./cdpAdapter/network.ts"
import * as Obligations from "./cdpAdapter/obligations.ts"
import * as Responses from "./cdpAdapter/responses.ts"
import * as State from "./cdpAdapter/state.ts"
import * as Storage from "./cdpAdapter/storage.ts"
import * as Targets from "./cdpAdapter/targets.ts"
import * as WebAuthn from "./cdpAdapter/webauthn.ts"
import * as CdpWire from "./cdpWire.ts"
import * as Launch from "./launch.ts"
import * as ProtocolClient from "./protocolClient.ts"

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The backend's capabilities, for a browser it connected to; the documentation tools read them too. `headless` is
 * read from the browser's user agent, `HeadlessChrome`: headless Chromium's product name no longer says so.
 */
export const capabilities = (
  info: Browser.Info,
  ownership: Adapter.ConnectOptions["ownership"],
  headless: boolean,
  videoWriter = false
) => {
  const evidence = `CDP adapter static profile, ${info.product}`
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("input.topLevelDesignMode", "supported"),
      entry("userContexts", "supported"),
      entry("userContexts.proxy", "supported", [
        "HTTP proxy endpoints for HTTP and HTTPS destinations; loopback stays direct"
      ]),
      entry("userContexts.proxy.credentials", "supported", [
        "proxy challenges only; one credential submission per request"
      ]),
      entry("isolatedWorlds", "supported"),
      entry("pauseOnStart.frames", "supported"),
      entry("pauseOnStart.workers", "supported"),
      entry("input.keyboardLayout", "supported"),
      entry("initScripts.workers", "supported", ["dedicated workers started after the script was declared"]),
      entry(
        "pauseOnStart.popups",
        ownership === "launched" ? "supported" : "unsupported",
        ownership === "launched"
          ? []
          : ["Chromium pauses popups only browser-wide, so an attached browser's popups aren't paused"]
      ),
      entry("input.native", "supported"),
      entry("interception.request", "supported"),
      entry("interception.response", "supported"),
      entry("interception.auth", "supported"),
      entry("network.challenges", "partial", [
        "a document's challenge only: a fetch's or a subresource's still waits on Chromium's prompt, since asking about it would pause every request"
      ]),
      entry("bodies", "supported"),
      entry("console", "supported"),
      entry("prompts", "supported"),
      entry("prompts.kind", "supported"),
      entry("navigation.sameDocument", "supported"),
      entry("navigation.traverse", "supported"),
      entry("frames.contentFrame", "supported"),
      entry("screenshot.format", "supported"),
      entry("storageState.partitioned", "supported"),
      entry("popups.opener", "supported"),
      entry("network.failure", "supported"),
      entry("network.headersSent", "supported"),
      entry("input.touch", "supported"),
      entry("close.runBeforeUnload", "supported"),
      entry("fileChooser", "supported"),
      entry("downloads", "supported"),
      entry("downloads.progress", "supported"),
      entry("downloads.cancel", "supported"),
      entry("screenshot", "supported"),
      entry(
        "pdf",
        headless ? "supported" : "unknown",
        headless ? [] : ["Chrome prints to PDF only when headless"]
      ),
      entry("evaluation.userActivation", "supported"),
      entry("input.insertText", "supported"),
      entry("input.pointerModifiers", "supported"),
      entry("input.dragAndDrop", "supported", ["Strider catches the drag Chromium starts, and finishes it"]),
      entry("webSocketFrames", "supported"),
      entry("networkConnections", "supported"),
      entry("networkConnections.eventSource", "supported"),
      entry("workers.shared", "supported"),
      entry("workers.service", "supported"),
      entry("workers.evaluate", "supported"),
      entry("exceptions.kind", "supported"),
      entry("network.servedBy", "supported", [
        "a script or stylesheet reused from the memory cache within one document produces no request"
      ]),
      entry("cookies", "supported"),
      entry("permissions", "supported"),
      entry("permissions.anyOrigin", "supported"),
      entry("interception.responseBody", "supported"),
      entry("interception.responseFulfill", "supported"),
      entry("interception.responseHeaders", "supported"),
      entry("interception.continueUrl", "supported"),
      entry("interception.abortReason", "supported"),
      entry("interception.redirects", "supported"),
      entry("emulation.viewport", "supported"),
      entry("emulation.viewport.mobile", "supported"),
      entry("emulation.userAgent", "supported"),
      entry("emulation.locale", "supported"),
      entry("emulation.timezone", "supported"),
      entry("emulation.geolocation", "supported"),
      entry("emulation.geolocation.unavailable", "supported"),
      entry("emulation.media", "supported"),
      entry("emulation.network.offline", "supported"),
      entry("emulation.network.throttling", "supported"),
      entry("emulation.cpuSlowdown", "supported"),
      entry("emulation.javaScript", "supported", ["a document already loaded keeps running its scripts"]),
      entry("emulation.extraHTTPHeaders", "supported"),
      entry("emulation.touch", "supported", ["touch event handlers appear at the next document"]),
      entry("emulation.focus", "supported"),
      entry("screenshot.cssScale", "supported"),
      entry("screenshot.omitBackground", "supported"),
      entry("pdf.headerFooter", "supported"),
      entry("pdf.preferCssPageSize", "supported"),
      entry("cookies.partitioned", "supported"),
      entry("snapshot.clickListeners", "unsupported", [
        "Strider doesn't read them yet: it would take a command per element"
      ]),
      entry("capability.virtualAuthenticator", "supported", [
        "Native Chromium WebAuthn, one scoped authenticator per page; credential copies keep separate counters"
      ]),
      entry("capability.axTree", "supported"),
      entry("capability.screencast", "supported"),
      entry(
        "capability.video",
        videoWriter ? "supported" : "unsupported",
        videoWriter ? [] : ["Chromium video requires a VideoWriter service"]
      )
    ]
  })
}

// ── The fold ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every event the fold handles, each with its handler. */
const handlers = Kit.handlers<State.Event>()
Targets.register(handlers)
Navigation.register(handlers)
Evaluation.register(handlers)
Network.register(handlers)
Obligations.register(handlers)
Input.register(handlers)
Contexts.register(handlers)

const fold = (state: State.State): ProtocolClient.Fold => ({
  events: handlers.events,
  apply: (session, method, params, received) =>
    Effect.suspend(() => {
      handlers.apply(method, params, {
        state,
        target: session.key === undefined ? undefined : state.targets.get(session)
      })
      for (const guard of state.captures) {
        const document = state.navigables.get(guard.page)?.document
        if (document !== undefined && document.id !== guard.document) guard.replaced(document.id, received)
      }
      return state.buffer.flush
    }),
  lost: (session) => Effect.sync(() => Targets.lost(state, session)),
  ended: (session, reason) =>
    Effect.suspend(() => {
      if (session.key === undefined) {
        for (const context of state.contexts.values()) context.proxy = undefined
        for (const target of state.targets.values()) target.proxyAuth?.clear()
      }
      Targets.ended(state, session, reason)
      return state.buffer.flush
    })
})

// ── Connecting ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Connects the CDP adapter over a transport. The connection lives as long as the scope.
 */
export const connect: (
  transport: Transport.Transport,
  options: Adapter.ConnectOptions
) => Effect.Effect<Adapter.AdapterConnection, Browser.BrowserError, Scope.Scope> = Effect.fnUntraced(
  function*(transport: Transport.Transport, options: Adapter.ConnectOptions) {
    const cleanupScope = yield* Effect.scope
    const buffer = yield* Kit.makeFactBuffer(options.sink)
    let state!: State.State
    let root!: ProtocolClient.Session
    const client = yield* ProtocolClient.make(transport, CdpWire.wire, {
      fold: (control) => {
        buffer.connect(control)
        state = State.make({
          cleanupScope,
          connect: options,
          ids: Kit.makeIds(),
          buffer,
          control,
          root: () => root,
          release: Responses.release
        })
        return fold(state)
      }
    })
    root = client.root
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const context of state.contexts.values()) context.proxy = undefined
        for (const target of state.targets.values()) target.proxyAuth?.clear()
      })
    )
    const failConnect = (error: Protocol.ProtocolError) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "handshake", hint: error.message }), "connect")
    const version = yield* BrowserCdp.getVersion().pipe(Protocol.on(root), Effect.catch(failConnect))
    state.defaultUserAgent = version.userAgent
    const info = new Browser.Info({
      product: version.product,
      version: version.product.split("/")[1] ?? version.product,
      protocol: "cdp",
      revision: version.protocolVersion
    })
    const contextIds = yield* Target.getBrowserContexts().pipe(Protocol.on(root), Effect.option)
    const defaultEntry: State.ContextEntry = {
      id: state.defaultContext,
      browserContextId: Option.isSome(contextIds) ? contextIds.value.defaultBrowserContextId : undefined,
      isDefault: true,
      removing: false
    }
    state.contexts.set(state.defaultContext, defaultEntry)
    if (defaultEntry.browserContextId !== undefined) {
      state.contextsByCdp.set(defaultEntry.browserContextId, defaultEntry)
    }
    yield* buffer.run(() => buffer.emit({ _tag: "UserContextAdded", context: state.defaultContext, isDefault: true }))
    yield* Declare.applyDownloads(state, defaultEntry).pipe(Effect.ignore)
    yield* Target.setAutoAttach({
      autoAttach: true,
      waitForDebuggerOnStart: options.ownership === "launched",
      flatten: true,
      filter: [
        { type: "page" },
        { type: "service_worker" },
        { type: "shared_worker" },
        { exclude: true }
      ]
    }).pipe(Protocol.on(root), Effect.catch(failConnect))
    // Targets that existed before are attached by now; from here on, new pages were created
    yield* root.drainObserved
    state.attachedAtConnect = false
    const writer = yield* Effect.serviceOption(VideoWriter.VideoWriter)
    const capabilitySet = yield* SubscriptionRef.make(
      capabilities(info, options.ownership, version.userAgent.includes("HeadlessChrome"), Option.isSome(writer))
    )

    return {
      ownership: options.ownership,
      claims: options.browserIdentity === undefined || options.claimClient === undefined
        ? undefined
        : Claims.make(state, options.browserIdentity, options.claimClient),
      info,
      capabilities: capabilitySet,
      pauseScope: options.ownership === "launched" ? "browser" : "related",
      defaultContext: state.defaultContext,
      closed: client.closed,
      createUserContext: (options) => Contexts.createUserContext(state, options),
      removeUserContext: (id) => Contexts.removeUserContext(state, id),
      createPage: (id) => Contexts.createPage(state, id),
      closePage: (id, options) => Contexts.closePage(state, id, options),
      activatePage: (id) => Contexts.activatePage(state, id),
      navigate: (id, url, options) => Navigation.navigate(state, id, url, options),
      reload: (id, options) => Navigation.reload(state, id, options),
      traverse: (id, delta) => Navigation.traverse(state, id, delta),
      realm: (document, world) => Evaluation.realm(state, document, world),
      evaluate: (realm, call) => Evaluation.evaluate(state, realm, call),
      releaseHandles: (list) => Evaluation.releaseHandles(state, list),
      dispatchInput: (page, events) => Input.dispatchInput(state, page, events),
      contentFrame: (node) => Input.contentFrame(state, node),
      setInputFiles: (node, files) => Input.setInputFiles(state, node, files),
      resolve: (obligation, decision) => Obligations.resolve(state, obligation, decision),
      pausedRequestBody: (obligation) => Obligations.pausedRequestBody(state, obligation),
      pausedResponseBody: (obligation) => Obligations.pausedResponseBody(state, obligation),
      declare: (scope, declaration) => Declare.declare(state, scope, declaration),
      captureGuard: { run: (page, effect) => Capture.guard(state, page, effect) },
      screenshot: (page, options) => Capture.screenshot(state, page, options),
      pdf: (page, options) => Capture.pdf(state, page, options),
      accessibilityTree: (page) => Capture.accessibilityTree(state, page),
      screencast: (page) => Capture.screencast(state, page),
      video: (page) => Capture.video(state, page, writer),
      createAuthenticator: (page) => WebAuthn.create(state, page),
      releaseAuthenticator: (ref) => WebAuthn.release(state, ref),
      authenticatorCredentials: (ref) => WebAuthn.credentials(state, ref),
      updateAuthenticator: (ref, update) => WebAuthn.update(state, ref, update),
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
