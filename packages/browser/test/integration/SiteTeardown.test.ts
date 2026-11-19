/**
 * The adapter suite's site closes with its scope, whatever its WebSocket clients left open.
 */
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as net from "node:net"
import { site } from "./adapter/harness.ts"

// Upgrades `/ws` on a raw socket and resolves once the site has switched protocols.
const upgraded = (origin: string) =>
  new Promise<net.Socket>((resolve, reject) => {
    const { port } = new URL(origin)
    const socket = net.connect(Number(port), "127.0.0.1", () => {
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
      )
    })
    socket.once("data", (data) =>
      data.toString().startsWith("HTTP/1.1 101") ? resolve(socket) : reject(new Error(data.toString())))
    socket.once("error", reject)
  })

it("closes with its scope after a WebSocket client leaves without a close frame", async () => {
  const scope = Effect.runSync(Scope.make())
  const { origin } = await Effect.runPromise(Scope.provide(site, scope))
  const socket = await upgraded(origin)
  // A tunnel cut under the socket: the site sees FIN, and no close frame
  socket.destroy()
  const closed = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => "closed" as const)
  const deadline = new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 1000))
  assert.strictEqual(await Promise.race([closed, deadline]), "closed")
})
