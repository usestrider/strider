/** Temporary diagnostic checkpoint, serialized before native stream reads. */
import * as fs from "node:fs"
import type { TraceBuffer } from "./failureTrace.ts"
export const checkpoint = (file: string, trace: TraceBuffer, context: unknown) => {
  const entries = trace.entries()
  const text =
    [JSON.stringify({ kind: "context", context }), ...entries.map((entry) => JSON.stringify(entry))].join("\n") + "\n"
  fs.writeFileSync(file, text, { flag: "wx" })
  const accounting = {
    records: entries.length,
    firstSequence: entries.find((entry) => entry.sequence > 0)?.sequence,
    lastSequence: entries.at(-1)?.sequence,
    overflow: entries.filter((entry) => entry.kind === "overflow"),
    truncated: entries.filter((entry) => entry.truncated),
    wireTruncations: entries.filter((entry) => entry.kind === "wire-truncation")
  }
  fs.writeFileSync(file + ".accounting.json", JSON.stringify(accounting, null, 2), { flag: "wx" })
  return text
}
