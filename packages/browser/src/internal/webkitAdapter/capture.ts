/**
 * Captures on stock WebKit: a screenshot, of the viewport, the page, or a rectangle of it. Its inspector has no
 * print-to-PDF, no accessibility tree to read whole, and no screencast.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { pageOf, type State, type TargetEntry, targetOf } from "./state.ts"

/** The viewport's or the page's size, from the page itself. */
const pageSize = (target: TargetEntry, fullPage: boolean) =>
  Runtime.evaluate({
    expression: fullPage
      ? "[Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)]"
      : "[innerWidth, innerHeight]",
    returnByValue: true,
    doNotPauseOnExceptionsAndMuteConsole: true
  }).pipe(
    Protocol.on(target.session),
    Effect.map((reply) => reply.result.value as [number, number])
  )

/** A rectangle as PNG, at the device's scale: stock WebKit's `snapshotRect` takes nothing else. */
export const screenshot = Effect.fnUntraced(function*(
  state: State,
  id: L1Target.NavigableId,
  options: Adapter.ScreenshotOptions
) {
  if (options.format !== "png") {
    return yield* Effect.fail(Kit.unsupported("screenshot.format", "stock WebKit's snapshotRect writes PNG only"))
  }
  if (options.scale === "css") {
    return yield* Effect.fail(
      Kit.unsupported("screenshot.cssScale", "stock WebKit's snapshotRect captures device pixels")
    )
  }
  if (options.omitBackground) {
    return yield* Effect.fail(
      Kit.unsupported("screenshot.omitBackground", "stock WebKit's inspector has no background override")
    )
  }
  const page = yield* pageOf(state, id)
  const target = yield* targetOf(page)
  const clip = Option.getOrUndefined(options.clip)
  const region = clip ?? (yield* Kit.protocol(pageSize(target, options.fullPage)).pipe(
    Effect.map(([width, height]) => ({ x: 0, y: 0, width, height }))
  ))
  const { dataURL } = yield* Kit.protocol(
    Page.snapshotRect({
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height)),
      coordinateSystem: clip !== undefined || options.fullPage ? "Page" : "Viewport"
    }).pipe(Protocol.on(target.session))
  )
  return yield* Kit.decodeBase64(dataURL.slice(dataURL.indexOf(",") + 1), "Page.snapshotRect")
})
