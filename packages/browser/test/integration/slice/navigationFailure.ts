import * as Effect from "effect/Effect"
import * as http from "node:http"
import type * as net from "node:net"

/** Own the address until scope closure; every request ends without an HTTP response. */
export const navigationFailure = Effect.acquireRelease(
  Effect.promise(() =>
    new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer((request) => request.destroy())
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject)
        resolve(server)
      })
    })
  ),
  (server) =>
    Effect.promise(() =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    )
).pipe(Effect.map((server) => ({
  origin: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
  server
})))
