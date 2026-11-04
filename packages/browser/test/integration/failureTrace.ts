/** Bounded diagnostic history; independent of the optional drift fixture sampler. */
export interface Entry {
  readonly sequence: number
  readonly timestamp: string
  readonly connection: string
  readonly kind: string
  readonly payload: string
  readonly truncated?: boolean
  readonly originalLength?: number
}

export class TraceBuffer {
  private history: Array<{ entry: Entry; size: number }> = []
  private sequence = 0
  private dropped = 0
  bytes = 0
  constructor(readonly limit = 2 * 1024 * 1024, readonly messageLimit = 32 * 1024) {}
  record(connection: string, kind: string, payload: string) {
    const entry: Entry = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      connection,
      kind,
      payload: payload.slice(0, this.messageLimit),
      ...(payload.length > this.messageLimit ? { truncated: true, originalLength: payload.length } : {})
    }
    const size = JSON.stringify(entry).length * 2
    if (size > this.limit) {
      this.dropped++
      return
    }
    while (this.bytes + size > this.limit) {
      this.bytes -= this.history.shift()!.size
      this.dropped++
    }
    this.history.push({ entry, size })
    this.bytes += size
  }
  entries(): Array<Entry> {
    const entries = this.history.map(({ entry }) => entry)
    return this.dropped === 0 ? entries : [{
      sequence: 0,
      timestamp: entries[0]?.timestamp ?? new Date().toISOString(),
      connection: "recorder",
      kind: "overflow",
      payload: `${this.dropped} earlier entries omitted`
    }, ...entries]
  }
  clear() {
    this.history = []
    this.bytes = 0
    this.dropped = 0
  }
}

interface Sink {
  connection(label: string): (kind: string, payload: unknown) => void
}
const key = Symbol.for("strider.integration.failureTrace")
export const install = (sink: Sink) => {
  Object.assign(globalThis, { [key]: sink })
}
/** Used only by the integration configuration's source instrumentation. */
export const connection = (label: string): (kind: string, payload: unknown) => void =>
  (globalThis as typeof globalThis & { [key]?: Sink })[key]?.connection(label) ?? (() => {})
