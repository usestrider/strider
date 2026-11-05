import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Target from "@usestrider/browser/cdp/Target"
import { Chromium } from "@usestrider/browser/chromium"
import { CdpConnection, Protocol } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { readFile } from "node:fs/promises"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { chromium } from "../browsers.ts"

describe("probe", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })((it) => {
    it.effect("startup page timing", () =>
      Effect.gen(function*() {
        const rows: Array<unknown> = []
        for (let i = 0; i < 20; i++) {
          yield* Effect.scoped(Effect.gen(function*() {
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({
              executablePath: chromium.executable,
              args: ["--site-per-process"]
            })
            const observer = yield* CdpConnection.make(transport)
            const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(
              Protocol.on(observer.browser),
              Effect.map((reply) => reply.targetInfos.filter((t) => t.type === "page").map((t) => t.targetId))
            )
            const first = yield* targets
            const [port] = (yield* Effect.promise(() => readFile(`${launched.userDataDir}/DevToolsActivePort`, "utf8"))).split("\n")
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext()
              const before = yield* targets
              const seen = new Set(before)
              yield* context.newPage
              const after = yield* targets
              rows.push({ first: first.length, before: before.length, created: after.filter((id) => !seen.has(id)).length })
            })).pipe(Effect.provide(Chromium.layerConnect(`http://127.0.0.1:${port}`)))
          }))
        }
        console.log("PROBE " + JSON.stringify(rows))
      }), 120_000)
  })
})
