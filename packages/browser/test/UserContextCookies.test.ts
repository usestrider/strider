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
      const cookies = yield* context.cookies.list
      assert.deepStrictEqual(cookies.map((c) => [c.name, Redacted.value(c.value), c.domain, c.path]).sort(), [
        ["alive", "yes", "app.example.com", "/app"],
        ["default", "value", "app.example.com", "/app"],
        ["same", "app", "app.example.com", "/app"],
        ["same", "root", "app.example.com", "/"]
      ])
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
