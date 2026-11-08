import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as http from "node:http"
import { proxy } from "./integration/adapter/proxy.ts"

it.effect("refuses CONNECT destinations outside the fixture's proxy.test hostname", () =>
  Effect.gen(function*() {
    const local = yield* proxy()
    const port = Number(local.address.split(":")[1])
    const status = yield* Effect.callback<number>((resume) => {
      const request = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: local.address })
      request.on("connect", (response, socket) => {
        socket.destroy()
        resume(Effect.succeed(response.statusCode!))
      })
      request.on("error", (error) => resume(Effect.die(error)))
      request.end()
      return Effect.sync(() => request.destroy())
    })
    assert.strictEqual(status, 502)
  }))
