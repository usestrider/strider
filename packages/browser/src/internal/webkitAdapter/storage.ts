/**
 * Cookies on stock WebKit, read and removed through its pages: its inspector has no store of its own to ask.
 * Attached, every page is the browser's; launched, each context is a browser process of its own, whose cookies are
 * set through Automation.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as UserContext from "../../UserContext.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { automationOf, processOfContext } from "./automation.ts"
import { answered, contextOf, type PageEntry, type State, type TargetEntry } from "./state.ts"

// ── Through pages ─────────────────────────────────────────────────────────────────────────────────────────

/** The cookies each page's document can see, from each page's target, once each. */
const cookiesOf = Effect.fnUntraced(function*(pages: ReadonlyArray<PageEntry>) {
  const seen = new Map<string, Adapter.Cookie>()
  for (const page of pages) {
    if (page.target === undefined || page.ended) continue
    const reply = yield* answered(Page.getCookies().pipe(Protocol.on(page.target.session)))
    if (reply._tag === "None") continue
    for (const cookie of reply.value.cookies) {
      seen.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.session || cookie.expires < 0 ? Option.none() : Option.some(cookie.expires),
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: Option.some(cookie.sameSite as "Strict" | "Lax" | "None"),
        partitionKey: cookie.partitionKey === undefined || cookie.partitionKey === ""
          ? Option.none()
          : Option.some({ topLevelSite: cookie.partitionKey, crossSiteAncestor: Option.none() }),
        priority: Option.none()
      })
    }
  }
  return [...seen.values()]
})

/** Removes cookies through a page's target, each by a URL it's sent to. */
const deleteThrough = (target: TargetEntry, cookies: ReadonlyArray<Adapter.Cookie>) =>
  Effect.forEach(cookies, (cookie) => {
    const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
    return Kit.protocol(
      Page.deleteCookie({
        cookieName: cookie.name,
        url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`
      }).pipe(Protocol.on(target.session))
    )
  }, { discard: true })

// ── Attached ──────────────────────────────────────────────────────────────────────────────────────────────

const anyTarget = (state: State) =>
  Effect.suspend(() => {
    const page = [...state.pages.values()].find((each) => each.target !== undefined && !each.ended)
    return page === undefined
      ? Effect.fail(Kit.unsupported("cookies", "stock WebKit sets cookies through a page, and none is open"))
      : Effect.succeed(page.target!)
  })

export const cookiesAttached = (state: State, _id: UserContext.Id) => cookiesOf([...state.pages.values()])

export const setCookiesAttached = Effect.fnUntraced(function*(
  state: State,
  _id: UserContext.Id,
  list: ReadonlyArray<Adapter.Cookie>
) {
  const target = yield* anyTarget(state)
  for (const cookie of list) {
    yield* Kit.protocol(
      Page.setCookie({
        cookie: {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: Option.getOrElse(cookie.expires, () => -1),
          session: Option.isNone(cookie.expires),
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: Option.getOrElse(cookie.sameSite, () => "Lax")
        } as Page.Cookie
      }).pipe(Protocol.on(target.session))
    )
  }
})

export const clearCookiesAttached = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const target = yield* anyTarget(state)
  yield* deleteThrough(target, yield* cookiesAttached(state, id))
})

// ── Launched ──────────────────────────────────────────────────────────────────────────────────────────────

/** A context's pages: each context is a browser of its own. */
const pagesIn = (state: State, id: UserContext.Id) =>
  [...state.pages.values()].filter((page) => page.context.id === id && page.target !== undefined && !page.ended)

export const cookiesLaunched = (state: State, id: UserContext.Id) => cookiesOf(pagesIn(state, id))

/**
 * Set through Automation, on the process's anchor window: the inspector's `setCookie` ends the Automation session
 * (QUIRKS.md, Q230), and a context with no page open has its cookies set at once.
 */
export const setCookiesLaunched = Effect.fnUntraced(function*(
  state: State,
  id: UserContext.Id,
  list: ReadonlyArray<Adapter.Cookie>
) {
  const process = yield* processOfContext(state, yield* contextOf(state, id))
  for (const cookie of list) {
    const expires = Option.getOrUndefined(cookie.expires)
    yield* automationOf(
      process,
      Automation.addSingleCookie({
        browsingContextHandle: process.anchor,
        cookie: {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: expires ?? 0,
          size: cookie.name.length + Redacted.value(cookie.value).length,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          session: expires === undefined,
          sameSite: Option.getOrElse(cookie.sameSite, () => "Lax")
        }
      })
    )
  }
})

/** What the list shows, removed through a page: a context with none open lists none (QUIRKS.md, Q225). */
export const clearCookiesLaunched = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const page = pagesIn(state, id)[0]
  if (page === undefined) return
  yield* deleteThrough(page.target!, yield* cookiesLaunched(state, id))
})
