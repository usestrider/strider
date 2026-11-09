/** Geometry queried only by boundingBox; none of this source is installed with the query engine. */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import * as Adapter from "./adapter.ts"
import * as Kit from "./adapterKit.ts"

const finite = Schema.Number.check(Schema.isFinite())
export const Point = Schema.Struct({ x: finite, y: finite })
export type Point = typeof Point.Type
export const Matrix = Schema.Tuple([finite, finite, finite, finite, finite, finite, finite, finite, finite])
export type Matrix = typeof Matrix.Type
const Quad = Schema.Tuple([Point, Point, Point, Point])
export const Data = Schema.Struct({
  quads: Schema.Array(Quad),
  matrix: Schema.NullOr(Matrix),
  width: finite,
  height: finite,
  contentX: finite,
  contentY: finite,
  pixelRatio: finite,
  hint: Schema.NullOr(Schema.String)
})
export type Data = typeof Data.Type
export type Kind = "bounds" | "frame"
export interface Result {
  readonly document: Target.DocumentId
  readonly data: Data
}

export const project = (m: Matrix, p: Point): Point => {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }
}

/** A native border quad defines the projectivity of its plane, before any bounds are taken. */
export const fromQuad = (
  q: Data["quads"][number],
  width: number,
  height: number,
  x: number,
  y: number
): Matrix | null => {
  if (width === 0 || height === 0) return null
  const [p0, p1, p2, p3] = q
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
  const denominator = dx1 * dy2 - dx2 * dy1
  if ((Math.abs(dx3) + Math.abs(dy3)) > 1e-8 && Math.abs(denominator) < 1e-12) return null
  const g = Math.abs(dx3) + Math.abs(dy3) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator
  const h = Math.abs(dx3) + Math.abs(dy3) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator
  const a = (p1.x - p0.x + g * p1.x) / width, c = (p3.x - p0.x + h * p3.x) / height
  const b = (p1.y - p0.y + g * p1.y) / width, d = (p3.y - p0.y + h * p3.y) / height
  return [
    a,
    c,
    p0.x + a * x + c * y,
    b,
    d,
    p0.y + b * x + d * y,
    g / width,
    h / height,
    1 + g * x / width + h * y / height
  ]
}

export const incompatible = (hint: string, cause?: unknown) =>
  new Adapter.AdapterError({
    reason: new Reason.BackendFailure({ kind: "IncompatibleResponse", method: "Locator.boundingBox", hint, cause })
  })

export const decode = (result: Adapter.RemoteResult) => {
  if (result._tag !== "Value" || result.value.type !== "string") {
    return Effect.fail(incompatible("The browser did not return geometry by value", result))
  }
  return Schema.decodeUnknownEffect(Schema.fromJsonString(Data))(result.value.value).pipe(
    Effect.mapError((cause) => incompatible("The browser returned invalid geometry", cause)),
    Effect.flatMap((data) =>
      data.hint === null ? Effect.succeed(data) : Effect.fail(Kit.unsupported("Locator.boundingBox", data.hint))
    )
  )
}

/** Browser rects and native frame-plane conversion, evaluated only for a bounding-box read. */
export const dom = function(
  element: Element,
  kind: Kind | "metadata",
  roots: ReadonlyArray<ShadowRoot>,
  mapQuad: typeof fromQuad
) {
  type P = { x: number; y: number }
  type Q = [P, P, P, P]
  const ancestors: Array<Element> = []
  const empty = {
    quads: [] as Array<Q>,
    matrix: null as ReadonlyArray<number> | null,
    width: 0,
    height: 0,
    contentX: 0,
    contentY: 0,
    pixelRatio: devicePixelRatio,
    hint: null as string | null
  }
  const finish = (data: typeof empty) => ({
    data: JSON.stringify(
      data.quads.some((q) => q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) ||
        data.matrix?.some((n) => !Number.isFinite(n))
        ? { ...data, quads: [], matrix: null, hint: "The browser's projected plane has non-finite coordinates" } :
        data
    ),
    ancestors
  })
  const parent = (node: Element): Element | null => {
    const slot = node.assignedSlot ??
      roots.flatMap((root) => Array.from(root.querySelectorAll("slot"))).find((slot) =>
        slot.assignedNodes().includes(node)
      )
    const root = node.getRootNode()
    return slot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  const number = (s: string) => parseFloat(s) || 0
  const dimensions = (node: Element, style: CSSStyleDeclaration) => {
    const px = number(style.paddingLeft) + number(style.paddingRight)
    const py = number(style.paddingTop) + number(style.paddingBottom)
    const bx = number(style.borderLeftWidth) + number(style.borderRightWidth)
    const by = number(style.borderTopWidth) + number(style.borderBottomWidth)
    const html = node as HTMLElement
    return {
      width: style.width === "auto"
        ? html.offsetWidth ?? 0
        : number(style.width) + (style.boxSizing === "border-box" ? 0 : px + bx),
      height: style.height === "auto"
        ? html.offsetHeight ?? 0
        : number(style.height) + (style.boxSizing === "border-box" ? 0 : py + by)
    }
  }
  if (element.getClientRects().length === 0) return finish(empty)
  const style = getComputedStyle(element)
  const size = dimensions(element, style)
  const data = {
    ...empty,
    ...size,
    contentX: number(style.borderLeftWidth) + number(style.paddingLeft),
    contentY: number(style.borderTopWidth) + number(style.paddingTop)
  }
  const rect = element.getBoundingClientRect()
  const rectangle = (
    r: DOMRect
  ): Q => [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]
  data.quads = [rectangle(rect)]
  if (kind === "bounds" || kind === "metadata") return finish(data)
  const chain: Array<Element> = []
  for (let current: Element | null = element; current !== null; current = parent(current)) {
    chain.unshift(current)
    ancestors.push(current)
  }
  const bounds = (
    q: ReadonlyArray<P>
  ) => [
    Math.min(...q.map((p) => p.x)),
    Math.min(...q.map((p) => p.y)),
    Math.max(...q.map((p) => p.x)),
    Math.max(...q.map((p) => p.y))
  ]
  const expected = [rect.left, rect.top, rect.right, rect.bottom]
  const matches = (q: ReadonlyArray<P>, r: ReadonlyArray<number>) =>
    bounds(q).every((n, i) => Number.isFinite(n) && Math.abs(n - r[i]!) < .04)
  let quad: Q | null = null
  // WebKit's native conversion takes zoomed renderer-local units and returns document coordinates.
  const view = window as unknown as {
    WebKitPoint?: new(x: number, y: number) => P
    webkitConvertPointFromNodeToPage?: (node: Element, p: P) => P
  }
  if (view.WebKitPoint && view.webkitConvertPointFromNodeToPage) {
    const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom ??
      chain.reduce((z, n) => z * (number(getComputedStyle(n).zoom) || 1), 1)
    const rawBorders = [style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth]
      .map(number)
    let factor = zoom
    for (let attempt = 0; attempt < 16; attempt++) {
      // WebKit snaps used border widths to device pixels after applying effective zoom. Its computed
      // style retains the unsnapped CSS width (StyleLineWidth.cpp, snapLengthAsBorderWidth).
      const borders = rawBorders.map((width) =>
        width === 0 ? 0 : Math.max(1, Math.floor(width * factor * devicePixelRatio)) / devicePixelRatio / factor
      )
      const measuredSize = {
        width: size.width +
          (style.boxSizing === "border-box" ? 0 : borders[0]! + borders[2]! - rawBorders[0]! - rawBorders[2]!),
        height: size.height +
          (style.boxSizing === "border-box" ? 0 : borders[1]! + borders[3]! - rawBorders[1]! - rawBorders[3]!)
      }
      const points = [[0, 0], [measuredSize.width, 0], [measuredSize.width, measuredSize.height], [
        0,
        measuredSize.height
      ]]
      const converted = points.map(([x, y]) => {
        const p = view.webkitConvertPointFromNodeToPage!(element, new view.WebKitPoint!(x! * factor, y! * factor))
        return { x: p.x - scrollX, y: p.y - scrollY }
      }) as Q
      if (matches(converted, expected)) {
        quad = converted
        data.width = measuredSize.width
        data.height = measuredSize.height
        data.contentX = borders[0]! + number(style.paddingLeft)
        data.contentY = borders[1]! + number(style.paddingTop)
        break
      }
      const measured = bounds(converted)
      const width = measured[2]! - measured[0]!, height = measured[3]! - measured[1]!
      const ratio = width > 1e-9 ? rect.width / width : height > 1e-9 ? rect.height / height : 1
      if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-12) break
      factor *= ratio
    }
  }

  if (quad !== null) {
    data.matrix = mapQuad(quad, data.width, data.height, data.contentX, data.contentY)
    return finish(data)
  }
  // Without native point conversion, an axis-aligned frame rect supplies its scale and origin.
  // Inspect the flat tree (including serialized closed roots) only to reject ambiguous orientation;
  // never recover layout positions or reconstruct transformed element corners.
  for (const node of chain) {
    const s = getComputedStyle(node)
    const m = s.transform === "none" ? null : new DOMMatrixReadOnly(s.transform)
    const scale = s.scale === "none" ? [] : s.scale.split(" ").map(Number)
    if (
      (m !== null && (!m.is2D || m.b !== 0 || m.c !== 0 || m.a <= 0 || m.d <= 0)) ||
      s.rotate !== "none" || s.perspective !== "none" || s.offsetPath !== "none" ||
      s.translate.split(" ").length > 2 || scale.length > 2 || scale.some((value) => !(value > 0))
    ) {
      return finish({
        ...data,
        hint:
          "This browser cannot reliably compose a frame rect through rotation, skew, reflection, 3D, perspective or motion paths; native frame point conversion is unavailable"
      })
    }
  }
  data.matrix = mapQuad(rectangle(rect), data.width, data.height, data.contentX, data.contentY)
  return finish(data)
}

export const source = () =>
  `function(element,kind,...roots) { return (${dom.toString()})(element,kind,roots,(${fromQuad.toString()})) }`
const declaration = () => `function(element,kind,...roots) { return (${source()})(element,kind,...roots).data }`
export const call = (node: Adapter.NodeBinding, kind: Kind | "metadata"): Adapter.EvaluationCall => ({
  functionDeclaration: declaration(),
  arguments: [{ _tag: "Node", node }, { _tag: "Value", value: { type: "string", value: kind } }],
  awaitPromise: false,
  result: "value",
  userActivation: false
})
