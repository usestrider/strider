/**
 * Stock WebKit launched in automation mode: its Automation sessions, a context's browser process each
 * (`webkitAutomation.ts`), make and drive what its inspector only looks at. A page is paired with its Automation
 * handle by its document's time origin; its dialogs are found by asking, since Automation reports none on its own
 * (QUIRKS.md, Q206); and the viewport is the window's size.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import type * as UserContext from "../../UserContext.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import type * as WebKitAutomation from "../webkitAutomation.ts"
import { navigateByScript } from "./navigation.ts"
import { promptClosed, promptOpened } from "./obligations.ts"
import { type ContextEntry, contextOf, frameById, type PageEntry, pageOf, placement, type State } from "./state.ts"
import { withoutFragment } from "./tree.ts"

// ── Processes and pages ───────────────────────────────────────────────────────────────────────────────────

/** A context's browser process. */
export const processOfContext = (state: State, context: ContextEntry) =>
  Effect.suspend(() => {
    const process = state.automation?.process(context.browserContextId ?? "default")
    return process === undefined
      ? Effect.fail(Kit.gone({ _tag: "UserContext" }, new L1Target.UserContextRemoved({})))
      : Effect.succeed(process)
  })
/** An Automation command, on a process's session. */
export const automationOf = <M extends string, P, A>(
  process: WebKitAutomation.Process,
  command: Protocol.Command<M, P, A>
) => Kit.protocol(command.pipe(Protocol.on(process.automation)))

/** Automation's result of a function, as JSON: one that threw is an empty result, not an error (QUIRKS.md, Q227). */
export const resultOf = (result: string): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(result))
  } catch {
    return Option.none()
  }
}
const timeOrigin = "function() { return performance.timeOrigin }"

/**
 * A page's two names: Automation's handle and the inspector's target, paired by the document's time origin, which
 * both read and neither writes (QUIRKS.md, Q219).
 */
const pairOnce = Effect.fnUntraced(function*(state: State, page: PageEntry) {
  const known = state.pageHandles.get(page)
  if (known !== undefined) return Option.some(known)
  const process = yield* processOfContext(state, page.context)
  const target = page.target
  if (target === undefined || target.ended) return Option.none()
  const ours = yield* Runtime.evaluate({ expression: "performance.timeOrigin", returnByValue: true }).pipe(
    Protocol.on(target.session),
    Effect.map((reply) => reply.result.value as number),
    Effect.option
  )
  if (Option.isNone(ours)) return Option.none()
  const { contexts: listed } = yield* automationOf(process, Automation.getBrowsingContexts())
  for (const candidate of listed) {
    if (candidate.handle === process.anchor || state.pairedHandles.has(candidate.handle)) continue
    const theirs = yield* automationOf(
      process,
      Automation.evaluateJavaScriptFunction({
        browsingContextHandle: candidate.handle,
        function: timeOrigin,
        arguments: []
      })
    ).pipe(Effect.map(({ result }) => resultOf(result)), Effect.orElseSucceed(() => Option.none()))
    if (Option.isSome(theirs) && theirs.value === ours.value) {
      state.pageHandles.set(page, candidate.handle)
      state.pairedHandles.add(candidate.handle)
      yield* afterPairing(state, page, candidate.handle, process)
      return Option.some(candidate.handle)
    }
  }
  return Option.none()
})
export const pageHandleOf = Effect.fnUntraced(function*(state: State, page: PageEntry) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (page.ended) break
    const found = yield* state.pairing.withPermits(1)(pairOnce(state, page))
    if (Option.isSome(found)) return found.value
    yield* BrowserClock.live.sleep(50)
  }
  return yield* Effect.fail(
    Kit.gone({ _tag: "Page", id: page.id }, page.closing ?? new L1Target.PageClosed({ by: "browser" }))
  )
})

// Once paired: the page's declared viewport, and a watch for its dialogs
export const afterPairing = Effect.fnUntraced(function*(
  state: State,
  page: PageEntry,
  handle: Automation.BrowsingContextHandle,
  process: WebKitAutomation.Process
) {
  const viewport = state.registry.overrides(placement(page)).get("Viewport")
  if (viewport !== undefined) yield* resizeWindow(state, page, viewport).pipe(Effect.ignore)
  state.buffer.start(watchDialogs(state, page, handle, process))
})

// A dialog Automation says is open, reported with its message, unless it already is
export const reportDialog = Effect.fnUntraced(function*(
  state: State,
  page: PageEntry,
  handle: Automation.BrowsingContextHandle,
  process: WebKitAutomation.Process
) {
  const message = yield* Automation.messageOfCurrentJavaScriptDialog({ browsingContextHandle: handle }).pipe(
    Protocol.on(process.automation),
    Effect.map((reply) => reply.message),
    Effect.orElseSucceed(() => "")
  )
  yield* state.buffer.run(() => {
    if (page.dialog === undefined && !page.ended) promptOpened(state, page, "unknown", message, "")
  })
})

/**
 * Input that opens a dialog returns once the dialog is decided, as on every backend; Automation's returns as it
 * opens, so the adapter looks for one before the input returns (QUIRKS.md, Q224).
 */
export const settleDialog = Effect.fnUntraced(function*(
  state: State,
  page: PageEntry,
  handle: Automation.BrowsingContextHandle,
  process: WebKitAutomation.Process
) {
  const showing = yield* Automation.isShowingJavaScriptDialog({ browsingContextHandle: handle }).pipe(
    Protocol.on(process.automation),
    Effect.map(({ result }) => result),
    Effect.orElseSucceed(() => false)
  )
  if (!showing) return
  if (page.dialog === undefined) yield* reportDialog(state, page, handle, process)
  while (page.dialog !== undefined && !page.ended) yield* BrowserClock.live.sleep(20)
})

// Stock WebKit's Automation reports a dialog only when asked, and not its kind (QUIRKS.md, Q206)
export const watchDialogs = Effect.fnUntraced(function*(
  state: State,
  page: PageEntry,
  handle: Automation.BrowsingContextHandle,
  process: WebKitAutomation.Process
) {
  while (!page.ended) {
    yield* BrowserClock.live.sleep(100)
    const showing = yield* Automation.isShowingJavaScriptDialog({ browsingContextHandle: handle }).pipe(
      Protocol.on(process.automation),
      Effect.map(({ result }) => result),
      Effect.orElseSucceed(() => false)
    )
    if (showing && page.dialog === undefined) {
      yield* reportDialog(state, page, handle, process)
    } else if (!showing && page.dialog !== undefined) {
      yield* state.buffer.run(() => promptClosed(state, page, "webkit:Automation.isShowingJavaScriptDialog"))
    }
  }
})

// ── The viewport ──────────────────────────────────────────────────────────────────────────────────────────

/** The viewport, as the window's size less its toolbar's; a page's own window again when it's released. */
export const resizeWindow = (
  state: State,
  page: PageEntry,
  override: Adapter.Override | undefined
): Effect.Effect<void, Protocol.ProtocolError> =>
  Effect.gen(function*() {
    const handle = state.pageHandles.get(page)
    const process = state.automation?.process(page.context.browserContextId ?? "default")
    if (handle === undefined || process === undefined) return
    const on = Protocol.on(process.automation)
    if (override?._tag !== "Viewport") {
      const natural = state.naturalWindows.get(page)
      if (natural === undefined) return
      state.naturalWindows.delete(page)
      return yield* Automation.setWindowFrameOfBrowsingContext({ handle, size: natural }).pipe(on)
    }
    if (!state.naturalWindows.has(page)) {
      const { context } = yield* Automation.getBrowsingContext({ handle }).pipe(on)
      state.naturalWindows.set(page, context.windowSize)
      if (!state.chrome.has(process.key)) {
        const { result } = yield* Automation.evaluateJavaScriptFunction({
          browsingContextHandle: handle,
          function: "function() { return [innerWidth, innerHeight] }",
          arguments: []
        }).pipe(on)
        const [width, height] = Option.getOrElse(resultOf(result), () => [0, 0]) as [number, number]
        state.chrome.set(process.key, {
          width: context.windowSize.width - width,
          height: context.windowSize.height - height
        })
      }
    }
    const frame = state.chrome.get(process.key)!
    yield* Automation.setWindowFrameOfBrowsingContext({
      handle,
      size: { width: override.width + frame.width, height: override.height + frame.height }
    }).pipe(on)
  })

// ── Contexts and pages ────────────────────────────────────────────────────────────────────────────────────

export const createUserContextLaunched = Effect.fnUntraced(
  function*(state: State, options: Adapter.UserContextOptions) {
    if (Option.isSome(options.proxy)) {
      return yield* Effect.fail(
        Kit.unsupported("userContexts.proxy", "stock WebKit's automation session takes no proxy")
      )
    }
    const process = yield* state.automation!.launch({ acceptInsecureCerts: options.acceptInsecureCerts }).pipe(
      Effect.mapError((error) =>
        new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability: "userContexts", hint: error.message } })
      )
    )
    const entry: ContextEntry = {
      id: state.ids.userContext(),
      browserContextId: process.key,
      isDefault: false,
      removing: false
    }
    state.contexts.set(entry.id, entry)
    state.contextsByWk.set(process.key, entry)
    yield* state.buffer.run(() => state.buffer.emit({ _tag: "UserContextAdded", context: entry.id, isDefault: false }))
    return entry.id
  }
)

export const removeUserContextLaunched = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  if (context.isDefault) {
    return yield* Effect.fail(
      Kit.unsupported("removeDefaultContext", "The default context exists for the whole connection")
    )
  }
  context.removing = true
  const inContext = [...state.pages.values()].filter((page) => page.context === context)
  const process = yield* processOfContext(state, context)
  yield* process.close
  yield* Effect.forEach(inContext, (page) => page.session.ended, { discard: true })
  state.contexts.delete(id)
  if (context.browserContextId !== undefined) state.contextsByWk.delete(context.browserContextId)
  yield* state.buffer.run(() => state.buffer.emit({ _tag: "UserContextRemoved", context: id }))
})

export const createPageLaunched = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  const process = yield* processOfContext(state, context)
  const key = context.browserContextId ?? "default"
  state.creating.set(key, (state.creating.get(key) ?? 0) + 1)
  const { handle } = yield* automationOf(process, Automation.createBrowsingContext({ presentationHint: "Window" }))
    .pipe(
      Effect.tapError(() => Effect.sync(() => state.creating.set(key, Math.max(0, (state.creating.get(key) ?? 1) - 1))))
    )
  // Its first document is still loading, and a navigation sent before it ends is lost (QUIRKS.md, Q211)
  yield* automationOf(
    process,
    Automation.waitForNavigationToComplete({ browsingContextHandle: handle, pageLoadStrategy: "Normal" })
  )
  for (let attempt = 0; attempt < 100; attempt++) {
    yield* state.root().drainObserved
    for (const page of state.pages.values()) {
      if (page.context !== context || page.ended || state.pageHandles.has(page)) continue
      yield* Deferred.await(page.ready)
      const paired = yield* state.pairing.withPermits(1)(pairOnce(state, page))
      if (Option.isSome(paired) && paired.value === handle) return page.id
    }
    yield* BrowserClock.live.sleep(50)
  }
  return yield* Effect.fail(Kit.gone({ _tag: "Browser" }, new L1Target.PageClosed({ by: "browser" })))
})

export const closePageLaunched = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: { readonly runBeforeUnload: boolean }) {
    const page = yield* pageOf(state, id)
    if (options.runBeforeUnload) {
      return yield* Effect.fail(
        Kit.unsupported("close.runBeforeUnload", "stock WebKit's Automation closes a page without asking it")
      )
    }
    const handle = yield* pageHandleOf(state, page)
    const process = yield* processOfContext(state, page.context)
    page.closing = new L1Target.PageClosed({ by: "command" })
    yield* automationOf(process, Automation.closeBrowsingContext({ handle }))
  }
)

export const activatePageLaunched = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId) {
  const page = yield* pageOf(state, id)
  const handle = yield* pageHandleOf(state, page)
  const process = yield* processOfContext(state, page.context)
  yield* automationOf(process, Automation.switchToBrowsingContext({ browsingContextHandle: handle }))
})

/** A navigation the browser starts: Automation's, for a page; a child frame's by script. */
export const navigateLaunched = Effect.fnUntraced(function*(
  state: State,
  navigable: L1Target.NavigableId,
  url: string,
  options: { readonly referrer: Option.Option<string> }
) {
  const frame = yield* frameById(state, navigable)
  if (frame.parent !== undefined) return yield* navigateByScript(state, navigable, url, options)
  if (Option.isSome(options.referrer)) {
    return yield* Effect.fail(
      Kit.unsupported("navigation.referrer", "stock WebKit's Automation navigates with no referrer of the caller's")
    )
  }
  yield* Deferred.await(frame.page.ready)
  const document = frame.document
  if (document !== undefined && url.includes("#") && withoutFragment(url) === withoutFragment(document.url)) {
    return yield* Effect.fail(
      Kit.unsupported("navigation.sameDocument", "stock WebKit's inspector reports no same-document navigation")
    )
  }
  const handle = yield* pageHandleOf(state, frame.page)
  const process = yield* processOfContext(state, frame.page.context)
  const id = Kit.expect(state.ids, frame.expected, url)
  yield* automationOf(process, Automation.navigateBrowsingContext({ handle, url, pageLoadStrategy: "None" })).pipe(
    Effect.tapError(() => Effect.sync(() => Kit.unexpect(frame.expected, id)))
  )
  return id
})
