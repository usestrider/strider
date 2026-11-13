/**
 * Test-only record of which document receives each trusted pointer event in Chromium. Installed by the failure
 * trace's Transport instrumentation; nothing under `src/` changes and runs without the recorder never load it.
 *
 * On every `Target.attachedToTarget` for a page or frame target, the tap sends three extra commands on that
 * session before the library's own, so a target paused at start has them before its first document runs: an
 * isolated world's binding (`Runtime.addBinding`) and a script run in every new document of that world
 * (`Page.addScriptToEvaluateOnNewDocument`). The script adds capture-phase, passive listeners on `window`, which
 * neither stop nor reorder anything and are invisible to the document's own scripts. Each trusted
 * `pointer*`/`mouse*`/`click` event calls the binding with its document, type, coordinates, target and the page's
 * `performance.now()` and time origin. The tap swallows only its own replies and `Runtime.bindingCalled` events;
 * every other message reaches the library unchanged. `STRIDER_POINTER_CAPTURE=0` leaves the capture out (the
 * dispatched mouse commands and attachments are still recorded), to compare a run's timing with and without it.
 */
import type { Record } from "./failureTrace.ts"

const binding = "__striderPointerRecipient"
const world = "strider-pointer-recipients"
const types = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "mousemove",
  "click"
]
const limit = 256

const script = `(() => {
  const types = ${JSON.stringify(types)}
  let count = 0
  const describe = (node) => {
    if (!(node instanceof Element)) return node === document ? "#document" : node === window ? "#window" : String(node)
    return node.localName + (node.id ? "#" + node.id : "")
  }
  const listener = (event) => {
    if (!event.isTrusted) return
    const send = globalThis.${binding}
    if (typeof send !== "function") return
    if (count >= ${limit}) { if (count++ === ${limit}) send(JSON.stringify({ type: "capped", href: location.href.slice(0, 200) })); return }
    count++
    send(JSON.stringify({
      type: event.type,
      isTrusted: event.isTrusted,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      buttons: event.buttons,
      target: describe(event.target),
      href: location.href,
      top: window === window.top,
      name: window.name,
      ancestors: location.ancestorOrigins ? Array.from(location.ancestorOrigins) : null,
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
      eventTimeStamp: event.timeStamp
    }))
  }
  for (const type of types) window.addEventListener(type, listener, { capture: true, passive: true })
})()`

export interface Tap {
  inject: ((message: string) => void) | undefined
  send(message: string): void
  /** Returns true when the message is the tap's own and must not reach the library. */
  receive(message: unknown): boolean
}

export const pointerTap = (trace: Record): Tap => {
  let nextId = 2 ** 30
  const owned = new Map<number, { method: string; sessionId: string }>()
  const sessions = new Map<string, { targetId: string; type: string; url: string }>()
  const command = (tap: Tap, sessionId: string, method: string, params: object) => {
    const id = nextId++
    owned.set(id, { method, sessionId })
    tap.inject!(JSON.stringify({ id, method, params, sessionId }))
  }
  const tap: Tap = {
    inject: undefined,
    send(message) {
      if (!message.includes("\"Input.dispatchMouseEvent\"")) return
      try {
        const sent = JSON.parse(message) as { params?: { type?: string; x?: number; y?: number }; sessionId?: string }
        trace("pointer-dispatch", {
          sessionId: sent.sessionId ?? null,
          type: sent.params?.type,
          x: sent.params?.x,
          y: sent.params?.y
        })
      } catch {}
    },
    receive(message) {
      if (typeof message !== "string") return false
      if (message.startsWith("{\"method\":\"Target.attachedToTarget\"")) {
        try {
          const event = JSON.parse(message) as {
            params: { sessionId: string; targetInfo: { targetId: string; type: string; url: string } }
          }
          const { sessionId, targetInfo } = event.params
          if (tap.inject !== undefined && (targetInfo.type === "page" || targetInfo.type === "iframe")) {
            sessions.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url })
            if (process.env.STRIDER_POINTER_CAPTURE === "0") {
              trace("pointer-capture-disabled", { sessionId, ...sessions.get(sessionId) })
              return false
            }
            command(tap, sessionId, "Runtime.addBinding", { name: binding, executionContextName: world })
            command(tap, sessionId, "Page.addScriptToEvaluateOnNewDocument", {
              source: script,
              worldName: world,
              runImmediately: true
            })
            trace("pointer-capture-installed", { sessionId, ...sessions.get(sessionId) })
          }
        } catch {}
        return false
      }
      if (message.startsWith("{\"method\":\"Runtime.bindingCalled\"") && message.includes(binding)) {
        try {
          const event = JSON.parse(message) as { params: { name: string; payload: string }; sessionId?: string }
          if (event.params.name !== binding) return false
          const sessionId = event.sessionId ?? null
          trace("pointer-recipient", {
            sessionId,
            target: sessionId === null ? null : sessions.get(sessionId) ?? null,
            ...JSON.parse(event.params.payload) as object
          })
          return true
        } catch {
          return false
        }
      }
      if (owned.size > 0) {
        const match = /^\{"id":(\d+),/.exec(message)
        const mine = match === null ? undefined : owned.get(Number(match[1]))
        if (mine !== undefined) {
          owned.delete(Number(match![1]))
          if (message.includes("\"error\"")) trace("pointer-capture-error", { ...mine, reply: message.slice(0, 512) })
          return true
        }
      }
      return false
    }
  }
  return tap
}

export interface Summarized {
  readonly kind: string
  readonly sequence: number
  readonly payload: string
}

/**
 * For every dispatched `mousePressed`, which documents received a `mousedown` before the next press: an empty
 * list means no document with the capture installed received it. It doesn't know which document should have, so a
 * wrong recipient reads as a recipient that isn't the expected one.
 */
export const summarize = (entries: ReadonlyArray<Summarized>) => {
  const ordered = entries.filter((entry) => entry.kind === "pointer-dispatch" || entry.kind === "pointer-recipient")
    .sort((a, b) => a.sequence - b.sequence)
  const presses: Array<{ x: unknown; y: unknown; sessionId: unknown; recipients: Array<Record2> }> = []
  for (const entry of ordered) {
    const payload = JSON.parse(entry.payload) as Record2
    if (entry.kind === "pointer-dispatch") {
      if (payload.type === "mousePressed") {
        presses.push({ x: payload.x, y: payload.y, sessionId: payload.sessionId, recipients: [] })
      }
    } else if (payload.type === "mousedown") presses.at(-1)?.recipients.push(payload)
  }
  return presses.map((press) => ({
    x: press.x,
    y: press.y,
    sessionId: press.sessionId,
    outcome: press.recipients.length === 0 ? "no document received a mousedown" : "received",
    recipients: press.recipients.map((r) => ({ href: r.href, top: r.top, target: r.target, x: r.x, y: r.y }))
  }))
}
type Record2 = { [key: string]: any }
