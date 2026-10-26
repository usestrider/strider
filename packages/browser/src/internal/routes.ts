/**
 * Routes (review 17, candidates 1 and 2): handlers of paused requests at one phase, registered as
 * `Dialog.handle`'s handlers are. Each declares an intercept wide enough for its pattern, which L0 pauses for,
 * and matches the pattern itself with `Url.Pattern`'s rules. The model asks a paused request's routes in
 * precedence order (`Model.decideRequest`); asking one runs its handler in a fiber of the registration's scope,
 * with the requirements captured at `route` and `Deadline.DefaultBudget` as read then, and turns what it
 * returns into the adapter's decision.
 */
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import * as Reason from "../Reason.ts"
import * as Route from "../Route.ts"
import type * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import * as Handlers from "./handlers.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as RouteDecision from "./routeDecision.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"
import * as UrlPattern from "./urlPattern.ts"
import * as Watchable from "./watchable.ts"

/** Where a route is registered: a page or a context. */
export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly scope: Adapter.DeclarationScope
  readonly routes: Array<Model.RouteEntry>
  readonly target: Target.Description
  /** `Page.route` or `UserContext.route`. */
  readonly operation: string
}

/**
 * The L0 intercept that covers a pattern. A glob is passed as it is, since L0's `*` matches more than ours (`/`
 * included); a URL as itself; a `URLPattern`, which L0 can't read, as its fixed prefix (review 22, Q106).
 */
export const covering = (pattern: string): string =>
  pattern.includes("*") || !/:[a-zA-Z_]/.test(pattern.replace(/^[a-z][a-z0-9+.-]*:/i, ""))
    ? pattern
    : `${fixedPrefix(pattern)}*`

/**
 * A `URLPattern`'s fixed prefix: the scheme through the path up to its first variable part, so every URL it
 * matches starts with it. The origin is written as a URL has it (its host in lower case, a default port left
 * out); a prefix that ends inside the origin keeps only the scheme, and one with a character a URL would encode
 * is cut before it.
 */
const fixedPrefix = (pattern: string): string => {
  // The scheme's colon is followed by `//`, never by a group's name
  const variable = /:[A-Za-z_$]|[(){}?\\+#*]/.exec(pattern)
  let fixed = variable === null ? pattern : pattern.slice(0, variable.index)
  const encoded = /[^A-Za-z0-9\-._~:/@!$&'+,;=%]/.exec(fixed)
  if (encoded !== null) fixed = fixed.slice(0, encoded.index)
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/@]*)(\/.*)$/i.exec(fixed)
  if (parts === null) {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(fixed)
    return scheme === null ? "" : scheme[0].toLowerCase()
  }
  try {
    const origin = new URL(`${parts[1]}://${parts[2]}/`)
    return `${origin.protocol}//${origin.host}${parts[3]}`
  } catch {
    return `${parts[1]!.toLowerCase()}://`
  }
}

/** A header's value as the browser sends it: a redacted one unwrapped, since it is going back where it came from. */
const plain = (headers: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]): [string, string] => [
      name,
      Redacted.isRedacted(value) ? String(Redacted.value(value)) : String(value)
    ])
  )

const bytesOf = (body: { arrayBuffer(): Promise<ArrayBuffer> }) =>
  Effect.map(Effect.promise(() => body.arrayBuffer()), (buffer) => new Uint8Array(buffer))

/** Why a route's decision can't be sent: a handler failure, so the default applies. */
class Undecidable extends Data.TaggedError("Undecidable")<{ readonly message: string }> {}

/**
 * The adapter's decision for a route's. `continueWith` sends only what its change changed, so a header added
 * doesn't resend the body.
 */
const toAdapter = (
  data: Exclude<RouteDecision.Data, { readonly _tag: "Fallthrough" }>,
  paused: Model.PausedRequestEvent
): Effect.Effect<Adapter.Decision, Undecidable> =>
  Effect.gen(function*() {
    switch (data._tag) {
      case "Continue":
        return paused.phase === "auth" ? { _tag: "CancelAuth" } : { _tag: "Continue", overrides: Option.none() }
      case "ContinueWith": {
        const original = NetworkRequest.toHttpClientRequest(paused.request)
        const changed = data.change(original)
        const url = (request: HttpClientRequest.HttpClientRequest) =>
          Effect.map(HttpClientRequest.toWeb(request), (web) => web.url).pipe(
            Effect.mapError((error) => new Undecidable({ message: `its URL doesn't parse: ${error.message}` }))
          )
        const before = yield* url(original)
        const after = yield* url(changed)
        const headers = changed.headers === original.headers ? undefined : plain(changed.headers)
        let body: Uint8Array | undefined
        if (changed.body !== original.body) {
          const web = yield* HttpClientRequest.toWeb(changed).pipe(
            Effect.mapError((error) => new Undecidable({ message: `its body can't be sent: ${error.message}` }))
          )
          body = yield* bytesOf(web)
        }
        // A new body says what it is, unless the change set the header itself
        const contentType = "contentType" in changed.body ? changed.body.contentType : undefined
        const typed = body !== undefined && contentType !== undefined &&
            !Object.keys(changed.headers).some((name) => name.toLowerCase() === "content-type")
          ? { ...(headers ?? plain(original.headers)), "content-type": contentType }
          : headers
        // The browser says a body's length: Chromium refuses the header from a client (review 17's build)
        const withType = typed === undefined
          ? typed
          : Object.fromEntries(Object.entries(typed).filter(([name]) => name.toLowerCase() !== "content-length"))
        return {
          _tag: "Continue",
          overrides: Option.some({
            ...(after === before ? {} : { url: after }),
            ...(changed.method === original.method ? {} : { method: changed.method }),
            ...(withType === undefined ? {} : { headers: withType }),
            ...(body === undefined ? {} : { body })
          })
        }
      }
      case "ContinueResponse": {
        let headers: Record<string, string> | undefined
        if (data.headers !== undefined) {
          headers = {}
          for (const [name, value] of Object.entries(plain(data.headers))) {
            // Several cookies in one record, a line each, as a fulfilled response's are
            headers[name] = name === "set-cookie" ? value.split(/\r?\n|, (?=[^;=]+=)/).join("\n") : value
          }
        }
        return {
          _tag: "ContinueResponse",
          status: Option.fromUndefinedOr(data.status),
          headers: Option.fromUndefinedOr(headers)
        }
      }
      case "Fulfill": {
        const context = yield* Effect.context<never>()
        const web = HttpServerResponse.toWeb(data.response, { context })
        const headers: Record<string, string> = {}
        web.headers.forEach((value, name) => {
          if (name !== "set-cookie") headers[name] = value
        })
        // Several cookies in one record, a line each, which the adapters send as separate headers
        const cookies = web.headers.getSetCookie()
        if (cookies.length > 0) headers["set-cookie"] = cookies.join("\n")
        return { _tag: "Fulfill", status: web.status, headers, body: yield* bytesOf(web) }
      }
      case "Abort":
        return { _tag: "Fail", error: data.reason }
      case "ProvideCredentials":
        return {
          _tag: "ProvideCredentials",
          username: data.username,
          password: Redacted.value(data.password)
        }
    }
  })

/** A body read for a handler, failing as a route does. */
const bodyError =
  (owner: Owner, pattern: string) => (error: Adapter.AdapterError): Route.RouteError | Target.TargetGone => {
    const id = Operation.operationId()
    const mapped = Operation.fromAdapter(error, id, owner.runtime.backend)
    return mapped._tag === "Gone"
      ? mapped.error
      : new Route.RouteError({
        pattern: pattern as Url.Pattern,
        reason: mapped.reason,
        diagnostics: Operation.diagnostics(id)
      })
  }

/** What a handler is given for a paused request. */
const intercepted = (
  owner: Owner,
  pattern: string,
  obligation: Adapter.ObligationId,
  paused: Model.PausedRequestEvent
): Route.Intercepted => {
  const adapter = owner.runtime.model.adapter
  const failed = bodyError(owner, pattern)
  const base = {
    request: paused.request,
    requestBody: adapter.pausedRequestBody(obligation).pipe(Effect.mapError(failed))
  }
  switch (paused.phase) {
    case "request":
      return { ...base, phase: "request" }
    case "response":
      return {
        ...base,
        phase: "response",
        response: Option.getOrThrow(paused.response),
        responseBody: adapter.pausedResponseBody(obligation).pipe(Effect.mapError(failed))
      }
    case "auth":
      return {
        ...base,
        phase: "auth",
        // Schemes are case-insensitive, and Chromium lowercases them: so does every backend here
        challenge: Option.match(paused.challenge, {
          onNone: () => ({ origin: "", scheme: "", realm: "" }),
          onSome: (challenge) => ({ ...challenge, scheme: challenge.scheme.toLowerCase() })
        })
      }
  }
}

/** Registers a route for the caller's scope; removing it, or closing the scope, releases its intercept. */
export const register = <E, R, P extends Route.Phase>(
  owner: Owner,
  pattern: Url.Pattern | string,
  handler: Route.Handler<E, R, P>,
  phase: P
): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone, Scope.Scope | R> =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const adapter = owner.runtime.model.adapter
    const fail = (reason: Route.RouteErrorReason) =>
      new Route.RouteError({ pattern: pattern as Url.Pattern, reason, diagnostics: Operation.diagnostics(id) })
    const matches = yield* Effect.try({
      try: () => UrlPattern.compile(pattern),
      catch: (error) =>
        fail(
          new Reason.InvalidInput({
            input: "pattern",
            expected: "a glob such as https://*.example.com/api/**, a URLPattern, or a URL",
            hint: `${JSON.stringify(pattern)} doesn't compile: ${
              error instanceof Error ? error.message : String(error)
            }`
          })
        )
    })
    const context = yield* Effect.context<R>()
    const budget = yield* Effect.service(Deadline.DefaultBudget)
    const scope = yield* Scope.fork(yield* Effect.scope)
    yield* adapter.declare(owner.scope, { _tag: "Intercept", patterns: [covering(pattern)], phases: [phase] }).pipe(
      Scope.provide(scope),
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, owner.runtime.backend)
        // A target that went is TargetGone, as for every operation on it (QUIRKS.md, Q143)
        return mapped._tag === "Gone" ? mapped.error : fail(mapped.reason)
      }),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    const fibers = yield* FiberSet.make<Route.Decision<P>, E>().pipe(Scope.provide(scope))
    const hits = yield* SubscriptionRef.make(0)
    const route: Model.RouteEntry = {
      phase,
      matches,
      ask: Effect.fnUntraced(function*(obligation, paused) {
        yield* SubscriptionRef.update(hits, (count) => count + 1)
        const given = intercepted(owner, pattern, obligation, paused) as Route.Intercepted<P>
        const fiber = yield* FiberSet.run(fibers, Effect.provideContext(handler(given), context))
        const exit = yield* Fiber.await(fiber).pipe(Effect.timeoutOption(budget))
        const described =
          `${owner.operation}: the route ${pattern} didn't decide ${paused.request.method} ${paused.request.url}`
        const failed = (why: string, cause: Cause.Cause<unknown> = Cause.empty) =>
          Effect.as(Handlers.report(`${described}: ${why}, so it continues`, cause), { _tag: "Failed" } as const)
        if (Option.isNone(exit)) {
          yield* Fiber.interrupt(fiber)
          return yield* failed(`it took more than ${Duration.format(budget)}`)
        }
        if (Exit.isFailure(exit.value)) return yield* failed("it failed", exit.value.cause)
        const data = RouteDecision.data(exit.value.value)
        if (data === undefined) return yield* failed("it returned something that isn't a Route decision")
        if (data._tag === "Fallthrough") return { _tag: "Fallthrough" } as const
        if (!RouteDecision.phases[data._tag].includes(paused.phase)) {
          return yield* failed(`its decision, ${data._tag}, isn't one for the ${paused.phase} phase`)
        }
        const decision = yield* toAdapter(data, paused).pipe(Effect.provideContext(context), Effect.exit)
        if (Exit.isFailure(decision)) return yield* failed("its decision couldn't be made", decision.cause)
        return { _tag: "Decided", decision: decision.value } as const
      })
    }
    owner.routes.push(route)
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        const index = owner.routes.indexOf(route)
        if (index >= 0) owner.routes.splice(index, 1)
      })
    )
    const registration: Route.Registration = {
      remove: Scope.close(scope, Exit.void),
      hits: Watchable.make({
        ref: hits,
        project: Option.some,
        ended: () => Option.none(),
        target: owner.target,
        operation: `${owner.operation}.hits.waitFor`
      })
    }
    return registration
  }).pipe(
    Spans.operation(owner.operation, {
      attributes: {
        ...Spans.scopeAttributes(owner.scope),
        "browser.route.pattern": pattern,
        "browser.route.phase": phase
      }
    })
  )
