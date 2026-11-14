/**
 * `Browser.layerTest`: an adapter with no browser behind it, whose first page plays a
 * marble timeline. Its facts are folded by the same model as a real backend's, so events, waits and lifetimes
 * behave as they do with a browser; it has no DOM, so a request for the engine fails with `Unsupported`.
 *
 * The timeline runs on Effect's clock, so under `TestClock` it moves only as the test adjusts it:
 *
 * - `-` is a tick of 10 ms;
 * - `commit` commits a document at `https://example.test/`, and `load` makes it interactive, then complete;
 * - `resp(name)` is a request for `https://example.test/name`, answered with 200 and finished;
 * - `dialog(kind)` opens an `alert`, `confirm`, `prompt` or `beforeunload` prompt, decided as any is;
 * - `popup` opens a popup with this page as its opener;
 * - `crash` ends the page as crashed, and `|` as closed by its script; nothing after either plays.
 *
 * Whitespace is ignored, and anything else fails the layer's construction as a defect, naming where.
 */
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Browser from "../Browser.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import * as NetworkResponse from "../NetworkResponse.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as Declarations from "./declarations.ts"
import * as Urls from "./urls.ts"

/** One step of a timeline. */
export type Step =
  | { readonly _tag: "Tick" }
  | { readonly _tag: "Commit" }
  | { readonly _tag: "Load" }
  | { readonly _tag: "Response"; readonly name: string }
  | { readonly _tag: "Dialog"; readonly kind: "alert" | "confirm" | "prompt" | "beforeunload" }
  | { readonly _tag: "Popup" }
  | { readonly _tag: "Crash" }
  | { readonly _tag: "Close" }

const origin = "https://example.test"

const tick = "10 millis"

const kinds = new Set(["alert", "confirm", "prompt", "beforeunload"])

/** A timeline's steps; a step it can't read throws, naming where. */
export const parse = (timeline: string): ReadonlyArray<Step> => {
  const steps: Array<Step> = []
  const token = /\s+|-|\||commit|load|popup|crash|resp\(([^()\s]+)\)|dialog\(([a-z]+)\)/y
  let at = 0
  while (at < timeline.length) {
    token.lastIndex = at
    const match = token.exec(timeline)
    if (match === null) {
      throw new Error(
        `Browser.layerTest: ${JSON.stringify(timeline.slice(at, at + 12))} at ${at} isn't a step; ` +
          "the steps are -, commit, load, resp(name), dialog(kind), popup, crash, and |"
      )
    }
    at = token.lastIndex
    const [text, name, kind] = match
    if (/^\s+$/.test(text)) continue
    if (text === "-") steps.push({ _tag: "Tick" })
    else if (text === "|") steps.push({ _tag: "Close" })
    else if (text === "commit") steps.push({ _tag: "Commit" })
    else if (text === "load") steps.push({ _tag: "Load" })
    else if (text === "popup") steps.push({ _tag: "Popup" })
    else if (text === "crash") steps.push({ _tag: "Crash" })
    else if (name !== undefined) steps.push({ _tag: "Response", name })
    else if (kind !== undefined && kinds.has(kind)) {
      steps.push({ _tag: "Dialog", kind: kind as "alert" | "confirm" | "prompt" | "beforeunload" })
    } else {
      throw new Error(
        `Browser.layerTest: dialog(${kind}) at ${at - text.length} isn't alert, confirm, prompt, or beforeunload`
      )
    }
  }
  return steps
}

interface FakePage {
  readonly id: Target.NavigableId
  readonly context: UserContext.Id
  document: Target.DocumentId
  url: string
  ended: boolean
}

const noDom = "Browser.layerTest's pages have no DOM"

const unsupported = (capability: string, hint = noDom) =>
  Effect.fail(new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability, hint } }))

const entry = (
  name: string,
  status: Browser.CapabilityEntry["status"],
  limitations: ReadonlyArray<string> = []
): Browser.CapabilityEntry => ({
  name,
  status,
  evidence: "Browser.layerTest's fake adapter",
  limitations: [...limitations]
})

/** What the fake can do, as `Browser.layerTest` makes its `CapabilitySet` of. */
export const capabilities: ReadonlyArray<Browser.CapabilityEntry> = [
  entry("userContexts", "supported"),
  entry("prompts", "supported"),
  entry("prompts.kind", "supported"),
  entry("popups.opener", "supported"),
  entry("close.runBeforeUnload", "supported", ["no page has a document to ask"]),
  entry("engine", "unsupported", [noDom]),
  entry("boundingBox.frameTransforms", "unsupported", [noDom]),
  entry("isolatedWorlds", "unsupported", [noDom]),
  entry("input.native", "unsupported", [noDom]),
  entry("interception.request", "unsupported", ["the timeline's requests are never paused"]),
  entry("interception.response", "unsupported", ["the timeline's requests are never paused"]),
  entry("interception.auth", "unsupported", ["the timeline's requests are never paused"]),
  entry("network.challenges", "unsupported", ["the timeline's requests are never paused"]),
  entry("bodies", "supported", ["every body is empty"]),
  entry("console", "unsupported", ["the timeline has no console messages"]),
  entry("fileChooser", "unsupported", [noDom]),
  entry("downloads", "unsupported", ["the timeline has no downloads"]),
  entry("screenshot", "unsupported", ["nothing is painted"]),
  entry("pdf", "unsupported", ["nothing is painted"]),
  entry("workers.evaluate", "unsupported", ["the timeline has no workers"]),
  entry("capability.virtualAuthenticator", "unsupported", ["The test backend does not implement native WebAuthn"]),
  entry("capability.axTree", "unsupported", [noDom]),
  entry("capability.screencast", "unsupported", ["nothing is painted"]),
  entry("capability.video", "unsupported", ["nothing is painted"])
]

/** What the fake is, as `Browser.layerTest` makes its `Info` of. */
export const info = { product: "Fake", version: "1", protocol: "fake", revision: "layerTest" } as const

/**
 * Connects the fake for the layer's scope, its first page to play `steps`; `Browser.layerTest` makes what it
 * reports itself as, so this module needn't load `Browser.ts`, which loads it.
 */
export const connect = (
  steps: ReadonlyArray<Step>,
  describe: { readonly info: Browser.Info; readonly capabilities: Browser.CapabilitySet }
) =>
(sink: Adapter.Sink) =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const ids = Adapter.makeIds()
    const registry = Declarations.make()
    // One fact at a time, in order, as a backend's fold delivers them
    const lock = yield* Semaphore.make(1)
    const emit = (...facts: ReadonlyArray<Adapter.Fact>) =>
      lock.withPermits(1)(Effect.forEach(facts, sink, { discard: true }))
    const pages = new Map<Target.NavigableId, FakePage>()
    const contexts = new Set<UserContext.Id>()
    const cookies = new Map<UserContext.Id, ReadonlyArray<Adapter.Cookie>>()
    const prompts = new Map<Adapter.ObligationId, Dialog>()
    let playing = false

    const defaultContext = ids.userContext()
    contexts.add(defaultContext)
    yield* emit({ _tag: "UserContextAdded", context: defaultContext, isDefault: true })

    /** Adds a page with its initial blank document. */
    const addPage = Effect.fnUntraced(
      function*(context: UserContext.Id, kind: "tab" | "popup", opener: Option.Option<Target.NavigableId>) {
        const page: FakePage = {
          id: ids.navigable(),
          context,
          document: ids.document(),
          url: "about:blank",
          ended: false
        }
        pages.set(page.id, page)
        yield* emit(
          {
            _tag: "PageAdded",
            page: page.id,
            context,
            kind,
            origin: kind === "popup" ? { _tag: "Opened", opener } : { _tag: "Created" },
            url: Urls.reported(page.url)
          },
          {
            _tag: "DocumentCommitted",
            document: page.document,
            navigable: page.id,
            url: Urls.reported(page.url),
            origin: "null",
            createdBy: { _tag: "InitialBlank" },
            replaced: Option.none(),
            evidence: "fake: the page's initial document"
          },
          { _tag: "DocumentReadiness", document: page.document, readiness: "complete" },
          { _tag: "PageReady", page: page.id }
        )
        return page
      }
    )

    /** Commits a new document in the page, as a navigation's. */
    const commit = Effect.fnUntraced(
      function*(page: FakePage, url: string, initiatedAs: Adapter.InitiatedAs, ready: boolean) {
        const navigation = ids.navigation()
        const replaced = page.document
        page.document = ids.document()
        page.url = url
        yield* emit(
          { _tag: "NavigationStarted", navigation, navigable: page.id, url: Urls.reported(url), initiatedAs },
          {
            _tag: "DocumentCommitted",
            document: page.document,
            navigable: page.id,
            url: Urls.reported(url),
            origin,
            createdBy: { _tag: "Navigation", navigation },
            replaced: Option.some(replaced),
            evidence: "fake: commit"
          },
          {
            _tag: "NavigationEnded",
            navigation,
            outcome: { _tag: "Committed", document: page.document, response: Option.none() },
            evidence: "fake: commit"
          },
          ...(ready
            ? [
              { _tag: "DocumentReadiness", document: page.document, readiness: "interactive" },
              { _tag: "DocumentReadiness", document: page.document, readiness: "complete" }
            ] as const
            : [])
        )
        return navigation
      }
    )

    const end = (page: FakePage, reason: Target.CloseReason, evidence: string) =>
      Effect.suspend(() => {
        if (page.ended) return Effect.void
        page.ended = true
        return emit({ _tag: "NavigableRemoved", navigable: page.id, reason, evidence })
      })

    const play = (page: FakePage): Effect.Effect<void> =>
      Effect.gen(function*() {
        for (const step of steps) {
          if (page.ended) return
          switch (step._tag) {
            case "Tick":
              yield* Effect.sleep(tick)
              break
            case "Commit":
              yield* commit(page, `${origin}/`, "crossDocument", false)
              break
            case "Load":
              yield* emit(
                { _tag: "DocumentReadiness", document: page.document, readiness: "interactive" },
                { _tag: "DocumentReadiness", document: page.document, readiness: "complete" }
              )
              break
            case "Response": {
              const url = Urls.reported(`${origin}/${step.name}`)
              const hop = ids.hop(ids.request(), 0)
              yield* emit(
                {
                  _tag: "RequestSent",
                  request: new NetworkRequest.NetworkRequest({
                    hop,
                    method: "GET",
                    url,
                    headers: Headers.empty,
                    resourceType: "fetch",
                    initiator: { _tag: "Document", navigable: page.id, navigation: Option.none() },
                    at: Adapter.now()
                  })
                },
                {
                  _tag: "ResponseReceived",
                  response: new NetworkResponse.NetworkResponse({
                    hop,
                    url,
                    status: 200 as NetworkResponse.StatusCode,
                    statusText: "OK",
                    httpVersion: Option.some("http/1.1"),
                    headers: Headers.empty,
                    servedBy: "network",
                    at: Adapter.now()
                  })
                },
                { _tag: "RequestFinished", hop, encodedBytes: 0, at: Adapter.now() }
              )
              break
            }
            case "Dialog": {
              const obligation = ids.obligation()
              const prompt = ids.prompt()
              prompts.set(obligation, { prompt, page })
              yield* emit({
                _tag: "ObligationOpened",
                obligation,
                subject: { _tag: "Prompt", prompt, page: page.id, kind: step.kind, message: "", defaultValue: "" }
              })
              break
            }
            case "Popup":
              yield* addPage(page.context, "popup", Option.some(page.id))
              break
            case "Crash":
              return yield* end(page, new Target.PageCrashed({}), "fake: crash")
            case "Close":
              return yield* end(page, new Target.PageClosed({ by: "script" }), "fake: |")
          }
        }
      })

    const pageOf = (id: Target.NavigableId) =>
      Effect.suspend(() => {
        const page = pages.get(id)
        return page === undefined || page.ended
          ? Effect.fail(
            new Adapter.AdapterError({
              reason: { _tag: "Gone", target: { _tag: "Page", id }, reason: new Target.PageClosed({ by: "command" }) }
            })
          )
          : Effect.succeed(page)
      })

    const adapter: Adapter.AdapterConnection = {
      ownership: "attached",
      info: describe.info,
      capabilities: yield* SubscriptionRef.make(describe.capabilities),
      pauseScope: "browser",
      defaultContext,
      closed: Effect.never,
      createUserContext: Effect.fnUntraced(function*() {
        const context = ids.userContext()
        contexts.add(context)
        yield* emit({ _tag: "UserContextAdded", context, isDefault: false })
        return context
      }),
      removeUserContext: Effect.fnUntraced(function*(context: UserContext.Id) {
        if (!contexts.delete(context)) return
        for (const page of pages.values()) if (page.context === context) page.ended = true
        yield* emit({ _tag: "UserContextRemoved", context })
      }),
      createPage: Effect.fnUntraced(function*(context: UserContext.Id) {
        const page = yield* addPage(context, "tab", Option.none())
        // The first page plays the timeline, in the layer's scope
        if (!playing) {
          playing = true
          yield* Effect.forkIn(play(page), scope)
        }
        return page.id
      }),
      closePage: (id) =>
        Effect.suspend(() => {
          const page = pages.get(id)
          return page === undefined
            ? Effect.void
            : end(page, new Target.PageClosed({ by: "command" }), "fake: closePage")
        }),
      viewportSize: (id) =>
        Effect.map(pageOf(id), (page) => Declarations.viewportSize(registry, { page: page.id, context: page.context })),
      activatePage: (id) => Effect.asVoid(pageOf(id)),
      navigate: (id, url) => Effect.flatMap(pageOf(id), (page) => commit(page, url, "crossDocument", true)),
      reload: (id) => Effect.flatMap(pageOf(id), (page) => commit(page, page.url, "reload", true)),
      traverse: (id) => Effect.as(pageOf(id), Option.none<PageNavigation.Id>()),
      realm: () => unsupported("engine"),
      evaluate: () => unsupported("engine"),
      releaseHandles: () => Effect.void,
      dispatchInput: () => unsupported("input.native"),
      frameReady: () => Effect.void,
      contentFrame: () => unsupported("engine"),
      releaseNodes: () => Effect.void,
      geometry: () => unsupported("Locator.boundingBox"),
      resolve: (obligation, decision) =>
        Effect.suspend(() => {
          const open = prompts.get(obligation)
          if (open === undefined) return Effect.void
          prompts.delete(obligation)
          return emit(
            { _tag: "ObligationEnded", obligation, reason: "resolved", evidence: "fake: resolve" },
            {
              _tag: "PromptClosed",
              prompt: open.prompt,
              accepted: decision._tag === "Accept",
              userText: decision._tag === "Accept" ? decision.promptText : Option.none()
            }
          )
        }),
      declare: Effect.fnUntraced(function*(scope, declaration) {
        const id = ids.registration()
        registry.add(scope, declaration, id)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            registry.remove(id)
          })
        )
        return id
      }),
      screenshot: () => unsupported("screenshot", "nothing is painted"),
      pdf: () => unsupported("pdf", "nothing is painted"),
      accessibilityTree: () => unsupported("capability.axTree"),
      screencast: () => unsupported("capability.screencast", "nothing is painted"),
      video: () => unsupported("capability.video", "nothing is painted"),
      createAuthenticator: () =>
        unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP"),
      releaseAuthenticator: () => Effect.void,
      authenticatorCredentials: () =>
        unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP"),
      updateAuthenticator: () =>
        unsupported("capability.virtualAuthenticator", "Native virtual authenticators require Chromium CDP"),
      cookies: (context) => Effect.succeed(cookies.get(context) ?? []),
      setCookies: (context, added) =>
        Effect.sync(() => {
          const kept = (cookies.get(context) ?? []).filter((cookie) =>
            !added.some((each) =>
              each.name === cookie.name && each.domain === cookie.domain && each.path === cookie.path
            )
          )
          cookies.set(context, [...kept, ...added])
        }),
      clearCookies: (context) => Effect.sync(() => void cookies.delete(context)),
      grantPermissions: () => Effect.void,
      resetPermissions: () => Effect.void,
      responseBody: () => Effect.succeed(new Uint8Array()),
      captureRequestBody: () => Effect.succeed({ _tag: "Unavailable", why: "notCollected" }),
      requestBody: () => Effect.succeedNone,
      pausedRequestBody: () => Effect.succeedNone,
      pausedResponseBody: () => unsupported("interception.responseBody", "the timeline's requests are never paused"),
      setInputFiles: () => unsupported("fileChooser"),
      downloadPath: () => Effect.succeedNone,
      cancelDownload: () => unsupported("downloads.cancel", "the timeline has no downloads")
    }
    return adapter
  })

interface Dialog {
  readonly prompt: ReturnType<Adapter.Ids["prompt"]>
  readonly page: FakePage
}
