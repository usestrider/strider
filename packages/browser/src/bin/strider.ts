#!/usr/bin/env node
/**
 * The `strider` command (CLI.md). A session's command is forwarded to its daemon without loading Effect; `start`
 * starts a daemon; `browsers`, `sessions` and `prune` need no session, and run here through `@effect/platform-node`,
 * an optional peer dependency that only the command needs: a program that launches a browser on Node provides it
 * already.
 *
 * @since 0.1.0
 */
import * as Client from "../internal/cli/client.ts"
import * as Node from "../internal/cli/node.ts"
import * as Session from "../internal/cli/session.ts"

const process = Node.process
const argv = process.argv.slice(2)
const { command } = Session.scan(argv)
const bin = new URL(import.meta.url).pathname

const runLocal = async () => {
  const node = await Promise.all([
    import("@effect/platform-node/NodeRuntime"),
    import("@effect/platform-node/NodeServices"),
    import("@effect/platform-node/NodeSocket")
  ]).catch(() => undefined)
  if (node === undefined) {
    process.stderr.write(
      "strider runs on Node through @effect/platform-node, which isn't installed. Install it as launching a browser on Node needs it: npm install @effect/platform-node\n"
    )
    process.exitCode = 1
    return
  }
  const [NodeRuntime, NodeServices, NodeSocket] = node
  const [Effect, Layer, Cli] = await Promise.all([
    import("effect/Effect"),
    import("effect/Layer"),
    import("../internal/cli.ts")
  ])
  if (command === "__daemon") {
    const { daemon } = await import("../internal/cli/daemon.ts")
    // The daemon's process ends with its session
    const { SocketConnector } = await import("../protocol/index.ts")
    daemon(argv.slice(1)).pipe(
      Effect.ensuring(Effect.sync(() => process.exit(0))),
      Effect.provide(Layer.mergeAll(
        NodeServices.layer,
        NodeSocket.layerWebSocketConstructor,
        // Stock WebKit's inspector server is a TCP socket (review 23)
        SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))
      )),
      NodeRuntime.runMain
    )
    return
  }
  if (command === "mcp") {
    // An MCP server over standard input and output, for a client that launches it (review 22)
    const [{ run }, NodeStdio] = await Promise.all([
      import("../internal/cli/mcp.ts"),
      import("@effect/platform-node/NodeStdio")
    ])
    run(argv, bin, NodeStdio.layer).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
    return
  }
  Cli.run(argv).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
}

if (command === "start") {
  process.exitCode = await Client.start(argv, bin)
} else if (command === undefined || Client.local.has(command)) {
  await runLocal()
} else {
  process.exitCode = await Client.forward(argv)
}
