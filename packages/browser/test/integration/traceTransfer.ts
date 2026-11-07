/** Fixed-size, synchronous test-only spools: no IPC queue, stdio reader or exit wait. */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Entry, Record } from "./failureTrace.ts"

export const transferVariable = "STRIDER_TEST_TRACE_SPOOL"
export const processSlots = 128
export const segmentBytes = 128 * 1024
export interface RecordedChild extends Entry {
  readonly pid: number
}
export class TransferScope {
  private directory: string | undefined
  private record: Record | undefined
  private readonly connect: () => Record
  constructor(connect: () => Record) {
    this.connect = connect
  }
  open() {
    if (this.directory === undefined) {
      this.directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-test-trace-"))
      this.record = this.connect()
    }
    return this.directory
  }
  close() {
    const directory = this.directory
    if (directory === undefined) return
    try {
      if (fs.existsSync(path.join(directory, "overflow"))) {
        this.record?.("overflow", "Child process slot budget exhausted")
      }
      for (let slot = 0; slot < processSlots; slot++) {
        const entries: Array<RecordedChild> = []
        for (let segment = 0; segment < 2; segment++) {
          const file = path.join(directory, `${slot}-${segment}`)
          try {
            // A concurrent append may leave one incomplete final line. Never read above the segment bound.
            const fd = fs.openSync(file, "r")
            try {
              const data = Buffer.alloc(segmentBytes)
              const size = fs.readSync(fd, data, 0, data.length, 0)
              const lines = data.subarray(0, size).toString("utf8").split("\n")
              lines.pop()
              for (const line of lines) {
                try {
                  entries.push(JSON.parse(line))
                } catch { /* A rotating writer can replace a segment. */ }
              }
            } finally {
              fs.closeSync(fd)
            }
          } catch { /* Unused slot or a process that has not recorded yet. */ }
        }
        entries.sort((a, b) => a.sequence - b.sequence)
        if (entries[0]?.sequence && entries[0].sequence > 1) {
          this.record?.("overflow", { slot, note: "Earlier child records evicted" })
        }
        for (const entry of entries) {
          const { payload, kind, ...origin } = entry
          this.record?.(kind, payload, origin)
        }
      }
    } finally {
      // Late descendants cannot recreate this directory or enter the next test's spool.
      fs.rmSync(directory, { recursive: true, force: true })
      this.directory = undefined
      this.record = undefined
    }
  }
}

let current: (() => TransferScope | undefined) | undefined
export const installTransfer = (scope: () => TransferScope | undefined) => {
  current = scope
}
export interface SpawnOptions {
  readonly file: string
  args?: Array<string> | undefined
  envPairs?: Array<string> | undefined
}
export const prepareChild = (options: SpawnOptions) => {
  if (options.file !== process.execPath) return
  const scope = current?.()
  if (scope === undefined) return
  const directory = scope.open()
  const preload = new URL("./tracePreload.ts", import.meta.url).href
  options.args = [options.args![0]!, `--import=${preload}`, ...options.args!.slice(1)]
  options.envPairs = [
    ...(options.envPairs ?? []).filter((pair) => !pair.startsWith(`${transferVariable}=`)),
    `${transferVariable}=${directory}`
  ]
}
