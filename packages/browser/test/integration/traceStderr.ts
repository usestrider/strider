/** Decode byte views without including bytes outside their offset/length. */
export const stderrText = (chunk: unknown): string =>
  chunk instanceof Uint8Array
    ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("utf8")
    : String(chunk)
