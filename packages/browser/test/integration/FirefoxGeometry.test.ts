import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { site } from "./adapter/harness.ts"
import { firefox } from "./browsers.ts"
const backend = Firefox.layer({ executablePath: firefox.executable }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
)
layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
  it.effect(
    "reads the browser rect of a later normal-flow block across a clipped camera plane",
    () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const page = yield* Browser.newPage()
        const html =
          `<body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:800px;height:800px;transform-style:preserve-3d;perspective:100px;perspective-origin:0 0"><div style="position:absolute;left:40px;top:60px;width:200px;height:150px;border:3px solid;padding:4px;box-sizing:content-box;transform-origin:0 0;zoom:1.25;transform:translateZ(120px) rotateY(75deg)"><div style="height:10.25px;width:1px"></div><div id="target" style="margin-left:10px;width:30px;height:40px"></div></div></div></body>`
        yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(html)}`)
        // The rect contract preserves Firefox's clipped DOMRect, rather than projecting hidden corners.
        const expected = yield* page.evaluateInMainWorld(() => {
          const r = document.querySelector("#target")!.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        })
        const actual = Option.getOrThrow(yield* page.locator("#target").boundingBox)
        assert.deepStrictEqual(actual, expected)
      }),
    60_000
  )
})
