/** Chromium's NUL framing, with a bounded independent prefix even if a message spans many chunks. */
import { Buffer } from "node:buffer"

export const pipeObserver = (trace: (kind: string, payload: unknown) => void, kind: string) => {
  const prefix = Buffer.alloc(32 * 1024)
  let kept = 0
  let bytes = 0
  return (chunk: string | Uint8Array) => {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
    let at = 0
    while (at < buffer.length) {
      const nul = buffer.indexOf(0, at)
      const end = nul < 0 ? buffer.length : nul
      const take = Math.min(end - at, prefix.length - kept)
      prefix.set(buffer.subarray(at, at + take), kept)
      kept += take
      bytes += end - at
      if (nul < 0) break
      trace(kind, prefix.toString("utf8", 0, kept))
      if (bytes > kept) trace("wire-truncation", { direction: kind, originalBytes: bytes, retainedBytes: kept })
      kept = 0
      bytes = 0
      at = nul + 1
    }
  }
}
