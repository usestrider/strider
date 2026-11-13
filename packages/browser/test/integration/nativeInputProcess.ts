/** Lightweight test-only process hook; Node preloads do not load the Effect capture implementation. */
export const flags = [
  "--enable-logging=stderr",
  "--v=0",
  "--vmodule=render_widget_host_input_event_router=2,render_widget_targeter=2,render_input_router=2,input_router_impl=2,hit_test_query=2,hit_test_manager=2,hit_test_aggregator=2,host_frame_sink_manager=2,input_handler=1"
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
