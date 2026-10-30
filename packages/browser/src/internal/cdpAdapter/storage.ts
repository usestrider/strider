/** A context's cookies and permissions on CDP: the `Storage` domain's cookies and `Browser.setPermission`. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowserCdp from "../../cdp/Browser.ts"
import * as Storage from "../../cdp/Storage.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { type ContextEntry, contextOf, type State } from "./state.ts"

const contextParam = (context: ContextEntry) =>
  context.browserContextId === undefined
    ? {}
    : { browserContextId: context.browserContextId as BrowserCdp.BrowserContextID }

export const cookies = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  const { cookies } = yield* Kit.protocol(Storage.getCookies(contextParam(context)).pipe(Protocol.on(state.root())))
  return cookies.map((cookie): Adapter.Cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.session || cookie.expires < 0 ? Option.none() : Option.some(cookie.expires),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite === "Strict"
      ? Option.some("Strict" as const)
      : cookie.sameSite === "Lax"
      ? Option.some("Lax" as const)
      : cookie.sameSite === "None"
      ? Option.some("None" as const)
      : Option.none(),
    partitionKey: cookie.partitionKey === undefined ? Option.none() : Option.some({
      topLevelSite: cookie.partitionKey.topLevelSite,
      crossSiteAncestor: Option.some(cookie.partitionKey.hasCrossSiteAncestor)
    }),
    priority: Option.fromUndefinedOr(cookie.priority as "Low" | "Medium" | "High" | undefined)
  }))
})

export const setCookies = Effect.fnUntraced(
  function*(state: State, id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
    const context = yield* contextOf(state, id)
    yield* Kit.protocol(
      Storage.setCookies({
        ...contextParam(context),
        cookies: list.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          ...(Option.isSome(cookie.expires) ? { expires: cookie.expires.value } : {}),
          ...(Option.isSome(cookie.sameSite) ? { sameSite: cookie.sameSite.value } : {}),
          ...(Option.isSome(cookie.partitionKey)
            ? {
              partitionKey: {
                topLevelSite: cookie.partitionKey.value.topLevelSite,
                hasCrossSiteAncestor: Option.getOrElse(cookie.partitionKey.value.crossSiteAncestor, () => false)
              }
            }
            : {}),
          ...(Option.isSome(cookie.priority) ? { priority: cookie.priority.value } : {})
        }))
      }).pipe(Protocol.on(state.root()))
    )
  }
)

export const clearCookies = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  yield* Kit.protocol(Storage.clearCookies(contextParam(context)).pipe(Protocol.on(state.root())))
})

export const grantPermissions = Effect.fnUntraced(function*(
  state: State,
  id: UserContext.Id,
  origin: Option.Option<string>,
  permissions: ReadonlyArray<string>
) {
  const context = yield* contextOf(state, id)
  // Web permission names, as the Permissions API writes them
  yield* Kit.protocol(Effect.forEach(permissions, (name) =>
    BrowserCdp.setPermission({
      ...contextParam(context),
      permission: { name },
      setting: "granted",
      ...(Option.isSome(origin) ? { origin: origin.value } : {})
    }).pipe(Protocol.on(state.root())), { discard: true }))
})

export const resetPermissions = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  yield* Kit.protocol(BrowserCdp.resetPermissions(contextParam(context)).pipe(Protocol.on(state.root())))
})
