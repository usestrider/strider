/**
 * Pages (API.md, Pages; review 12, candidate 7). Built: the state (`status`, `url`, `closed`), the queries,
 * `goto`, `reload`, `back` and `forward`, `title`, `activate` and `close`. The other members fail as
 * `NotBuilt`.
 *
 * A navigation resolves at commit, with the outcome the adapter reports for the navigation it started, or with
 * the readiness `waitUntil` asks for of the document it committed, all under one deadline; a navigation with
 * no outcome by then is `Timeout{postcondition}` (CONCEPTS.md §4).
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as PageNavigation from "../PageNavigation.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as Handles from "./handles.ts"
import * as LocatorImpl from "./locator.ts"
import type * as Model from "./model.ts"
import * as NotBuilt from "./notBuilt.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import * as Watchable from "./watchable.ts"

const PageTypeId = "~@usestrider/browser/Page"

const opened = (state: Model.PageState): Option.Option<Page.Status> =>
  state._tag === "Opening"
    ? Option.none()
    : Option.some(
      state._tag === "Open"
        ? { _tag: "Open", url: state.url as Url.Url, document: state.document, prompt: state.prompt }
        : { _tag: "Closed", reason: state.reason }
    )

const pageEnded = (state: Model.PageState): Option.Option<Target.CloseReason> =>
  state._tag === "Closed" ? Option.some(state.reason) : Option.none()

const pageError = (operation: string, reason: Page.PageErrorReason, id: Diagnostics.OperationId) =>
  new Page.PageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** A navigation's outcome as `goto` reports it: the navigation, or why the page didn't get there. */
const settle = (
  model: Model.Model,
  operation: string,
  navigation: PageNavigation.Id,
  url: Option.Option<Url.Url>,
  outcome: Adapter.NavigationOutcome,
  id: Diagnostics.OperationId
): Effect.Effect<PageNavigation.PageNavigation, Page.PageError> => {
  switch (outcome._tag) {
    case "Committed":
      return Effect.succeed({
        _tag: "Committed",
        id: navigation,
        document: outcome.document,
        response: Option.flatMap(outcome.response, model.response)
      })
    case "SameDocument":
      return Effect.succeed({ _tag: "SameDocument", id: navigation, document: outcome.document, via: outcome.via })
    case "Restored":
      return Effect.succeed({ _tag: "Restored", id: navigation, document: outcome.document })
    case "Activated":
      return Effect.succeed({ _tag: "Activated", id: navigation, document: outcome.document })
    case "Download":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.BecameDownload({
          url,
          hint: "The response was a download, so the page stayed where it was"
        }),
        id
      ))
    case "NoContent":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NoContent({
          url,
          hint: "The server answered without content, so the page stayed where it was"
        }),
        id
      ))
    case "Failed":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationFailed({
          url,
          netError: outcome.error,
          hint: "The browser couldn't load the page"
        }),
        id
      ))
    case "Superseded":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationSuperseded({
          url,
          by: outcome.by,
          hint: "Another navigation of the page replaced this one before it committed"
        }),
        id
      ))
    case "Canceled":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationCanceled({
          url,
          why: outcome.reason,
          hint: "The page or the browser canceled the navigation"
        }),
        id
      ))
    case "NoOp":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationFailed({
          url,
          netError: `noop: ${outcome.reason}`,
          hint: "The navigation did nothing: a javascript: URL that returned no document"
        }),
        id
      ))
  }
}

export interface PageOwner {
  readonly runtime: Runtime.Runtime
  readonly entry: Model.PageEntry
  readonly context: UserContext.UserContext
}

export const make = (owner: PageOwner): Page.Page => {
  const { runtime, entry } = owner
  const model = runtime.model
  const adapter = model.adapter
  const queries = LocatorImpl.pageQueries({ runtime, page: entry })

  const status = Watchable.make({
    ref: entry.state,
    project: opened,
    ended: pageEnded,
    target: { _tag: "Page", id: entry.id },
    operation: "Page.status.waitFor"
  })

  const failure = (operation: string, id: Diagnostics.OperationId, error: Adapter.AdapterError) => {
    const mapped = Operation.fromAdapter(error, id, runtime.backend)
    return mapped._tag === "Gone" ? mapped.error : pageError(operation, mapped.reason, id)
  }

  /** Waits for a navigation the adapter started, then for `waitUntil` on the document it committed. */
  const navigate = (
    operation: string,
    url: Option.Option<Url.Url>,
    start: (
      id: Diagnostics.OperationId
    ) => Effect.Effect<Option.Option<PageNavigation.Id>, Target.TargetGone | Page.PageError>,
    waitUntil: PageNavigation.LoadState
  ) =>
    Effect.gen(function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      const timedOut = (phase: "postcondition", hint: string) =>
        Operation.timeout({ operation, id, phase, budget: budget.budget, history: [], hint: Option.some(hint) })
      const started = yield* start(id)
      if (Option.isNone(started)) return Option.none<PageNavigation.PageNavigation>()
      const navigation = model.navigation(started.value)
      const outcome = yield* Deferred.await(navigation.outcome).pipe(
        Effect.timeoutOption(Operation.millisLeft(budget.at)),
        Effect.ensuring(Effect.sync(() => model.forget(started.value)))
      )
      if (Option.isNone(outcome)) {
        return yield* Effect.fail(timedOut("postcondition", "The navigation had no outcome before the deadline"))
      }
      const result = yield* settle(model, operation, started.value, url, outcome.value, id)
      if (waitUntil !== "commit" && result._tag === "Committed") {
        const document = model.documents.get(result.document)
        if (document !== undefined) {
          const reached = (readiness: string) =>
            waitUntil === "load" ? readiness === "complete" : readiness === "interactive" || readiness === "complete"
          const ready = yield* SubscriptionRef.changes(document.readiness).pipe(
            Stream.filter(reached),
            Stream.runHead,
            Effect.raceFirst(Effect.map(Deferred.await(document.ended), () => Option.none<string>())),
            Effect.timeoutOption(Operation.millisLeft(budget.at))
          )
          if (Option.isNone(ready)) {
            return yield* Effect.fail(timedOut("postcondition", `The document committed but didn't reach ${waitUntil}`))
          }
        }
      }
      return Option.some(result)
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(entry, Operation.operationId())),
      Effect.withSpan(operation, {
        attributes: { "browser.page.id": entry.id, "browser.navigation.wait_until": waitUntil }
      })
    )

  const page: Page.Page = {
    [PageTypeId]: PageTypeId,
    id: entry.id,
    status,
    url: Watchable.make({
      ref: entry.state,
      project: (state) => state._tag === "Opening" ? Option.none() : Option.some(state.url as Url.Url),
      ended: pageEnded,
      target: { _tag: "Page", id: entry.id },
      operation: "Page.url.waitFor"
    }),
    frames: NotBuilt.watchable("Page.frames"),
    workers: NotBuilt.watchable("Page.workers"),
    closed: Deferred.await(entry.closed),
    inspect: NotBuilt.effect("Page.inspect"),
    control: NotBuilt.effect("Page.control"),
    ...queries,
    frame: NotBuilt.sync("Page.frame") as Page.Page["frame"],
    get title() {
      return Effect.gen(function*() {
        const id = Operation.operationId()
        const budget = yield* Operation.budget
        const response = yield* Runtime.send(runtime, entry, { op: "title" }, id, budget.at).pipe(
          Effect.mapError((failure) =>
            failure._tag === "Gone"
              ? failure.error
              : failure._tag === "Reason"
              ? pageError("Page.title", failure.reason, id)
              : Operation.timeout({
                operation: "Page.title",
                id,
                phase: "resolving",
                budget: budget.budget,
                history: [],
                hint: Option.none()
              })
          )
        )
        return response._tag === "Title" ? response.title : yield* Effect.die(new Error(`Page.title: ${response._tag}`))
      }).pipe(Effect.withSpan("Page.title", { attributes: { "browser.page.id": entry.id } }))
    },
    readHtml: NotBuilt.effect("Page.readHtml"),
    snapshot: NotBuilt.fn("Page.snapshot") as Page.Page["snapshot"],
    screenshot: NotBuilt.fn("Page.screenshot") as Page.Page["screenshot"],
    pdf: NotBuilt.fn("Page.pdf") as Page.Page["pdf"],
    localStorage: {
      entries: NotBuilt.effect("Page.localStorage"),
      get: NotBuilt.fn("Page.localStorage"),
      set: NotBuilt.fn("Page.localStorage"),
      remove: NotBuilt.fn("Page.localStorage"),
      clear: NotBuilt.effect("Page.localStorage")
    },
    sessionStorage: {
      entries: NotBuilt.effect("Page.sessionStorage"),
      get: NotBuilt.fn("Page.sessionStorage"),
      set: NotBuilt.fn("Page.sessionStorage"),
      remove: NotBuilt.fn("Page.sessionStorage"),
      clear: NotBuilt.effect("Page.sessionStorage")
    },
    evaluate: NotBuilt.fn("Page.evaluate") as Page.Page["evaluate"],
    capability: NotBuilt.fn("Page.capability") as Page.Page["capability"],
    context: owner.context,
    goto: (url, options) => {
      if (options?.accept !== undefined && options.accept.length > 0) return NotBuilt.effect("Page.goto with accept")
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return Effect.fail(pageError(
          "Page.goto",
          new Reason.InvalidInput({
            input: "url",
            expected: "an absolute URL",
            hint: `${JSON.stringify(url)} doesn't parse`
          }),
          Operation.operationId()
        ))
      }
      return navigate(
        "Page.goto",
        Option.some(parsed.href as Url.Url),
        (id) =>
          Effect.map(adapter.navigate(entry.id, parsed.href, { referrer: Option.none() }), Option.some).pipe(
            Effect.mapError((error) => failure("Page.goto", id, error))
          ),
        options?.waitUntil ?? "commit"
      ).pipe(Effect.map(Option.getOrThrow))
    },
    reload: (options) =>
      navigate(
        "Page.reload",
        Option.none(),
        (id) =>
          Effect.map(adapter.reload(entry.id, { ignoreCache: options?.bypassCache ?? false }), Option.some).pipe(
            Effect.mapError((error) => failure("Page.reload", id, error))
          ),
        options?.waitUntil ?? "commit"
      ).pipe(Effect.map(Option.getOrThrow)),
    back: (options) =>
      navigate(
        "Page.back",
        Option.none(),
        (id) => adapter.traverse(entry.id, -1).pipe(Effect.mapError((error) => failure("Page.back", id, error))),
        options?.waitUntil ?? "commit"
      ),
    forward: (options) =>
      navigate(
        "Page.forward",
        Option.none(),
        (id) => adapter.traverse(entry.id, 1).pipe(Effect.mapError((error) => failure("Page.forward", id, error))),
        options?.waitUntil ?? "commit"
      ),
    evaluateInMainWorld: NotBuilt.fn("Page.evaluateInMainWorld") as Page.Page["evaluateInMainWorld"],
    evaluateHandle: NotBuilt.fn("Page.evaluateHandle") as Page.Page["evaluateHandle"],
    keyboard: {
      press: NotBuilt.fn("Page.keyboard.press"),
      pressSequentially: NotBuilt.fn("Page.keyboard.pressSequentially"),
      insertText: NotBuilt.fn("Page.keyboard.insertText"),
      hold: NotBuilt.fn("Page.keyboard.hold")
    },
    mouse: {
      position: NotBuilt.effect("Page.mouse.position"),
      move: NotBuilt.fn("Page.mouse.move"),
      click: NotBuilt.fn("Page.mouse.click"),
      hold: NotBuilt.fn("Page.mouse.hold"),
      wheel: NotBuilt.fn("Page.mouse.wheel")
    },
    clock: {
      install: NotBuilt.fn("Page.clock.install"),
      adjust: NotBuilt.fn("Page.clock.adjust"),
      setTime: NotBuilt.fn("Page.clock.setTime"),
      resume: NotBuilt.effect("Page.clock.resume")
    },
    route: NotBuilt.fn("Page.route") as Page.Page["route"],
    addInitScript: NotBuilt.fn("Page.addInitScript"),
    emulate: NotBuilt.fn("Page.emulate"),
    activate: Effect.gen(function*() {
      const id = Operation.operationId()
      yield* adapter.activatePage(entry.id).pipe(Effect.catch((error) => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        // Bringing a page to the front has no failure of its own: anything but its end is a defect
        return mapped._tag === "Gone" ? Effect.fail(mapped.error) : Effect.die(mapped.reason)
      }))
    }).pipe(Effect.withSpan("Page.activate", { attributes: { "browser.page.id": entry.id } })),
    close: ((options?: { readonly runBeforeUnload: boolean }) => {
      if (options?.runBeforeUnload === true) return NotBuilt.effect("Page.close with runBeforeUnload")
      return Effect.gen(function*() {
        const id = Operation.operationId()
        const budget = yield* Operation.budget
        if (Option.isSome(yield* Deferred.poll(entry.closed))) return
        yield* adapter.closePage(entry.id, { runBeforeUnload: false }).pipe(Effect.catch((error) => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          return mapped._tag === "Gone" ? Effect.void : Effect.die(mapped.reason)
        }))
        const closed = yield* Deferred.await(entry.closed).pipe(Effect.timeoutOption(Operation.millisLeft(budget.at)))
        if (Option.isNone(closed)) {
          return yield* Effect.fail(Operation.timeout({
            operation: "Page.close",
            id,
            phase: "dispatchedUnconfirmed",
            budget: budget.budget,
            history: [],
            hint: Option.some("The browser was asked to close the page, and hadn't confirmed it by the deadline")
          }))
        }
      }).pipe(Effect.withSpan("Page.close", { attributes: { "browser.page.id": entry.id } }))
    }) as Page.Page["close"],
    [Equal.symbol](that: unknown) {
      return Page.isPage(that) && that.id === entry.id
    },
    [Hash.symbol]() {
      return Hash.string(entry.id)
    },
    pipe() {
      return pipeArguments(this, arguments)
    },
    toString() {
      return `Page(${entry.id})`
    },
    toJSON() {
      return { _id: "Page", id: entry.id }
    },
    [Inspectable.NodeInspectSymbol]() {
      return { _id: "Page", id: entry.id }
    }
  }
  Handles.registerPage(page, { runtime, entry })
  return page
}
