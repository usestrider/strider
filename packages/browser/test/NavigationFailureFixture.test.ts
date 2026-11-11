import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as http from "node:http"
import { navigationFailure } from "./integration/slice/navigationFailure.ts"

const claim = (origin: string) =>
  new Promise<string>((resolve, reject) => {
    const server = http.createServer((_request, response) => response.end("another listener answered"))
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(error.code)
      else reject(error)
    })
    server.listen(Number(new URL(origin).port), "127.0.0.1", () => {
      http.get(origin, (response) => {
        let body = ""
        response.on("data", (chunk) => body += chunk)
        response.on("end", () => server.close(() => resolve(body)))
      }).on("error", (error) => server.close(() => reject(error)))
    })
  })

it.effect("owns the failure address until its scope closes", () =>
  Effect.gen(function*() {
    let closed = false
    const server = yield* Effect.scoped(Effect.gen(function*() {
      const { origin, server } = yield* navigationFailure
      assert.isTrue(server.listening)
      server.once("close", () => {
        closed = true
      })
      assert.strictEqual(yield* Effect.promise(() => claim(origin)), "EADDRINUSE")
      const failure = yield* Effect.promise(() =>
        new Promise<string>((resolve, reject) => {
          http.get(origin, (response) => {
            response.resume()
            reject(new Error(`Unexpected HTTP response: ${response.statusCode}`))
          }).on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
        })
      )
      assert.strictEqual(failure, "ECONNRESET")
      return server
    }))
    assert.isTrue(closed)
    assert.isFalse(server.listening)
  }))
