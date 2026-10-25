/**
 * Cookies and origin storage (review 18, candidate 6). Cookies are a context's, through the adapter; origin
 * storage is a document's, read and written from the caller's isolated world, which shares the page's storage
 * (P6). A change acts once: a scope doesn't undo it.
 *
 * - **A cookie's `sameSite`** is `None` where the cookie didn't say, since the browsers' defaults differ; WebKit
 *   reports `Lax` for it (P5). `priority` is Chromium's alone, and only CDP reports a partition.
 * - **`remove`** sets each match again with an expiry in the past, which every backend removes (P5).
 * - **`listFor`** filters the context's cookies as a top-level request to the URL would send them: by domain, path,
 *   `Secure` and expiry, and a partitioned cookie only in its own top-level site.
 */
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as CookieJar from "../CookieJar.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as OriginStorage from "../OriginStorage.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

// ── Cookies ───────────────────────────────────────────────────────────────────────────────────────────────

const cookieError = (operation: string, reason: CookieJar.CookieJarErrorReason, id: Diagnostics.OperationId) =>
  new CookieJar.CookieJarError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** An adapter's failure, as a cookie jar's: a context that ended is the backend refusing. */
const cookieFailure = (runtime: Runtime.Runtime, operation: string, id: Diagnostics.OperationId) =>
(
  error: Adapter.AdapterError
) => {
  const mapped = Operation.fromAdapter(error, id, runtime.backend)
  return cookieError(
    operation,
    mapped._tag === "Reason"
      ? mapped.reason
      : new Reason.BackendFailure({ kind: "Rejected", method: operation, metadata: {}, hint: mapped.error.message }),
    id
  )
}

/** A cookie as the adapter has it, as the `Cookie` schema says it. */
export const fromAdapter = (cookie: Adapter.Cookie): CookieJar.Cookie =>
  new CookieJar.Cookie({
    name: CookieJar.Name.make(cookie.name),
    value: cookie.value,
    domain: CookieJar.Domain.make(cookie.domain),
    path: cookie.path,
    expires: Option.map(cookie.expires, (seconds) => DateTime.makeUnsafe(seconds * 1000)),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: Option.map(cookie.sameSite, (value) => value.toLowerCase() as "strict" | "lax" | "none"),
    partitionKey: Option.match(cookie.partitionKey, {
      onNone: () => ({ _tag: "Unpartitioned" }) as const,
      onSome: (key) =>
        ({
          _tag: "Partitioned",
          topLevelSite: Url.Site.make(key.topLevelSite),
          crossSiteAncestor: key.crossSiteAncestor
        }) as const
    }),
    priority: Option.map(cookie.priority, (value) => value.toLowerCase() as "low" | "medium" | "high")
  })

const capitalized = <A extends string>(value: A) => `${value[0]!.toUpperCase()}${value.slice(1)}` as Capitalize<A>

/** A `Cookie` as the adapter takes it. */
export const toAdapter = (cookie: CookieJar.Cookie): Adapter.Cookie => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain,
  path: cookie.path,
  expires: Option.map(cookie.expires, (when) => DateTime.toEpochMillis(when) / 1000),
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  sameSite: Option.map(cookie.sameSite, capitalized),
  partitionKey: cookie.partitionKey._tag === "Partitioned"
    ? Option.some({
      topLevelSite: cookie.partitionKey.topLevelSite,
      crossSiteAncestor: cookie.partitionKey.crossSiteAncestor
    })
    : Option.none(),
  priority: Option.map(cookie.priority, capitalized)
})

/** RFC 6265's default path: the URL's path up to its last `/`. */
const defaultPath = (pathname: string) => {
  if (!pathname.startsWith("/")) return "/"
  const last = pathname.lastIndexOf("/")
  return last <= 0 ? "/" : pathname.slice(0, last)
}

/** A cookie to set, as the adapter takes it, or why it can't be one. */
const fromInput = (input: CookieJar.Input): Adapter.Cookie | Reason.InvalidInput => {
  const invalid = (field: string, expected: string, hint: string) =>
    new Reason.InvalidInput({ input: field, expected, hint })
  if (input.name === "" || /[\s;=,]/.test(input.name)) {
    return invalid("name", "a cookie name, without whitespace, ;, = or ,", `${JSON.stringify(input.name)} isn't one`)
  }
  const value = Redacted.isRedacted(input.value) ? input.value : Redacted.make(input.value)
  if (/[;\r\n]/.test(Redacted.value(value))) {
    return invalid("value", "a cookie value, without ; or a line break", "It has one")
  }
  let domain: string
  let path: string
  if (input.scope._tag === "Url") {
    let url: URL
    try {
      url = new URL(input.scope.url)
    } catch {
      return invalid("scope", "an absolute URL", `${JSON.stringify(input.scope.url)} doesn't parse`)
    }
    domain = url.hostname
    path = defaultPath(url.pathname)
  } else {
    domain = input.scope.domain
    path = input.scope.path
    if (domain === "" || !path.startsWith("/")) {
      return invalid("scope", "a domain and a path starting with /", `${domain}${path} isn't one`)
    }
  }
  let expires = Option.none<number>()
  if (input.expires !== undefined) {
    const when = DateTime.make(input.expires)
    if (Option.isNone(when)) return invalid("expires", "a date", "It isn't one")
    expires = Option.some(DateTime.toEpochMillis(when.value) / 1000)
  }
  const partition = input.partitionKey
  return {
    name: input.name,
    value,
    domain,
    path,
    expires,
    httpOnly: input.httpOnly ?? false,
    secure: input.secure ?? false,
    sameSite: Option.some(capitalized(input.sameSite ?? "lax")),
    partitionKey: partition === undefined || partition._tag === "Unpartitioned"
      ? Option.none()
      : Option.some({ topLevelSite: partition.topLevelSite, crossSiteAncestor: partition.crossSiteAncestor }),
    priority: Option.none()
  }
}

/** Whether a host is in a cookie's domain: the domain itself, or under it for a domain cookie. */
const domainMatches = (host: string, domain: string) =>
  domain.startsWith(".") ? host === domain.slice(1) || host.endsWith(domain) : host === domain

/** RFC 6265's path-match. */
const pathMatches = (requestPath: string, cookiePath: string) =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) && (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"))

/** Whether a top-level request to `url` sends the cookie. */
const sends = (url: URL, cookie: CookieJar.Cookie, now: number) => {
  if (!domainMatches(url.hostname, cookie.domain)) return false
  if (!pathMatches(url.pathname === "" ? "/" : url.pathname, cookie.path)) return false
  if (cookie.secure && url.protocol !== "https:" && url.protocol !== "wss:") return false
  if (Option.isSome(cookie.expires) && DateTime.toEpochMillis(cookie.expires.value) <= now) return false
  if (cookie.partitionKey._tag === "Partitioned") {
    // A partitioned cookie is sent only in its own top-level site, which a top-level request is in
    const site = new URL(cookie.partitionKey.topLevelSite)
    return url.protocol === site.protocol &&
      (url.hostname === site.hostname || url.hostname.endsWith(`.${site.hostname}`))
  }
  return true
}

/** A context's cookies. */
export const cookieJar = (runtime: Runtime.Runtime, context: UserContext.Id): CookieJar.CookieJar => {
  const adapter = runtime.model.adapter
  const list = (operation: string, id: Diagnostics.OperationId) =>
    adapter.cookies(context).pipe(
      Effect.map((cookies) => cookies.map(fromAdapter)),
      Effect.mapError(cookieFailure(runtime, operation, id))
    )
  const attributes = { attributes: { "browser.context.id": context } }
  const span = (operation: string) => Spans.operation(operation, attributes)
  return {
    get list() {
      return Effect.suspend(() => list("CookieJar.list", Operation.operationId())).pipe(span("CookieJar.list"))
    },
    listFor: Spans.fn("CookieJar.listFor", attributes)(function*(url: Url.Url | string) {
      const id = Operation.operationId()
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return yield* Effect.fail(cookieError(
          "CookieJar.listFor",
          new Reason.InvalidInput({
            input: "url",
            expected: "an absolute URL",
            hint: `${JSON.stringify(url)} doesn't parse`
          }),
          id
        ))
      }
      const now = Date.now()
      return (yield* list("CookieJar.listFor", id)).filter((cookie) => sends(parsed, cookie, now))
    }),
    set: Spans.fn("CookieJar.set", attributes)(function*(input: CookieJar.Input) {
      const id = Operation.operationId()
      const cookie = fromInput(input)
      if (cookie instanceof Reason.InvalidInput) return yield* Effect.fail(cookieError("CookieJar.set", cookie, id))
      if (Option.isSome(cookie.partitionKey)) yield* requirePartitions(runtime, "CookieJar.set", id)
      yield* adapter.setCookies(context, [cookie]).pipe(Effect.mapError(cookieFailure(runtime, "CookieJar.set", id)))
    }),
    remove: Spans.fn("CookieJar.remove", attributes)(function*(match: CookieJar.Match) {
      const id = Operation.operationId()
      const matching = (yield* adapter.cookies(context).pipe(
        Effect.mapError(cookieFailure(runtime, "CookieJar.remove", id))
      )).filter((cookie) =>
        cookie.name === match.name &&
        (match.domain === undefined || cookie.domain === match.domain || cookie.domain === `.${match.domain}`) &&
        (match.path === undefined || cookie.path === match.path)
      )
      if (matching.length === 0) return
      // An expiry in the past removes it on every backend (P5)
      yield* adapter.setCookies(
        context,
        matching.map((cookie) => ({ ...cookie, value: Redacted.make(""), expires: Option.some(1) }))
      ).pipe(Effect.mapError(cookieFailure(runtime, "CookieJar.remove", id)))
    }),
    get clear() {
      return Effect.suspend(() => {
        const id = Operation.operationId()
        return adapter.clearCookies(context).pipe(Effect.mapError(cookieFailure(runtime, "CookieJar.clear", id)))
      }).pipe(span("CookieJar.clear"))
    }
  }
}

/** Fails with `Unsupported` where the backend can't set a partitioned cookie (`cookies.partitioned`). */
const requirePartitions = (runtime: Runtime.Runtime, operation: string, id: Diagnostics.OperationId) =>
  Effect.flatMap(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === "cookies.partitioned")
    return entry === undefined || entry.status !== "unsupported" ? Effect.void : Effect.fail(cookieError(
      operation,
      new Reason.Unsupported({
        capability: "cookies.partitioned",
        backend: runtime.backend,
        hint: entry.limitations.join("; ") || `${runtime.backend} can't set a partitioned cookie`
      }),
      id
    ))
  })

// ── Origin storage ────────────────────────────────────────────────────────────────────────────────────────

const storageError = (operation: string, reason: OriginStorage.OriginStorageErrorReason, id: Diagnostics.OperationId) =>
  new OriginStorage.OriginStorageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** An evaluation's failure, as origin storage's: what the page threw is the browser refusing. */
const storageFailure = (operation: string, id: Diagnostics.OperationId) =>
(
  failure: Evaluation.Failure
): OriginStorage.OriginStorageError | Target.TargetGone => {
  if (failure._tag === "Gone") return failure.error
  if (failure._tag === "Deadline") {
    return storageError(
      operation,
      new Reason.BackendFailure({
        kind: "Rejected",
        method: operation,
        metadata: {},
        hint: "The page didn't answer before the deadline"
      }),
      id
    )
  }
  const reason = failure.reason
  if (reason._tag === "EvaluationThrown") {
    const { message, name } = reason.exception
    if (name === "QuotaExceededError") {
      return storageError(
        operation,
        new Reason.InvalidInput({ input: "value", expected: "a value the origin's quota holds", hint: message }),
        id
      )
    }
    return storageError(
      operation,
      new Reason.BackendFailure({
        kind: "Rejected",
        method: operation,
        metadata: {},
        hint: name === "SecurityError"
          ? `The document's origin has no storage, as an opaque one hasn't (${message})`
          : `${name}: ${message}`
      }),
      id
    )
  }
  return storageError(
    operation,
    reason._tag === "Unsupported" || reason._tag === "BackendFailure"
      ? reason
      : new Reason.BackendFailure({ kind: "Rejected", method: operation, metadata: {}, hint: reason.message }),
    id
  )
}

/** One area of the page's current document's origin storage, from the isolated world (P6). */
export const originStorage = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  area: "local" | "session"
): OriginStorage.OriginStorage => {
  const name = area === "local" ? "localStorage" : "sessionStorage"
  const run = <A>(member: string, fn: string, args: ReadonlyArray<string>, decode: (value: unknown) => A) => {
    const operation = `Page.${name}.${member}`
    return Effect.gen(function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      return yield* Effect.gen(function*() {
        const realm = yield* Evaluation.pageRealm(runtime, page, Evaluation.isolatedWorld, id, budget.at)
        const value = yield* Evaluation.call(runtime, {
          realm,
          functionDeclaration: fn,
          arguments: [area, ...args].map((arg) => ({ _tag: "Value", value: { type: "string", value: arg } })),
          result: "value",
          userActivation: false,
          page: Option.some(page),
          at: budget.at,
          id
        })
        return decode(yield* Evaluation.fromRemote(value))
      }).pipe(Effect.mapError(storageFailure(operation, id)))
    }).pipe(Spans.operation(operation, { attributes: { "browser.page.id": page.id } }))
  }
  const areaOf = `(area) => area === "local" ? localStorage : sessionStorage`
  return {
    get entries() {
      return run(
        "entries",
        `(area) => { const storage = (${areaOf})(area); const out = []; for (let i = 0; i < storage.length; i++) { const key = storage.key(i); out.push([key, storage.getItem(key)]) } return out }`,
        [],
        (value) => value as ReadonlyArray<readonly [string, string]>
      )
    },
    get: (key) =>
      run(
        "get",
        `(area, key) => (${areaOf})(area).getItem(key)`,
        [key],
        (value) => Option.fromNullishOr(value as string | null)
      ),
    // A `Redacted` value is written as its value, and never logged: the span has the key alone
    set: (key, value) =>
      run(
        "set",
        `(area, key, value) => { (${areaOf})(area).setItem(key, value) }`,
        [key, Redacted.isRedacted(value) ? Redacted.value(value) : value],
        () => undefined
      ),
    remove: (key) => run("remove", `(area, key) => { (${areaOf})(area).removeItem(key) }`, [key], () => undefined),
    get clear() {
      return run("clear", `(area) => { (${areaOf})(area).clear() }`, [], () => undefined)
    }
  }
}
