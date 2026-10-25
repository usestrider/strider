/**
 * Captures (review 18, candidate 5): a page's options mapped onto the contract's. A screenshot's area is the
 * viewport, the full page, a clip in the document's CSS pixels, or an element's box, which the engine measures in
 * its frame and each iframe's origin carries into the page's document. A PDF's paper and margins are inches.
 * What a backend can't do fails with `Unsupported`, from the adapter.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as LocatorImpl from "./locator.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

const pageError = (operation: string, reason: Page.PageErrorReason, id: Diagnostics.OperationId) =>
  new Page.PageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

const invalid = (operation: string, id: Diagnostics.OperationId, input: string, expected: string, hint: string) =>
  pageError(operation, new Reason.InvalidInput({ input, expected, hint }), id)

/** A failure to reach the engine or the adapter, as the page's errors say it. */
const failed = (operation: string, id: Diagnostics.OperationId, budget: Operation.Budget) =>
(
  failure: Runtime.SendFailure
) =>
  failure._tag === "Gone"
    ? failure.error
    : failure._tag === "Reason"
    ? pageError(operation, failure.reason, id)
    : Operation.timeout({
      operation,
      id,
      phase: "resolving",
      budget: budget.budget,
      history: [],
      hint: Option.some("The page didn't answer before the deadline")
    })

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * An element's box in the page's document, in CSS pixels: its box in its frame's viewport, each iframe's origin
 * added, and the page's scroll offset.
 */
const elementBox = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  locator: LocatorImpl.LocatorImpl,
  operation: string,
  id: Diagnostics.OperationId,
  at: Operation.Budget["at"]
): Effect.Effect<Option.Option<Box> | Page.PageError, Runtime.SendFailure> =>
  Effect.gen(function*() {
    const answer = yield* Runtime.sendRouted(runtime, page, { op: "rect", steps: locator.steps }, id, at)
    const response = answer.response
    if (response._tag !== "Rect") {
      const why = response._tag === "NoMatch"
        ? "nothing matched it"
        : response._tag === "Strict"
        ? `${response.count} elements matched it`
        : response._tag === "StaleRef"
        ? `its ref is stale (${response.why})`
        : `the engine answered ${response._tag}`
      return invalid(
        operation,
        id,
        "area",
        "a locator that matches one element",
        `${locator.description}: ${why}; a capture never waits, and Expect waits for what it expects`
      )
    }
    let x = response.rect.x
    let y = response.rect.y
    let scroll = response.scroll
    for (const hop of [...answer.routed.hops].reverse()) {
      const frame = yield* Runtime.sendToDocument(runtime, page, hop.document, {
        op: "frame",
        steps: hop.steps,
        scroll: false,
        point: null
      }, id)
      if (Option.isNone(frame) || frame.value._tag !== "Frame") return Option.none()
      x += frame.value.origin.x
      y += frame.value.origin.y
      scroll = frame.value.scroll
    }
    return Option.some({ x: x + scroll.x, y: y + scroll.y, width: response.rect.width, height: response.rect.height })
  })

/** `page.screenshot`. */
export const screenshot = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  options: Page.ScreenshotOptions | undefined
): Effect.Effect<Uint8Array, Page.PageError | Target.TargetGone | Deadline.Timeout> => {
  const operation = "Page.screenshot"
  const area = options?.area ?? { _tag: "Viewport" as const }
  const format = options?.format ?? { _tag: "Png" as const }
  return Effect.gen(function*() {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    if (format._tag === "Jpeg" && !(Number.isInteger(format.quality) && format.quality >= 0 && format.quality <= 100)) {
      return yield* Effect.fail(
        invalid(operation, id, "format", "a JPEG quality from 0 to 100", `${format.quality} isn't one`)
      )
    }
    let clip = Option.none<Box>()
    if (area._tag === "Clip") {
      const { height, width, x, y } = area.rect
      if (!(width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y))) {
        return yield* Effect.fail(
          invalid(operation, id, "area", "a clip with a positive width and height", `${width}×${height} isn't one`)
        )
      }
      clip = Option.some({ x, y, width, height })
    }
    if (area._tag === "Element") {
      const locator = area.locator
      if (!(locator instanceof LocatorImpl.LocatorImpl) || locator.owner.page.id !== page.id) {
        return yield* Effect.die(new Error("Page.screenshot: the element's locator belongs to another page"))
      }
      const box = yield* elementBox(runtime, page, locator, operation, id, budget.at).pipe(
        Effect.mapError(failed(operation, id, budget))
      )
      if (Page.isPageError(box)) return yield* Effect.fail(box)
      if (Option.isNone(box)) {
        return yield* Effect.fail(
          invalid(operation, id, "area", "an element in a frame that is there", "a frame on its way went")
        )
      }
      clip = box
    }
    const captureOptions: Adapter.ScreenshotOptions = {
      format: format._tag === "Png" ? "png" : "jpeg",
      quality: format._tag === "Jpeg" ? Option.some(format.quality) : Option.none(),
      clip,
      fullPage: area._tag === "FullPage",
      scale: options?.scale ?? "device",
      omitBackground: options?.omitBackground ?? false
    }
    const captured = yield* runtime.model.adapter.screenshot(page.id, captureOptions).pipe(
      Effect.mapError((error) => failed(operation, id, budget)(Operation.fromAdapter(error, id, runtime.backend))),
      Effect.timeoutOption(Operation.millisLeft(budget.at))
    )
    if (Option.isNone(captured)) {
      return yield* Effect.fail(Operation.timeout({
        operation,
        id,
        phase: "dispatchedUnconfirmed",
        budget: budget.budget,
        history: [],
        hint: Option.some("The browser didn't finish the capture before the deadline")
      }))
    }
    return captured.value
  }).pipe(
    Effect.raceFirst(Runtime.pageEnded(page, Operation.operationId())),
    Spans.operation(operation, {
      attributes: {
        "browser.page.id": page.id,
        "browser.screenshot.area": area._tag,
        "browser.screenshot.format": format._tag,
        "browser.screenshot.scale": options?.scale ?? "device"
      }
    })
  )
}

/** Paper sizes by name, in inches: ANSI by its inches, ISO by its millimetres. */
const papers = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
  tabloid: { width: 11, height: 17 },
  a3: { width: 297 / 25.4, height: 420 / 25.4 },
  a4: { width: 210 / 25.4, height: 297 / 25.4 },
  a5: { width: 148 / 25.4, height: 210 / 25.4 }
} as const

/** A length in inches. */
const inches = (length: Page.Length): number => {
  switch (length.unit) {
    case "in":
      return length.value
    case "cm":
      return length.value / 2.54
    case "mm":
      return length.value / 25.4
    case "px":
      return length.value / 96
  }
}

/** `page.pdf`. */
export const pdf = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  options: Page.PdfOptions | undefined
): Effect.Effect<Uint8Array, Page.PageError | Target.TargetGone | Deadline.Timeout> => {
  const operation = "Page.pdf"
  return Effect.gen(function*() {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const paper = options?.paper ?? "letter"
    const size = typeof paper === "string"
      ? papers[paper]
      : { width: inches(paper.width), height: inches(paper.height) }
    if (!(size.width > 0 && size.height > 0)) {
      return yield* Effect.fail(invalid(operation, id, "paper", "a positive width and height", "It has none"))
    }
    const scale = options?.scale ?? 1
    if (!(scale >= 0.1 && scale <= 2)) {
      return yield* Effect.fail(invalid(operation, id, "scale", "a factor from 0.1 to 2", `${scale} isn't one`))
    }
    const margin = (length: Page.Length | undefined) => length === undefined ? 0 : inches(length)
    const margins = options?.margins
    const printed = yield* runtime.model.adapter.pdf(page.id, {
      landscape: options?.landscape ?? false,
      printBackground: options?.background ?? false,
      scale,
      paperWidth: size.width,
      paperHeight: size.height,
      margins: {
        top: margin(margins?.top),
        bottom: margin(margins?.bottom),
        left: margin(margins?.left),
        right: margin(margins?.right)
      },
      pageRanges: Option.fromUndefinedOr(options?.pageRanges),
      header: Option.fromUndefinedOr(options?.header),
      footer: Option.fromUndefinedOr(options?.footer),
      preferCssPageSize: options?.preferCssPageSize ?? false
    }).pipe(
      Effect.mapError((error) => failed(operation, id, budget)(Operation.fromAdapter(error, id, runtime.backend))),
      Effect.timeoutOption(Operation.millisLeft(budget.at))
    )
    if (Option.isNone(printed)) {
      return yield* Effect.fail(Operation.timeout({
        operation,
        id,
        phase: "dispatchedUnconfirmed",
        budget: budget.budget,
        history: [],
        hint: Option.some("The browser didn't finish printing before the deadline")
      }))
    }
    return printed.value
  }).pipe(
    Effect.raceFirst(Runtime.pageEnded(page, Operation.operationId())),
    Spans.operation(operation, { attributes: { "browser.page.id": page.id } })
  )
}
