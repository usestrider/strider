import * as Effect from "effect/Effect"
import * as net from "node:net"

/** An address for a navigation that must fail. */
export const navigationFailure = Effect.promise(() =>
  new Promise<string>((resolve) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(`http://127.0.0.1:${port}`))
    })
  })
)
