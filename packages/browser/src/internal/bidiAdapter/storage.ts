/**
 * Cookies and permissions on BiDi. A user context's cookies are its storage partition's; permissions are granted
 * per origin, and since BiDi has no reset, the ones granted are remembered and set back to `prompt`.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Permissions from "../../bidi-protocol/Permissions.ts"
import * as Storage from "../../bidi-protocol/Storage.ts"
import type * as UserContext from "../../UserContext.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { bytesOf } from "./mapping.ts"
import { type ContextEntry, contextOf, type State } from "./state.ts"

const partition = (context: ContextEntry): Storage.PartitionDescriptor => ({
  type: "storageKey",
  userContext: context.bidi
})

export const cookies = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  const { cookies } = yield* Kit.protocol(state.send(Storage.getCookies({ partition: partition(context) })))
  return yield* Effect.forEach(
    cookies,
    (cookie) =>
      Effect.map(bytesOf(Redacted.value(cookie.value), "storage.getCookies"), (value): Adapter.Cookie => ({
        name: cookie.name,
        value: Redacted.make(new TextDecoder().decode(value)),
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expiry === undefined ? Option.none() : Option.some(cookie.expiry),
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === "strict"
          ? Option.some("Strict" as const)
          : cookie.sameSite === "lax"
          ? Option.some("Lax" as const)
          : cookie.sameSite === "none"
          ? Option.some("None" as const)
          : Option.none(),
        partitionKey: Option.none(),
        priority: Option.none()
      }))
  )
})

export const setCookies = Effect.fnUntraced(
  function*(state: State, id: UserContext.Id, list: ReadonlyArray<Adapter.Cookie>) {
    const context = yield* contextOf(state, id)
    if (list.some((cookie) => Option.isSome(cookie.partitionKey))) {
      return yield* Effect.fail(
        Kit.unsupported("cookies.partitioned", "Firefox doesn't say which partition a cookie is in")
      )
    }
    yield* Kit.protocol(Effect.forEach(list, (cookie) =>
      state.send(Storage.setCookie({
        cookie: {
          name: cookie.name,
          value: Redacted.make({ type: "string", value: Redacted.value(cookie.value) }),
          domain: cookie.domain,
          path: cookie.path,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          ...(Option.isSome(cookie.sameSite) ? { sameSite: sameSite[cookie.sameSite.value] } : {}),
          ...(Option.isSome(cookie.expires) ? { expiry: Math.round(cookie.expires.value) } : {})
        },
        partition: partition(context)
      })), { discard: true }))
  }
)

const sameSite = { Strict: "strict", Lax: "lax", None: "none" } as const

export const clearCookies = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  yield* Kit.protocol(state.send(Storage.deleteCookies({ partition: partition(context) })))
})

const setPermission = (
  state: State,
  context: ContextEntry,
  origin: string,
  name: string,
  setting: "granted" | "prompt"
) =>
  state.send(Permissions.setPermission({
    descriptor: { name },
    state: setting,
    origin,
    ...(context.bidi === "default" ? {} : { userContext: context.bidi })
  }))

export const grantPermissions = Effect.fnUntraced(function*(
  state: State,
  id: UserContext.Id,
  origin: Option.Option<string>,
  permissions: ReadonlyArray<string>
) {
  const context = yield* contextOf(state, id)
  if (Option.isNone(origin)) {
    return yield* Effect.fail(
      Kit.unsupported("permissions.anyOrigin", "WebDriver BiDi grants a permission to one origin")
    )
  }
  for (const name of permissions) {
    yield* Kit.protocol(setPermission(state, context, origin.value, name, "granted"))
    const set = state.granted.get(id) ?? new Set()
    set.add(JSON.stringify([origin.value, name]))
    state.granted.set(id, set)
  }
})

export const resetPermissions = Effect.fnUntraced(function*(state: State, id: UserContext.Id) {
  const context = yield* contextOf(state, id)
  for (const entry of state.granted.get(id) ?? []) {
    const [origin, name] = JSON.parse(entry) as [string, string]
    yield* Kit.protocol(setPermission(state, context, origin, name, "prompt"))
  }
  state.granted.delete(id)
})
