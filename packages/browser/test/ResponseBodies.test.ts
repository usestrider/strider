/** Response body subscriptions without a browser: collection ends with borrowed inspect access. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkResponse, Page, Target, Url } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Access from "../src/internal/access.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Events from "../src/internal/events.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Model from "../src/internal/model.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const hop = "request.0" as never
const response = new NetworkResponse.NetworkResponse({
  hop,
  url: "https://example.test/data" as Url.Url,
  status: 200 as NetworkResponse.StatusCode,
  statusText: "OK",
  httpVersion: Option.none(),
  headers: Headers.empty,
  servedBy: "network",
  at: 0 as NetworkResponse.NetworkResponse["at"]
})

const setup = (body: Effect.Effect<unknown, never>, grant: Option.Option<Access.Grant>) => {
  const channel = Events.make<Model.ResponseEvent>({ _tag: "Browser" }, () => 10)
  const declarations: Array<Adapter.Declaration> = []
  let released = 0
  const page = {} as Page.ReadonlyPage
  const adapter = {
    declare: Effect.fnUntraced(function*(_scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      declarations.push(declaration)
      yield* Effect.addFinalizer(() => Effect.sync(() => void released++))
      return "registration" as Adapter.RegistrationId
    }),
    responseBody: () => body
  }
  Handles.registerPage(page, {
    grant,
    entry: { id: "page" as Target.NavigableId, events: { response: channel } } as Model.PageEntry,
    runtime: { backend: "test", model: { adapter } } as unknown as Runtime.Runtime
  })
  const publish = Effect.gen(function*() {
    const end = yield* Deferred.make<Model.HopEnd>()
    yield* Deferred.succeed(end, { _tag: "Finished", encodedBytes: 1 } as Model.HopEnd)
    Events.publish(channel, { response, hop: { request: { method: "GET" }, end } as unknown as Model.HopEntry })
  })
  return { page, publish, declarations, released: () => released }
}

const bytes = Effect.succeed(new TextEncoder().encode("owned"))

describe("NetworkResponse body subscriptions and borrowed access", () => {
  it.live("releases body collection with borrowed inspect access and refuses an expired grant", () =>
    Effect.scoped(Effect.gen(function*() {
      const accessScope = yield* Scope.make()
      const grant = yield* Access.acquire("inspect", { _tag: "Browser" }).pipe(Scope.provide(accessScope))
      const world = setup(bytes, Option.some(grant))
      const wait = yield* NetworkResponse.next(world.page, { body: (message) => message.text })
      yield* world.publish
      const captured = yield* wait
      yield* Scope.close(accessScope, yield* Effect.exit(Effect.void))
      assert.strictEqual(world.released(), 1)
      assert.deepStrictEqual(captured.body, "owned")
      const error = yield* NetworkResponse.next(world.page, { body: (message) => message.text }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "TargetGone")
      assert.strictEqual(world.declarations.length, 1)
    })))

  it.live("interrupts an outstanding body read when borrowed inspect access is released", () =>
    Effect.scoped(Effect.gen(function*() {
      const accessScope = yield* Scope.make()
      const grant = yield* Access.acquire("inspect", { _tag: "Browser" }).pipe(Scope.provide(accessScope))
      const started = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const world = setup(
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(cancelled, undefined))
        ),
        Option.some(grant)
      )
      yield* NetworkResponse.next(world.page, { body: (message) => message.text }).pipe(Effect.asVoid)
      yield* world.publish
      yield* Deferred.await(started)
      yield* Scope.close(accessScope, yield* Effect.exit(Effect.void))
      yield* Deferred.await(cancelled).pipe(Effect.timeout("500 millis"))
    })))
})
