/**
 * DOM snapshots for traces (review 22, candidate 1): a capture of our own, written from scratch to the trace
 * viewer's format (research/playwright-trace-snapshots.md), run in each document's engine world, apart from the
 * page, which can neither see it nor change what it reads.
 *
 * - **Nodes** are the viewer's: text, `[name, attributes, ...children]`, or a back-reference
 *   `[[capturesAgo, index]]` to a node of an earlier capture of the same stream, counted in post-order over the
 *   nodes that aren't references. A node is a reference when it and everything under it read the same as when
 *   last written.
 * - **Live state** goes in the viewer's attributes: values, `checked`, `selected`, scroll offsets, open shadow
 *   roots, adopted sheets, open popovers and dialogs, the boxes of canvases and iframes, an image's `currentSrc`,
 *   the defined custom elements (known by `:defined` and a hyphen: an isolated world has no registry in
 *   Chromium), and the action's target.
 * - **Stylesheets** are read from `cssRules` on every capture, since nothing hooks the page's CSSOM: a `<style>`'s
 *   text is its rules, an adopted sheet is a `template` of the viewer's, and a same-origin linked sheet is a
 *   resource override, by reference while its text is unchanged. A sheet no world can read is left to the
 *   network recording.
 * - **Streams.** A recording's captures in a document are one stream, with their own numbering, so two
 *   recordings never refer into each other's. A failed capture is followed by one with no references.
 * - **Secrets** are flagged, not redacted: a password input's value, and the value of a field filled with
 *   `Redacted` text, carry `__strider_secret__`, which the export removes, redacting the value under the strict
 *   preset.
 *
 * `capturer` is self-contained, as the engine is: its source crosses into the page.
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Runtime from "./runtime.ts"

/** A captured node, as the viewer reads it: text, `[name, attributes?, ...children]`, or `[[capturesAgo, index]]`. */
export type SnapshotNode = string | Array<unknown>

/** What one capture returns: the document's HTML, its linked sheets as overrides, and how it was read. */
export interface Captured {
  readonly html: SnapshotNode
  readonly doctype: string | null
  readonly overrides: ReadonlyArray<{ readonly url: string; readonly content: string | number }>
  readonly viewport: { readonly width: number; readonly height: number }
  readonly url: string
  readonly wallTime: number
  readonly collectionTime: number
}

export interface Request {
  /** The recording's stream. */
  readonly stream: string
  /** Whether to write no references, after a capture that failed. */
  readonly reset: boolean
}

/** The attribute that flags a secret value, which the export removes. */
export const secretAttribute = "__strider_secret__"

export const capturer = () => {
  interface Cached {
    values: Array<unknown>
    ref: [number, number]
  }
  interface Stream {
    count: number
    index: number
    readonly nodes: WeakMap<object, Cached>
    readonly sheets: WeakMap<CSSStyleSheet, { text: string; at: number }>
  }
  const streams = new Map<string, Stream>()
  const frameIds = new WeakMap<Element, string>()
  const secrets = new WeakSet<Element>()
  let target: Element | null = null

  const isFrame = (name: string) => name === "IFRAME" || name === "FRAME"

  // An element's open shadow root; a property a framework faked is no root
  const shadowOf = (element: Element): ShadowRoot | null => {
    const root = element.shadowRoot
    return root instanceof ShadowRoot ? root : null
  }

  /** Every iframe of the document, its open shadow roots' included, that no frame id is known for. */
  const frames = (): Array<Element> => {
    const found: Array<Element> = []
    const walk = (root: Document | ShadowRoot) => {
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (isFrame(element.nodeName) && !frameIds.has(element)) found.push(element)
        const shadow = shadowOf(element)
        if (shadow !== null) walk(shadow)
      }
    }
    walk(document)
    return found
  }

  const sheetText = (sheet: CSSStyleSheet): string | null => {
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n")
    } catch {
      return null
    }
  }

  const absolute = (url: string): string => {
    try {
      const parsed = new URL(url, document.baseURI)
      parsed.hash = ""
      return parsed.href
    } catch {
      return url
    }
  }

  // A URL the viewer could act on rather than show
  const safeUrl = (url: string) => /^\s*javascript:/i.test(url) ? "" : url

  const capture = (request: Request): Captured => {
    const started = performance.now()
    let stream = streams.get(request.stream)
    if (stream === undefined || request.reset) {
      stream = { count: 0, index: 0, nodes: new WeakMap(), sheets: new WeakMap() }
      streams.set(request.stream, stream)
    }
    const current = stream
    const number = ++current.count
    current.index = 0
    const end = Symbol("end")
    const definedCustomElements = new Set<string>()
    let inHead = 0

    // A node whose values match the cached ones, children included, is a reference; else it is written, and takes
    // the next index, after its children: post-order
    // A sheet adopted twice in one capture is written twice: a reference into the capture itself means nothing
    const seen = new Set<object>()
    const settle = (key: object, values: Array<unknown>, same: boolean, written: SnapshotNode, extra = 0) => {
      const cached = current.nodes.get(key)
      const unchanged = same && !seen.has(key) && cached !== undefined && cached.values.length === values.length &&
        cached.values.every((value, at) => value === values[at])
      if (unchanged) return { same: true, node: [[number - cached!.ref[0], cached!.ref[1]]] as SnapshotNode }
      current.index += extra
      const ref: [number, number] = [number, current.index++]
      if (!seen.has(key)) current.nodes.set(key, { values, ref })
      seen.add(key)
      return { same: false, node: written }
    }

    const visitSheet = (sheet: CSSStyleSheet): { same: boolean; node: SnapshotNode } => {
      const text = sheetText(sheet) ?? ""
      return settle(sheet, [text], true, ["template", { "__playwright_style_sheet_": text }])
    }

    const visit = (real: Node): { same: boolean; node: SnapshotNode } | undefined => {
      const type = real.nodeType
      if (type === 3) {
        const text = real.nodeValue ?? ""
        return settle(real, [text], true, text)
      }
      if (type !== 1 && type !== 11) return undefined
      const name = type === 11 ? "template" : real.nodeName
      if (name === "SCRIPT" || name === "NOSCRIPT") return undefined
      if (type === 1) {
        const element = real as Element
        if (name === "LINK") {
          const rel = (element.getAttribute("rel") ?? "").toLowerCase()
          if (rel === "preload" || rel === "prefetch") return undefined
        }
        if (name === "META") {
          const equiv = (element.getAttribute("http-equiv") ?? "").toLowerCase()
          if (equiv === "content-security-policy" || equiv === "refresh" || equiv === "set-cookie") return undefined
        }
        if (isFrame(name) && inHead > 0) return undefined
      }
      if (name === "STYLE") {
        const sheet = (real as HTMLStyleElement).sheet
        const text = (sheet === null ? null : sheetText(sheet)) ?? real.textContent ?? ""
        // The text is a node of its own, counted before the element
        return settle(real, [text], true, ["STYLE", {}, text], 1)
      }
      const attributes: Record<string, string> = {}
      const written: Array<unknown> = [name, attributes]
      const values: Array<unknown> = []
      let same = true
      const child = (each: Node) => {
        const visited = visit(each)
        if (visited === undefined) return
        written.push(visited.node)
        values.push(each)
        same = same && visited.same
      }
      const state = (attribute: string, value: string) => {
        attributes[attribute] = value
        values.push(attribute, value)
      }
      if (type === 11) state("__playwright_shadow_root_", "open")
      if (type === 1) {
        const element = real as HTMLElement
        if (element.localName.includes("-") && element.matches(":defined")) {
          definedCustomElements.add(element.localName)
        }
        if (name === "INPUT" || name === "TEXTAREA") {
          state("__playwright_value_", (element as HTMLInputElement).value)
          if ((element as HTMLInputElement).type === "password" || secrets.has(element)) state("__strider_secret__", "")
        }
        if (name === "INPUT" && ["checkbox", "radio"].includes((element as HTMLInputElement).type)) {
          state("__playwright_checked_", (element as HTMLInputElement).checked ? "true" : "false")
        }
        if (name === "OPTION") {
          state("__playwright_selected_", (element as HTMLOptionElement).selected ? "true" : "false")
        }
        if (name === "CANVAS" || isFrame(name)) {
          const box = element.getBoundingClientRect()
          state(
            "__playwright_bounding_rect__",
            JSON.stringify({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })
          )
        }
        if (element.popover !== undefined && element.popover !== null && element.matches(":popover-open")) {
          state("__playwright_popover_open_", "true")
        }
        if (name === "DIALOG" && (element as HTMLDialogElement).open) {
          state("__playwright_dialog_open_", element.matches(":modal") ? "modal" : "true")
        }
        if (element.scrollTop !== 0) state("__playwright_scroll_top_", String(element.scrollTop))
        if (element.scrollLeft !== 0) state("__playwright_scroll_left_", String(element.scrollLeft))
        if (element === target) state("__playwright_target__", "")
        const shadow = shadowOf(element)
        if (shadow !== null) child(shadow)
      }
      if (name === "HEAD") {
        inHead++
        // The viewer resolves the snapshot's relative URLs against the document's: a base of its own, first
        written.push(["BASE", { href: document.baseURI }])
        values.push("base", document.baseURI)
        current.index++
      }
      for (let each = real.firstChild; each !== null; each = each.nextSibling) child(each)
      if (name === "HEAD") inHead--
      values.push(end)
      const root = type === 11 ? real as ShadowRoot : real === document.documentElement ? document : null
      if (root !== null) {
        for (const sheet of root.adoptedStyleSheets ?? []) {
          const visited = visitSheet(sheet)
          written.push(visited.node)
          values.push(sheet)
          same = same && visited.same
        }
        values.push(end)
      }
      if (type === 1) {
        const element = real as Element
        if (isFrame(name)) {
          const id = frameIds.get(element)
          state("src", id === undefined ? "" : `/snapshot/${id}`)
        }
        if (name === "BODY" && definedCustomElements.size > 0) {
          state("__playwright_custom_elements__", Array.from(definedCustomElements).join(","))
        }
        if (name === "IMG" || name === "PICTURE") {
          state(
            "__playwright_current_src__",
            name === "PICTURE" ? "" : safeUrl((element as HTMLImageElement).currentSrc)
          )
        }
        for (const attribute of Array.from(element.attributes)) {
          const key = attribute.name
          if (name === "LINK" && key === "integrity") continue
          if (isFrame(name) && (key === "src" || key === "srcdoc" || key === "sandbox")) continue
          if (name === "DIALOG" && key === "open") continue
          const lower = key.toLowerCase()
          const value = lower.startsWith("on")
            ? ""
            : (lower === "src" || lower === "href" || lower === "srcset")
            ? safeUrl(attribute.value)
            : attribute.value
          state(key, value)
        }
        values.push(end)
      }
      if (written.length === 2 && Object.keys(attributes).length === 0) written.pop()
      return settle(real, values, same, written as SnapshotNode)
    }

    const html: SnapshotNode = document.documentElement === null
      ? ["HTML"]
      : visit(document.documentElement)!.node
    const overrides: Array<{ url: string; content: string | number }> = []
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.href === null) continue
      const text = sheetText(sheet)
      if (text === null) continue
      const previous = current.sheets.get(sheet)
      if (previous !== undefined && previous.text === text) {
        overrides.push({ url: absolute(sheet.href), content: number - previous.at })
        continue
      }
      current.sheets.set(sheet, { text, at: number })
      overrides.push({ url: absolute(sheet.href), content: text })
    }
    return {
      html,
      doctype: document.doctype === null ? null : document.doctype.name,
      overrides,
      viewport: { width: innerWidth, height: innerHeight },
      url: location.href,
      wallTime: Date.now(),
      collectionTime: performance.now() - started
    }
  }

  return {
    frames,
    // Each iframe, then the id of the frame it holds
    mark: (...pairs: Array<unknown>) => {
      for (let at = 0; at + 1 < pairs.length; at += 2) frameIds.set(pairs[at] as Element, pairs[at + 1] as string)
      return "marked"
    },
    target: (element: Element | null, secret: boolean) => {
      target = element
      if (element !== null && secret) secrets.add(element)
      return "marked"
    },
    capture: (request: string) => {
      try {
        return JSON.stringify(capture(JSON.parse(request) as Request))
      } finally {
        // The target is one capture's
        target = null
      }
    }
  }
}

// ── L1: the capture's driver ──

/** The key the capture is installed under in a realm's global: a symbol, out of the way of anything else. */
export const installKey = "@usestrider/browser/capture/1"

/** Installs the capture in a realm, once: a function declaration for `evaluate`. */
const install = `function() {
  const key = Symbol.for(${JSON.stringify(installKey)});
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, { value: (${capturer.toString()})(), enumerable: false });
  }
  return "installed";
}`

/** What a call answers when the realm has no capture yet. */
const missing = "\u0000missing"

/** Calls one of the capture's members: a function declaration for `evaluate`. */
const member = (name: "frames" | "mark" | "target" | "capture") =>
  `function(...args) {
  const capture = globalThis[Symbol.for(${JSON.stringify(installKey)})];
  return capture === undefined ? ${JSON.stringify(missing)} : capture.${name}(...args);
}`

/** Why a frame's capture is missing from a snapshot: best-effort, so it is skipped and the next starts afresh. */
export class CaptureFailed extends Data.TaggedError("CaptureFailed")<{ readonly message: string }> {}

/** Calls the capture in a document's engine world, installing it first where it isn't there yet. */
const call = (
  runtime: Runtime.Runtime,
  document: Target.DocumentId,
  name: "frames" | "mark" | "target" | "capture",
  args: ReadonlyArray<Adapter.LocalValue>
): Effect.Effect<Adapter.RemoteValue, CaptureFailed> =>
  Effect.gen(function*() {
    const adapter = runtime.model.adapter
    const realm = yield* adapter.realm(document, yield* Runtime.engineWorld(runtime))
    const evaluate = (functionDeclaration: string, values: ReadonlyArray<Adapter.LocalValue>) =>
      adapter.evaluate(realm, {
        functionDeclaration,
        arguments: values,
        awaitPromise: false,
        result: "value",
        userActivation: false
      })
    let result = yield* evaluate(member(name), args)
    if (result._tag === "Value" && result.value.type === "string" && result.value.value === missing) {
      yield* evaluate(install, [])
      result = yield* evaluate(member(name), args)
    }
    if (result._tag === "Exception") return yield* Effect.fail(new CaptureFailed({ message: result.text }))
    return result.value
  }).pipe(Effect.catchTag("AdapterError", (error) => Effect.fail(new CaptureFailed({ message: error.message }))))

const text = (value: string): Adapter.LocalValue => ({ _tag: "Value", value: { type: "string", value } })

/** A frame's capture, for the trace's `frame-snapshot` event. */
export interface FrameCapture {
  readonly frame: Target.NavigableId
  readonly main: boolean
  readonly captured: Captured
}

/** The action's target: the element the action resolved, and whether its value is a secret. */
export interface CaptureTarget {
  readonly node: Adapter.NodeBinding
  readonly secret: boolean
}

/**
 * Captures one document: its iframes told the frames they hold first, which the capture writes as their `src`,
 * then the action's target marked when it is in this document.
 */
const captureDocument = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  document: Target.DocumentId,
  request: Request,
  target: Option.Option<CaptureTarget>
) {
  const found = yield* call(runtime, document, "frames", [])
  const iframes = found.type === "array" ? found.value ?? [] : []
  const pairs: Array<Adapter.LocalValue> = []
  for (const iframe of iframes) {
    if (iframe.type !== "node" || iframe.node === undefined) continue
    const held = yield* runtime.model.adapter.contentFrame(iframe.node).pipe(Effect.option)
    if (Option.isSome(held) && Option.isSome(held.value)) {
      pairs.push({ _tag: "Node", node: iframe.node }, text(held.value.value))
    }
  }
  if (pairs.length > 0) yield* call(runtime, document, "mark", pairs)
  if (Option.isSome(target) && target.value.node.document === document) {
    yield* call(runtime, document, "target", [
      { _tag: "Node", node: target.value.node },
      { _tag: "Value", value: { type: "boolean", value: target.value.secret } }
    ])
  }
  const captured = yield* call(runtime, document, "capture", [text(JSON.stringify(request))])
  if (captured.type !== "string") {
    return yield* Effect.fail(new CaptureFailed({ message: "The capture answered nothing" }))
  }
  return JSON.parse(captured.value) as Captured
})

/**
 * Captures every current document of a page, its frames' included, for a recording's stream; a frame whose capture
 * fails is left out, and its next capture is made with no references, since its numbering went on without it. A
 * page with a prompt open isn't captured.
 */
export const capturePage = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  stream: string,
  target: Option.Option<CaptureTarget>,
  failed: Set<Target.DocumentId>
): Effect.Effect<ReadonlyArray<FrameCapture>> =>
  Effect.gen(function*() {
    const state = yield* SubscriptionRef.get(page.state)
    // A prompt open blocks evaluation on Chromium and WebKit: nothing is captured, so nothing is numbered
    if (state._tag !== "Open" || Option.isSome(state.prompt)) return []
    const tree = yield* SubscriptionRef.get(page.tree)
    const documents: Array<
      { readonly frame: Target.NavigableId; readonly main: boolean; readonly document: Target.DocumentId }
    > = []
    documents.push({ frame: page.id, main: true, document: state.document.id })
    for (const frame of tree.frames) {
      if (Option.isSome(frame.document)) {
        documents.push({ frame: frame.id, main: false, document: frame.document.value })
      }
    }
    const captures = yield* Effect.forEach(documents, ({ document, frame, main }) =>
      captureDocument(runtime, document, { stream, reset: failed.has(document) }, target).pipe(
        // A capture is best-effort: one the page holds up is given up, and the next starts afresh
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(new CaptureFailed({ message: "The capture took longer than 5 seconds" }))
        }),
        Effect.map((captured): Option.Option<FrameCapture> => {
          failed.delete(document)
          return Option.some({ frame, main, captured })
        }),
        Effect.catch(() =>
          Effect.sync(() => {
            failed.add(document)
            return Option.none<FrameCapture>()
          })
        )
      ), { concurrency: "unbounded" })
    return captures.flatMap(Option.toArray)
  })
