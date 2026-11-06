/**
 * Captures on stock WebKit: a screenshot, of the viewport, the page, or a rectangle of it. Its inspector has no
 * print-to-PDF, no accessibility tree to read whole, and no screencast.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import type * as VideoWriter from "../../VideoWriter.ts"
import * as Page from "../../webkit-stock-protocol/Page.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import * as Video from "../video.ts"
import type * as WebKitVideo from "../webkitVideo.ts"
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

/** Explicit PNG polling: page proxies outlive navigation targets, and end independently of writer pulls. */
export const video = Effect.fnUntraced(function*(
  state: State,
  id: L1Target.NavigableId,
  options: WebKitVideo.Settings | undefined,
  writer: Option.Option<VideoWriter.VideoWriter>
) {
  if (options === undefined || Option.isNone(writer)) {
    return yield* Effect.fail(
      Kit.unsupported("capability.video", "Stock WebKit video requires video polling options and a VideoWriter service")
    )
  }
  const page = yield* pageOf(state, id)
  const clock = yield* BrowserClock.CurrentClock
  let next = clock.now()
  const termination = page.session.ended.pipe(
    Effect.flatMap((reason) =>
      reason.why === "connectionLost" || reason.why === "modelUnavailable"
        ? Effect.fail(Kit.protocolError(new Protocol.ProtocolError({ reason })))
        : Effect.void
    )
  )
  return yield* Video.record(
    Effect.succeed({
      ended: termination,
      frames: Stream.fromEffectRepeat(Effect.gen(function*() {
        const left = (next - clock.now()) / 1e6
        if (left > 0) {
          yield* clock.sleep(left)
        }
        while (true) {
          const target = page.target
          if (target?.ended !== true || page.provisional === undefined) {
            const image = yield* screenshot(state, id, {
              format: "png",
              quality: Option.none(),
              fullPage: false,
              clip: Option.none(),
              scale: "device",
              omitBackground: false
            }).pipe(Effect.catch(Effect.fnUntraced(function*(error) {
              // Pending commands fail before the fold publishes session termination. Only wait for
              // the page's reason when its proxy session has already been removed, not for a target
              // lost during navigation. A normal page end finishes the frame stream cleanly.
              if (
                error.reason._tag === "Protocol" && error.reason.error.reason._tag === "SessionEnded" &&
                error.reason.error.reason.why !== "connectionLost" &&
                error.reason.error.reason.why !== "modelUnavailable" &&
                page.session.key !== undefined && state.control.session(page.session.key) === undefined
              ) {
                yield* termination
                return yield* Cause.done()
              }
              // A dispatched image belongs to the old process. Omit it only when a replacement is known;
              // the next configured poll resolves the new target. Other capture errors remain failures.
              if (
                target !== undefined && target.ended && !page.ended &&
                (page.target !== target || page.provisional !== undefined) &&
                error.reason._tag === "Protocol" && error.reason.error.reason._tag === "SessionEnded"
              ) {
                return undefined
              }
              return yield* Effect.fail(error)
            })))
            if (image !== undefined) {
              next = (clock.now() + options.polled * 1e6) as typeof next
              const size = Adapter.pngSize(image)
              if (size.width === 0 || size.height === 0) {
                return yield* Effect.fail(Kit.undecodable("Page.snapshotRect", "PNG has no positive dimensions"))
              }
              return {
                frame: { format: "png" as const, data: image, ...size },
                take: Effect.void
              }
            }
          }
          yield* BrowserClock.sleep(options.polled)
        }
      }))
    }),
    writer.value,
    options.directory
  )
})
