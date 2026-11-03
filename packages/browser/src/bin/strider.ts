#!/usr/bin/env node
/**
 * The `strider` command (CLI.md). It runs on Node, or Bun's Node compatibility, through `@effect/platform-node`, an
 * optional peer dependency that only the command needs: a program that launches a browser on Node provides it already. `__daemon` is a session's
 * daemon, which `strider start` starts; everything else is `internal/cli.ts`'s.
 *
 * @since 0.1.0
 */
import * as Node from "../internal/cli/node.ts"

const process = Node.process
const argv = process.argv.slice(2)
const bin = new URL(import.meta.url).pathname

const node = await Promise.all([
  import("@effect/platform-node/NodeRuntime"),
  import("@effect/platform-node/NodeServices"),
  import("@effect/platform-node/NodeSocket")
]).catch(() => undefined)

if (node === undefined) {
  process.stderr.write(
    "strider runs on Node through @effect/platform-node, which isn't installed. Install it as launching a browser on Node needs it: pnpm add @effect/platform-node, or pnpm add -g @usestrider/cli for a global install\n"
  )
  process.exitCode = 1
} else {
  const [NodeRuntime, NodeServices, NodeSocket] = node
  const [Effect, Layer] = await Promise.all([import("effect/Effect"), import("effect/Layer")])
  if (argv[0] === "__daemon") {
    const [{ daemon }, { SocketConnector }] = await Promise.all([
      import("../internal/cli/daemon.ts"),
      import("../protocol/index.ts")
    ])
    // The daemon's process ends with its session
    daemon(argv[1] ?? "", argv.slice(2)).pipe(
      Effect.ensuring(Effect.sync(() => process.exit(0))),
      Effect.provide(Layer.mergeAll(
        NodeServices.layer,
        NodeSocket.layerWebSocketConstructor,
        // Stock WebKit's inspector server is a TCP socket
        SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))
      )),
      NodeRuntime.runMain
    )
  } else {
    const Main = await import("../internal/cli/main.ts")
    Main.run(argv, bin).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
  }
}
