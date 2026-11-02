/** A separate Strider client: the parent kills this process without running Effect finalizers. */
import { NodeSocket } from "@effect/platform-node"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { contract } from "./contract.ts"

await Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const api = process.argv[4] === "ordinary" ? undefined : yield* contract
    const context = yield* api === undefined
      ? Browser.newContext()
      : api.UserContext.create({ reclaimable: true, emulation: { locale: "de-DE" } })
    const page = yield* context.newPage
    yield* page.goto(process.argv[3]!)
    yield* page.evaluateInMainWorld(() => {
      sessionStorage.setItem("survivor", "saved")
    })
    const pageClaim = api === undefined ? undefined : yield* api.Page.claim(page)
    const contextClaim = api === undefined ? undefined : yield* api.UserContext.claim(context)
    process.stdout.write(JSON.stringify({ pageClaim, contextClaim }) + "\n")
    return yield* Effect.never
  })).pipe(
    Effect.provide(
      Chromium.layerConnect(process.argv[2]!).pipe(
        Layer.provide(NodeSocket.layerWebSocketConstructor)
      )
    )
  )
)
