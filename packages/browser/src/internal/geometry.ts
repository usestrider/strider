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
export type Kind = "bounds" | "border" | "frame"
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

/**
 * Self-contained DOM read. Layout translations are recovered from native bounds, while transforms, depth and
 * perspective remain matrices. This avoids duplicating layout's offset-parent, scrolling, fixed and sticky rules.
 * Closed roots can be supplied by a native node serializer without changing any browser preference.
 */
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
  const position = (s: string, extent: number) => s.endsWith("%") ? number(s) * extent / 100 : number(s)
  const angle = (s: string) =>
    number(s) *
    (s.endsWith("rad") && !s.endsWith("grad")
      ? 180 / Math.PI
      : s.endsWith("turn")
      ? 360
      : s.endsWith("grad")
      ? .9
      : 1)
  const point = (m: DOMMatrix, x: number, y: number) => {
    const p = m.transformPoint(new DOMPoint(x, y, 0, 1))
    return { x: p.x / p.w, y: p.y / p.w }
  }
  const corners = (
    m: DOMMatrix,
    width: number,
    height: number
  ): Q => [point(m, 0, 0), point(m, width, 0), point(m, width, height), point(m, 0, height)]
  const localTransform = (s: CSSStyleDeclaration, width: number, height: number) => {
    const origin = s.transformOrigin.split(" ")
    const ox = position(origin[0]!, width), oy = position(origin[1]!, height), oz = number(origin[2] ?? "0")
    const translate = s.translate === "none" ? [] : s.translate.split(" ")
    const scale = s.scale === "none" ? [] : s.scale.split(" ")
    const scaleValue = (v: string | undefined, fallback: number) =>
      v === undefined ? fallback : number(v) / (v.endsWith("%") ? 100 : 1)
    const zoom = number(s.zoom) || 1
    let local = new DOMMatrix().scale(zoom, zoom, zoom).translate(ox, oy, oz).translate(
      position(translate[0] ?? "0", width),
      position(translate[1] ?? "0", height),
      number(translate[2] ?? "0")
    )
    if (s.rotate !== "none") {
      const rotation = s.rotate.split(" "), degrees = angle(rotation.at(-1)!)
      const axis = rotation.length === 1
        ? [0, 0, 1]
        : rotation.length === 2
        ? rotation[0] === "x" ? [1, 0, 0] : rotation[0] === "y" ? [0, 1, 0] : [0, 0, 1]
        : rotation.slice(0, 3).map(number)
      local = local.rotateAxisAngle(axis[0]!, axis[1]!, axis[2]!, degrees)
    }
    local = local.scale(scaleValue(scale[0], 1), scaleValue(scale[1], scaleValue(scale[0], 1)), scaleValue(scale[2], 1))
      .multiply(s.transform === "none" ? new DOMMatrix() : new DOMMatrix(s.transform)).translate(-ox, -oy, -oz)
    return local
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
  const native = element as Element & {
    getBoxQuads?: (options: { box: string }) => Array<{ p1: P; p2: P; p3: P; p4: P }>
  }
  let quad: Q | null = null
  let acceptedQuads: Array<Q> | null = null
  const nativeQuads = native.getBoxQuads?.({ box: "border" }).map((q) =>
    [q.p1, q.p2, q.p3, q.p4].map((p) => ({ x: p.x, y: p.y })) as Q
  )
  if (nativeQuads !== undefined && nativeQuads.length > 0 && matches(nativeQuads.flat(), expected)) {
    data.quads = nativeQuads
    quad = nativeQuads[0]!
    acceptedQuads = nativeQuads
  }
  // WebKit's native conversion takes zoomed renderer-local units and returns document coordinates.
  const view = window as unknown as {
    WebKitPoint?: new(x: number, y: number) => P
    webkitConvertPointFromNodeToPage?: (node: Element, p: P) => P
  }
  if (quad === null && view.WebKitPoint && view.webkitConvertPointFromNodeToPage) {
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
    data.quads = acceptedQuads ?? [quad]
    data.matrix = kind === "frame" ? mapQuad(quad, data.width, data.height, data.contentX, data.contentY) : null
    if (kind !== "frame" || data.matrix !== null) return finish(data)
  }
  if (chain.some((node) => getComputedStyle(node).offsetPath !== "none")) {
    return finish({ ...data, hint: "The browser does not expose native geometry for CSS motion paths" })
  }
  if (kind === "border" && element instanceof SVGGraphicsElement) {
    // WebKit exposes the SVG graphics plane; Gecko's CSS border box is the native viewport
    // rectangle. Native backend quads/conversions above take precedence in either case.
    if (view.webkitConvertPointFromNodeToPage) {
      const matrix = element.getScreenCTM(), b = element.getBBox()
      if (matrix !== null) {
        const q = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]
          .map(([x, y]) => {
            const p = new DOMPoint(x!, y!).matrixTransform(matrix)
            return { x: p.x / p.w, y: p.y / p.w }
          }) as Q
        if (matches(q, expected)) data.quads = [q]
      }
    }
    return finish(data)
  }
  // Axis-aligned native fragments retain fractional inline layout; offsetWidth would round it.
  if (
    kind === "border" && chain.every((node) => {
      const s = getComputedStyle(node)
      const m = s.transform === "none" ? null : new DOMMatrixReadOnly(s.transform)
      return (m === null || (m.is2D && m.b === 0 && m.c === 0)) && s.rotate === "none" && s.perspective === "none" &&
        s.offsetPath === "none"
    })
  ) {
    data.quads = Array.from(element.getClientRects(), rectangle)
    return finish(data)
  }
  let world = new DOMMatrix()
  let basis = world
  for (const node of chain) {
    const s = getComputedStyle(node)
    if (s.display === "contents") continue
    const { width, height } = dimensions(node, s)
    const local = localTransform(s, width, height)
    const r = node.getBoundingClientRect()
    const inputs = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) =>
      local.transformPoint(new DOMPoint(x!, y!, 0, 1))
    )
    const projected = inputs.map((p) => basis.transformPoint(p))
    // Layout contributes an unknown translation before the element's local transform. For each possible
    // corner attaining left/top, projecting B * translate(tx,ty) * local gives two linear equations in
    // tx/ty, even with perspective. Accept a solution only when all four native extrema agree.
    let candidate: DOMMatrix | null = null
    for (let i = 0; i < 4 && candidate === null; i++) {
      for (let j = 0; j < 4 && candidate === null; j++) {
        const a = basis.m11 - r.left * basis.m14, b = basis.m21 - r.left * basis.m24
        const c = basis.m12 - r.top * basis.m14, d = basis.m22 - r.top * basis.m24
        const e = (r.left * projected[i]!.w - projected[i]!.x) / inputs[i]!.w
        const f = (r.top * projected[j]!.w - projected[j]!.y) / inputs[j]!.w
        const det = a * d - b * c
        let tx = 0, ty = 0
        if (Math.abs(det) > 1e-12) {
          tx = (e * d - b * f) / det
          ty = (a * f - e * c) / det
        } else if (a * a + b * b > 1e-12) {
          tx = a * e / (a * a + b * b)
          ty = b * e / (a * a + b * b)
        } else if (c * c + d * d > 1e-12) {
          tx = c * f / (c * c + d * d)
          ty = d * f / (c * c + d * d)
        }
        const m = basis.translate(tx, ty).multiply(local)
        if (matches(corners(m, width, height), [r.left, r.top, r.right, r.bottom])) candidate = m
      }
    }
    if (candidate === null) {
      let containing = parent(node)
      while (containing !== null && getComputedStyle(containing).display === "contents") containing = parent(containing)
      // Camera clipping removes the original extrema from DOMRect. A directly positioned containing
      // block provides resolved insets or native layout offsets as another readonly source.
      const explicit = s.position === "absolute" && s.left.endsWith("px") && s.top.endsWith("px")
      const ps = containing === null ? null : getComputedStyle(containing)
      // Native offsetLeft/Top round to integers. For a first block child, normal flow gives
      // the exact translation from used padding and margins instead of those rounded offsets.
      const firstBlock = containing !== null && ps !== null &&
        ["static", "relative"].includes(s.position) && ["auto", "0px"].includes(s.left) &&
        ["auto", "0px"].includes(s.top) &&
        s.display === "block" && ps.display === "block" && s.float === "none" &&
        ps.writingMode === "horizontal-tb" && node.previousElementSibling === null &&
        Array.from(containing.childNodes).every((child) =>
          child === node || child.nodeType !== Node.TEXT_NODE ||
          (child.textContent ?? "").trim() === ""
        ) &&
        (number(ps.borderTopWidth) > 0 || number(ps.paddingTop) > 0)
      if (containing !== null && ps !== null && ps.position !== "static" && (explicit || firstBlock)) {
        const zoom = number(s.zoom) || 1
        const left = explicit ? number(s.left) + number(s.marginLeft) : number(ps.paddingLeft) + number(s.marginLeft)
        const top = explicit ? number(s.top) + number(s.marginTop) : number(ps.paddingTop) + number(s.marginTop)
        const insetX = number(ps.borderLeftWidth) -
          (containing === document.scrollingElement ? 0 : containing.scrollLeft)
        const insetY = number(ps.borderTopWidth) - (containing === document.scrollingElement ? 0 : containing.scrollTop)
        const native = [r.left, r.top, r.right, r.bottom]
        const finite = native.map((value) => Math.abs(value) < 1e6)
        for (const factor of [1, zoom]) {
          const m = basis.translate(left * factor + insetX, top * factor + insetY).multiply(local)
          const raw = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) =>
            m.transformPoint(new DOMPoint(x!, y!, 0, 1))
          )
          const front = raw.filter((p) => p.w > 0).map((p) => ({ x: p.x / p.w, y: p.y / p.w }))
          if (front.length === 0 || front.length === 4) continue
          const b = bounds(front)
          // Engines expose resolved insets either before or after zoom. An original finite edge must verify
          // that interpretation; camera clipping can also replace the other finite edges.
          if (
            native.some((value, index) => finite[index] && Math.abs(value - b[index]!) < .04)
          ) {
            candidate = m
            break
          }
        }
      }
    }
    if (candidate === null) {
      return finish({
        ...data,
        hint: `The browser's rendered bounds cannot be mapped through ${node.localName}`
      })
    }
    world = candidate
    // Flattening happens after the parent's perspective, before its own transform.
    const flatten = s.transformStyle !== "preserve-3d" || Number(s.opacity) < 1 || s.filter !== "none" ||
      s.isolation === "isolate" || !["visible", "clip"].includes(s.overflowX) ||
      !["visible", "clip"].includes(s.overflowY) || s.clip !== "auto" || s.clipPath !== "none" ||
      s.maskImage !== "none" || s.mixBlendMode !== "normal" ||
      !["", "none"].includes(s.getPropertyValue("mask-border-source")) ||
      s.contain.split(" ").some((value) => ["paint", "strict", "content"].includes(value)) ||
      s.contentVisibility !== "visible"
    basis = flatten ? world.multiply(new DOMMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])) : world
    if (s.perspective !== "none") {
      const p = new DOMMatrix()
      p.m34 = -1 / Math.max(1, number(s.perspective))
      const o = s.perspectiveOrigin.split(" "), x = position(o[0]!, width), y = position(o[1]!, height)
      basis = basis.translate(x, y).multiply(p).translate(-x, -y)
    }
  }
  data.quads = [corners(world, size.width, size.height)]
  if (kind === "frame") {
    const m = world.translate(data.contentX, data.contentY)
    data.matrix = [m.m11, m.m21, m.m41, m.m12, m.m22, m.m42, m.m14, m.m24, m.m44]
  }
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
