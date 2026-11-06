/** A separate Strider client: the parent kills this process without running Effect finalizers. */
import { NodeSocket } from "@effect/platform-node"
import { Browser, Dialog } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Claims from "@usestrider/browser/experimental"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

await Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const api = process.argv[4] === "ordinary" ? undefined : Claims
    const context = yield* api === undefined
      ? Browser.newContext()
      : api.UserContext.create({
        reclaimable: true,
        dialogs: process.argv[4] === "dialog" ? "leaveOpen" : "dismiss",
        emulation: { locale: "de-DE" }
      })
    const page = yield* context.newPage
    yield* page.goto(process.argv[3]!)
    yield* page.evaluateInMainWorld(() => {
      sessionStorage.setItem("survivor", "saved")
    })
    const pageClaim = api === undefined ? undefined : Schema.encodeSync(api.Page.Claim)(yield* api.Page.claim(page))
    const contextClaim = api === undefined
      ? undefined
      : Schema.encodeSync(api.UserContext.Claim)(yield* api.UserContext.claim(context))
    if (process.argv[4] === "dialog") {
      const opened = yield* Dialog.next(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => sessionStorage.setItem("crash-answer", String(confirm("crash dialog"))), 0)
      })
      const dialog = yield* opened
      if (dialog._tag !== "Confirm" || dialog.message !== "crash dialog") throw new Error("Expected the crash dialog")
    }
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
