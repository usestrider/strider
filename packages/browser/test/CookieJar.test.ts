/** Which cookies `CookieJar.listFor` says a request to a URL sends. */
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"

const sentOver = (host: string) =>
  Effect.scoped(Effect.gen(function*() {
    const context = yield* Browser.newContext()
    const jar = context.cookies
    yield* jar.set({ name: "secure", value: "1", scope: { url: `https://${host}/` }, secure: true })
    yield* jar.set({ name: "plain", value: "1", scope: { url: `https://${host}/` } })
    const sent = yield* jar.listFor(`http://${host}:8080/`)
    return sent.map((cookie) => cookie.name).sort()
  })).pipe(Effect.provide(Browser.layerTest("")))

describe("CookieJar.listFor", () => {
  // Browsers treat these hosts as secure contexts, and send Secure cookies to them over http
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]"]) {
    it.effect(`includes a Secure cookie over http on ${host}`, () =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* sentOver(host), ["plain", "secure"])
      }))
  }

  for (const host of ["example.com", "localhost.example.com", "128.0.0.1"]) {
    it.effect(`leaves out a Secure cookie over http on ${host}`, () =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* sentOver(host), ["plain"])
      }))
  }
})
