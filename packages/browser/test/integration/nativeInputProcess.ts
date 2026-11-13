/** Lightweight test-only process hook; Node preloads do not load the Effect capture implementation. */
export const flags = [
  "--enable-logging=stderr"
] as const

interface Capture {
  readonly directory: string
  processStarted(pid: number | undefined, args: unknown): void
  stderrChunk(chunk: unknown): void
  stderrEnd(eof: boolean): void
}
const processKey = Symbol.for("strider.integration.nativeInputProcess")
type CaptureGlobal = typeof globalThis & { [processKey]?: Capture }
export const selectProcessCapture = (capture: Capture | undefined) => {
  Object.assign(globalThis, { [processKey]: capture })
}
export const processCapture = (args: ReadonlyArray<string> | undefined): Capture | undefined =>
  args?.includes(flags[2]) ? (globalThis as CaptureGlobal)[processKey] : undefined
