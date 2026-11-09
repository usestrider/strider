/**
 * Temporary Linux Firefox job probe, loaded only by the integration source hooks / process observer.
 * `.data/firefox-packets/` is written as events arrive, independently of the failure-only recorder.
 * At most 16 process slots, 32 MiB each (512 MiB total), plus one fixed slot-exhaustion marker.
 * Each file stops with capture-limit; it never silently rotates away the original stall. Per-line parsing
 * retains at most 4096 characters. Firefox packet logging has a 2500-character cutoff plus a truncation suffix.
 * Only packet identity is saved. The ordinary failure recorder still has its own, separate retention bounds.
 *
 * hostUtc and hostMonotonicNs are observations in the Node process; browserEpochMs comes from Firefox's
 * logger before sending / on receipt. A stderr callback may deliver that older browser timestamp much later.
 * Browser pid + endpoint bind a browser connection to a host endpoint; packet IDs are local to each connection.
 * No browser waits, retries, timer probes, or exit hooks. Logging itself can perturb scheduling. Disk errors,
 * exhausted slots, unsupported WebSocket payloads, truncated lines and missing final newline limit coverage.
 */
import type * as Socket from "effect/socket/Socket"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const enabled = process.platform === "linux" && process.env["STRIDER_INTEGRATION_JOB"] === "firefox"
export const slots = 16
export const fileBytes = 32 * 1024 * 1024
export const lineCharacters = 4096
const directory = path.resolve(import.meta.dirname, "../../../../.data/firefox-packets")

/** Keep identity and size, never cookie values, evaluation source or page text. Truncated browser JSON is normal. */
export const packet = (value: unknown) => {
  const text = typeof value === "string" ? value : value instanceof Uint8Array ? Buffer.from(value).toString() : ""
  const head = text.slice(0, lineCharacters)
  const id = /^\s*\{\s*(?:"type"\s*:\s*"[^"]*"\s*,\s*)?"id"\s*:\s*(\d+)/.exec(head)?.[1]
  return {
    id: id === undefined ? null : Number(id),
    method:
      /^\s*\{\s*(?:"type"\s*:\s*"[^"]*"\s*,\s*)?(?:"id"\s*:\s*\d+\s*,\s*)?"method"\s*:\s*"([^"]+)"/.exec(head)?.[1] ??
        null,
    type: /^\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(head)?.[1] ?? null,
    characters: text.length,
    unsupported: typeof value !== "string" && !(value instanceof Uint8Array)
  }
}

/** One finite file, with reserved space for an explicit limit marker. Synchronous writes have no pending queue. */
export class PacketFile {
  private bytes = 0
  private sequence = 0
  private stopped = false
  readonly file: string
  readonly limit: number
  constructor(file: string, limit: number = fileBytes) {
    this.file = file
    this.limit = limit
  }
  record(kind: string, data: object) {
    if (this.stopped) return
    const clock = {
      hostUtc: new Date().toISOString(),
      hostMonotonicNs: String(process.hrtime.bigint()),
      pid: process.pid,
      sequence: ++this.sequence
    }
    let line = JSON.stringify({ ...clock, kind, ...data }) + "\n"
    if (this.bytes + Buffer.byteLength(line) > this.limit - 512) {
      line = JSON.stringify({ ...clock, kind: "capture-limit", limit: this.limit }) + "\n"
      this.stopped = true
    }
    fs.appendFileSync(this.file, line)
    this.bytes += Buffer.byteLength(line)
  }
}

const instance = randomUUID()
let sink: PacketFile | undefined
let attempted = false
const record = (kind: string, data: object) => {
  if (!enabled) return
  try {
    if (!attempted) {
      attempted = true
      fs.mkdirSync(directory, { recursive: true })
      for (let slot = 0; slot < slots; slot++) {
        const file = path.join(directory, `${slot}.ndjson`)
        try {
          fs.closeSync(fs.openSync(file, "wx"))
          sink = new PacketFile(file)
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
      }
      if (sink === undefined) {
        fs.writeFileSync(path.join(directory, "slots-exhausted"), "Additional processes omitted\n")
      }
      sink?.record("capture-start", { instance, slots, fileBytes, lineCharacters, node: process.version })
    }
    sink?.record(kind, data)
  } catch {
    // Diagnostics cannot turn a transport operation into a failure. The log makes capture failure visible.
    console.error("Firefox packet capture unavailable")
    sink = undefined
    attempted = true
  }
}

let nextConnection = 0
type Write = (kind: string, data: object) => void
export const connection = (endpoint: string, options?: { active?: boolean; record?: Write }) => {
  const active = options?.active ?? enabled
  const emit = options?.record ?? record
  const connection = `${process.pid}:${instance}:${++nextConnection}`
  const write = (kind: string, value: unknown) => {
    if (active) emit(kind, { connection, ...packet(value) })
  }
  if (active) emit("native-connection", { connection, endpoint })
  return {
    record: write,
    native<A extends Socket.WebSocketLike>(socket: A): A {
      if (!active) return socket
      const send = socket.send
      socket.send = function(data) {
        write("native-send", data)
        try {
          const result = send.call(this, data)
          write("native-send-return", data)
          return result
        } catch (error) {
          write("native-send-error", data)
          throw error
        }
      }
      // Installed at construction, before Effect's socket reader registers its message listener.
      socket.addEventListener("message", (event) => write("native-message", event.data))
      return socket
    }
  }
}

export const preferences = (prefs: Readonly<Record<string, unknown>>) =>
  enabled ? { ...prefs, "remote.log.level": "Debug", "remote.log.truncate": true } : prefs

/** Merge dump() stdout into the already-drained stderr pipe, keeping the same browser pid and core limits. */
export const command = (
  original: readonly [string, ReadonlyArray<string>],
  executable: string
): readonly [string, ReadonlyArray<string>] => {
  if (!enabled || !/firefox/i.test(executable)) return original
  const [file, args] = original
  return file === "/bin/sh" && args[0] === "-c"
    ? [file, [args[0], `${args[1]} 1>&2`, ...args.slice(2)]]
    : ["/bin/sh", ["-c", "exec \"$@\" 1>&2", "sh", file, ...args]]
}

/** Chunked stderr, bounded even when a line never ends. Browser timestamps stay separate from host receipt. */
export const browserLines = (browserPid: number | undefined, options?: { active?: boolean; record?: Write }) => {
  const active = options?.active ?? enabled
  const emit = options?.record ?? record
  let head = ""
  let omitted = 0
  const line = () => {
    const match = /^(\d+)\s+.*?\b(WebDriverBiDiConnection|WebSocketConnection)\s+(\S+)\s+(->|<-)\s+(.*)$/.exec(head)
    if (match !== null) {
      emit("browser-packet", {
        browserPid,
        browserEpochMs: match[1],
        browserConnection: match[3],
        direction: match[4],
        ...packet(match[5]),
        omittedLineCharacters: omitted
      })
    }
    const endpoint = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(head)?.[1]
    if (endpoint !== undefined) emit("browser-endpoint", { browserPid, endpoint })
    head = ""
    omitted = 0
  }
  return (text: string) => {
    if (!active) return
    let at = 0
    while (at < text.length) {
      const end = text.indexOf("\n", at)
      const stop = end < 0 ? text.length : end
      const kept = Math.min(stop - at, lineCharacters - head.length)
      head += text.slice(at, at + kept)
      omitted += stop - at - kept
      if (end >= 0) line()
      at = stop + 1
    }
  }
}
