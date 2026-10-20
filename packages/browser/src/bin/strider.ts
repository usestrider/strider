#!/usr/bin/env node
/**
 * The `strider` command (CLI.md). It runs on Node through `@effect/platform-node`, an optional peer dependency
 * that only the command needs: a program that launches a browser on Node provides it already.
 *
 * @since 0.1.0
 */
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { strider } from "../internal/cli.ts"

const node = await Promise.all([
  import("@effect/platform-node/NodeRuntime"),
  import("@effect/platform-node/NodeServices")
]).catch(() => undefined)

if (node === undefined) {
  globalThis.console.error(
    "strider runs on Node through @effect/platform-node, which isn't installed. Install it as launching a browser on Node needs it: npm install @effect/platform-node"
  )
  ;(globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
} else {
  const [NodeRuntime, NodeServices] = node
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifest = yield* path.fromFileUrl(new URL("../../package.json", import.meta.url))
    const { version } = JSON.parse(yield* fs.readFileString(manifest)) as { readonly version: string }
    return yield* Command.run(strider, { version })
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
}
