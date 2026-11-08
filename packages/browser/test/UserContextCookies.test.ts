import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Redacted from "effect/Redacted"
import { Browser, UserContext } from "../src/index.ts"

const origin = "https://app.example.com"
const response = (request: HttpClientRequest.HttpClientRequest, cookies: ReadonlyArray<string>, status = 200) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(null, {
      status,
      headers: [...cookies.map((value) => ["set-cookie", value] as [string, string]), [
        "location",
        `${origin}/app/next`
      ]]
    })
  )

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(Browser.layerTest("")))

describe("UserContext.withCookies", () => {
  it.effect("adds URL-filtered httpOnly cookies alongside explicit cookies, preserving repeated names", () =>
    run(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      for (
        const [name, value, path, secure] of [["session", "root", "/", false], ["session", "app", "/app", false], [
          "elsewhere",
          "no",
          "/other",
          false
        ], ["tls", "no", "/", true]] as const
      ) {
        yield* context.cookies.set({
          name,
          value,
          scope: { _tag: "Domain", domain: "app.example.com", path },
          httpOnly: true,
          secure
        })
      }
      const seen: Array<string | undefined> = []
      const client = HttpClient.make((request) => {
        seen.push(request.headers.cookie)
        return Effect.succeed(response(request, []))
      })
      yield* client.get(`${origin}/app/page`)
      assert.deepStrictEqual(seen, [undefined])
      yield* UserContext.withCookies(client, context).execute(
        HttpClientRequest.get("http://app.example.com/app/page").pipe(
          HttpClientRequest.setHeader("cookie", "explicit=yes")
        )
      )
      const sent = seen[1]!.split("; ").sort()
      assert.deepStrictEqual(sent, ["explicit=yes", "session=app", "session=root"])
      const other = yield* Browser.newContext()
      yield* client.pipe(UserContext.withCookies(other)).get(`${origin}/app/page`)
      assert.isUndefined(seen[2])
    })))

  it.effect("stores every response cookie before returning, applies defaults and Max-Age precedence", () =>
    run(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const client = UserContext.withCookies(
        HttpClient.make((request) =>
          Effect.succeed(response(request, [
            "same=root; Path=/; HttpOnly",
            "same=app; Path=/app",
            "default=value",
            "deleted=no; Path=/; Max-Age=0; Expires=Wed, 01 Jan 2099 00:00:00 GMT",
            "past=no; Expires=Thu, 01 Jan 1970 00:00:01 GMT",
            "alive=yes; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:01 GMT"
          ]))
        ),
        context
      )
      yield* client.get(`${origin}/app/login`)
      const cookies = yield* context.cookies.listFor(`${origin}/app/page`)
      assert.deepStrictEqual(cookies.map((c) => [c.name, Redacted.value(c.value), c.domain, c.path]).sort(), [
        ["alive", "yes", "app.example.com", "/app"],
        ["default", "value", "app.example.com", "/app"],
        ["same", "app", "app.example.com", "/app"],
        ["same", "root", "app.example.com", "/"]
      ])
    })))

  it.effect("keeps cookie failures typed and skips transport after a failed read", () =>
    run(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const original = yield* context.cookies.listFor("invalid").pipe(Effect.flip)
      let calls = 0
      const client = HttpClient.make((request) => {
        calls++
        return Effect.succeed(response(request, ["saved=yes"]))
      })
      const readFailure = { ...context, cookies: { ...context.cookies, listFor: () => Effect.fail(original) } }
      assert.strictEqual(yield* UserContext.withCookies(client, readFailure).get(origin).pipe(Effect.flip), original)
      assert.strictEqual(calls, 0)
      const writeFailure = { ...context, cookies: { ...context.cookies, set: () => Effect.fail(original) } }
      assert.strictEqual(yield* UserContext.withCookies(client, writeFailure).get(origin).pipe(Effect.flip), original)
      assert.strictEqual(calls, 1)
    })))

  it.effect("does no cookie work until execution and leaves other contexts untouched", () =>
    run(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      let reads = 0
      let writes = 0
      const selected = {
        ...context,
        cookies: {
          ...context.cookies,
          listFor: (url: string) =>
            Effect.suspend(() => {
              reads++
              return context.cookies.listFor(url)
            }),
          set: (cookie: Parameters<typeof context.cookies.set>[0]) =>
            Effect.suspend(() => {
              writes++
              return context.cookies.set(cookie)
            })
        }
      }
      const base = HttpClient.make((request) =>
        Effect.succeed(response(request, ["value=hello%20world; Path=/", "foreign=no; Domain=other.example.com"]))
      )
      const wrapped = base.pipe(UserContext.withCookies(selected))
      assert.strictEqual(reads, 0)
      assert.strictEqual(writes, 0)
      yield* base.get(origin)
      assert.strictEqual(reads, 0)
      assert.strictEqual(writes, 0)
      yield* wrapped.get(origin)
      assert.strictEqual(reads, 1)
      assert.strictEqual(writes, 1)
      const cookies = yield* context.cookies.listFor(origin)
      assert.strictEqual(Redacted.value(cookies[0].value), "hello%20world")
    })))

  it.effect("stores redirect cookies before sending the next hop", () =>
    run(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      let calls = 0
      const client = HttpClient.make((request) => {
        calls++
        if (calls === 1) return Effect.succeed(response(request, ["login=yes; Path=/"], 302))
        assert.strictEqual(request.headers.cookie, "login=yes")
        return Effect.succeed(response(request, []))
      }).pipe(UserContext.withCookies(context), HttpClient.followRedirects())
      yield* client.get(`${origin}/login`)
      assert.strictEqual(calls, 2)
    })))
})
