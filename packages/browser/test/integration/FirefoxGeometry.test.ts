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
  it.effect("maps a later normal-flow block across a clipped camera plane", () =>
    Effect.gen(function*() {
      const { origin } = yield* site
      const page = yield* Browser.newPage()
      const html =
        `<body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:800px;height:800px;transform-style:preserve-3d;perspective:100px;perspective-origin:0 0"><div style="position:absolute;left:40px;top:60px;width:200px;height:150px;border:3px solid;padding:4px;box-sizing:content-box;transform-origin:0 0;zoom:1.25;transform:translateZ(120px) rotateY(75deg)"><div style="height:10.25px;width:1px"></div><div id="target" style="margin-left:10px;width:30px;height:40px"></div></div></div></body>`
      yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(html)}`)
      const observed = yield* page.evaluateInMainWorld(() => {
        const el = document.querySelector<HTMLElement>("#target")!, s = getComputedStyle(el)
        return {
          box: el.getBoundingClientRect().toJSON(),
          offsetLeft: el.offsetLeft,
          offsetTop: el.offsetTop,
          left: s.left,
          top: s.top,
          marginLeft: s.marginLeft,
          zoom: s.zoom,
          getBoxQuads: typeof (el as Element & { getBoxQuads?: unknown }).getBoxQuads
        }
      })
      console.log("CLIPPED_NORMAL_FLOW", JSON.stringify(observed))
      const offset = 4 + Math.floor(3 * 1.25) / 1.25, angle = 75 * Math.PI / 180
      const points = [[10, 10.25], [40, 10.25], [40, 50.25], [10, 50.25]].map(([x, y]) => {
        const cx = x! + offset, cy = y! + offset, w = 1 - (120 - Math.sin(angle) * cx) * 1.25 / 100
        return { x: 20 + (40 * 1.25 + Math.cos(angle) * cx * 1.25) / w, y: 30 + (60 * 1.25 + cy * 1.25) / w }
      })
      const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y))
      const expected = {
        x,
        y,
        width: Math.max(...points.map((p) => p.x)) - x,
        height: Math.max(...points.map((p) => p.y)) - y
      }
      console.log("CLIPPED_NORMAL_FLOW_EXPECTED", JSON.stringify(expected))
      const actual = Option.getOrThrow(yield* page.locator("#target").boundingBox)
      for (const key of ["x", "y", "width", "height"] as const) assert.closeTo(actual[key], expected[key], .05, key)
    }), 60_000)
})
