/** Startup failure reporting by the stock WebKit test helper. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, layer } from "@effect/vitest"
import { Ledger } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as fs from "node:fs"
import * as http from "node:http"
import * as net from "node:net"
import { startMiniBrowserOnPort } from "./stockWebKit.ts"

layer(NodeServices.layer, { excludeTestServices: true })((it) => {
  it.effect("reports an occupied inspector port before the test deadline", () =>
    Effect.gen(function*() {
      const server = yield* Effect.acquireRelease(
        Effect.callback<net.Server>((resume) => {
          const server = net.createServer((socket) => socket.destroy())
          server.once("error", (error) => resume(Effect.die(error)))
          server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
        }),
        (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
      )
      const port = (server.address() as net.AddressInfo).port
      const launched: Array<Ledger.Item> = []
      const exit = yield* startMiniBrowserOnPort(port, "about:blank").pipe(
        Effect.provideService(Ledger.CurrentLedger, {
          add: (item) =>
            Effect.sync(() => {
              launched.push(item)
            }),
          remove: () => Effect.void
        }),
        Effect.scoped,
        Effect.exit
      )
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        assert.instanceOf(error, Error)
        assert.include((error as Error).message, "address already in use")
        assert.include((error as Error).message, String(port))
      }
      assert.lengthOf(launched, 2, "both Xvfb and MiniBrowser started")
      for (const item of launched) {
        if (item._tag !== "Browser") continue
        assert.throws(() => process.kill(item.pid, 0), /ESRCH/, "the child has exited")
        assert.isFalse(fs.existsSync(item.profile), "the temporary directory has been removed")
      }
      assert.isTrue(server.listening, "the foreign listener belongs to the caller")
    }).pipe(Effect.scoped))

  // Another MiniBrowser's inspector on the port answers discovery with its own pages, before WebKit reports that
  // the port is taken, so the helper must not take that list for the browser it started.
  it.effect("reports an occupied inspector port that another inspector answers", () =>
    Effect.gen(function*() {
      const server = yield* Effect.acquireRelease(
        Effect.callback<http.Server>((resume) => {
          const server = http.createServer((_, response) =>
            response.end("<script>new WebSocket('ws://' + window.location.host + '/socket/1/1/WebPage')</script>")
          )
          server.once("error", (error) => resume(Effect.die(error)))
          server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
        }),
        (server) =>
          Effect.promise(() =>
            new Promise<void>((resolve) => {
              server.closeAllConnections()
              server.close(() => resolve())
            })
          )
      )
      const port = (server.address() as net.AddressInfo).port
      const exit = yield* startMiniBrowserOnPort(port, "about:blank").pipe(
        Effect.provideService(Ledger.CurrentLedger, { add: () => Effect.void, remove: () => Effect.void }),
        Effect.scoped,
        Effect.exit
      )
      assert.isTrue(Exit.isFailure(exit), "the foreign inspector's pages are not the MiniBrowser's")
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        assert.include((error as Error).message, "address already in use")
        assert.include((error as Error).message, String(port))
      }
    }).pipe(Effect.scoped))
})
