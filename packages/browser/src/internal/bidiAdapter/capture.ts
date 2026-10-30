/**
 * Captures on BiDi: screenshots, PDFs, and a video, which Firefox writes as a WebM file where the page's context
 * downloads to.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import type * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { navigableById, type State } from "./state.ts"

export const screenshot = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
    const navigable = yield* navigableById(state, id)
    if (options.scale === "css") {
      return yield* Effect.fail(Kit.unsupported("screenshot.cssScale", "WebDriver BiDi captures device pixels only"))
    }
    if (options.omitBackground) {
      return yield* Effect.fail(
        Kit.unsupported("screenshot.omitBackground", "WebDriver BiDi has no background override")
      )
    }
    const clip = Option.getOrUndefined(options.clip)
    let origin: "document" | "viewport" = options.fullPage || clip !== undefined ? "document" : "viewport"
    let box = clip
    if (clip !== undefined && !options.fullPage) {
      // Firefox refuses a document clip beyond the root element's box, as on a short page in quirks mode, so a
      // clip inside the viewport is taken from the viewport, offset by the scroll position (QUIRKS.md, Q114)
      const view = yield* state.send(Script.evaluate({
        expression: "JSON.stringify([scrollX, scrollY, innerWidth, innerHeight])",
        target: { context: navigable.bidi, sandbox: "__strider_utility__" },
        awaitPromise: false
      })).pipe(
        Effect.map((result) =>
          result.type === "success" && result.result.type === "string"
            ? JSON.parse(result.result.value) as [number, number, number, number]
            : undefined
        ),
        Effect.orElseSucceed(() => undefined)
      )
      if (view !== undefined) {
        const [x, y, width, height] = view
        if (clip.x >= x && clip.y >= y && clip.x + clip.width <= x + width && clip.y + clip.height <= y + height) {
          origin = "viewport"
          box = { ...clip, x: clip.x - x, y: clip.y - y }
        }
      }
    }
    const { data } = yield* Kit.protocol(state.send(BrowsingContext.captureScreenshot({
      context: navigable.bidi,
      origin,
      format: {
        type: `image/${options.format}`,
        ...(Option.isSome(options.quality) ? { quality: options.quality.value / 100 } : {})
      },
      ...(box === undefined ? {} : { clip: { type: "box", ...box } })
    })))
    return yield* Kit.decodeBase64(data, "browsingContext.captureScreenshot")
  }
)

export const pdf = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId, options: Adapter.PdfOptions) {
  const navigable = yield* navigableById(state, id)
  if (Option.isSome(options.header) || Option.isSome(options.footer)) {
    return yield* Effect.fail(Kit.unsupported("pdf.headerFooter", "WebDriver BiDi prints no header or footer"))
  }
  if (options.preferCssPageSize) {
    return yield* Effect.fail(Kit.unsupported("pdf.preferCssPageSize", "WebDriver BiDi prints at the size it is given"))
  }
  const cm = (inches: number) => inches * 2.54
  const { data } = yield* Kit.protocol(state.send(BrowsingContext.print({
    context: navigable.bidi,
    orientation: options.landscape ? "landscape" : "portrait",
    background: options.printBackground,
    scale: options.scale,
    page: { width: cm(options.paperWidth), height: cm(options.paperHeight) },
    margin: {
      top: cm(options.margins.top),
      bottom: cm(options.margins.bottom),
      left: cm(options.margins.left),
      right: cm(options.margins.right)
    },
    ...(Option.isSome(options.pageRanges) ? { pageRanges: options.pageRanges.value.split(",") } : {})
  })))
  return yield* Kit.decodeBase64(data, "browsingContext.print")
})

/** A WebM file Firefox writes where the context downloads to, which a launched browser shares with the program. */
export const video = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId) {
  const navigable = yield* navigableById(state, id)
  if (state.options.ownership !== "launched") {
    return yield* Effect.fail(
      Kit.unsupported("capability.video", "Firefox writes the file on its own host, out of the program's reach")
    )
  }
  const behavior = state.registry.downloads(navigable.context.id)
  if (behavior === undefined || behavior._tag === "Deny") {
    return yield* Effect.fail(Kit.unsupported(
      "capability.video",
      behavior === undefined
        ? "The page's context declares no downloads directory, where the file would go"
        : "The page's context denies downloads, and the file would go where they do"
    ))
  }
  const started = yield* Kit.protocol(state.send(BrowsingContext.startScreencast({
    context: navigable.bidi,
    destinationFolder: behavior.directory
  })))
  const written = Deferred.makeUnsafe<string, Adapter.AdapterError>()
  yield* Effect.addFinalizer(() =>
    Kit.protocol(state.send(BrowsingContext.stopScreencast({ screencast: started.screencast }))).pipe(
      Effect.map((stopped) => stopped.path),
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(written, exit))
    )
  )
  return Deferred.await(written)
})
