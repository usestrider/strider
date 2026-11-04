// Loaded only by query-profile-loader.mjs; never imported by the browser package.
import * as Effect from "effect/Effect"

export interface Span {
  readonly name: string
  readonly start: number
  readonly end: number
}
export interface Wire {
  readonly direction: "send" | "receive"
  readonly at: number
  readonly text: string
}
export interface Capture {
  readonly start: number
  readonly spans: Array<Span>
  readonly wire: Array<Wire>
  readonly chunks: Array<{ at: number; bytes: number }>
}
export const state = { active: undefined as Capture | undefined }
export const sync = <A>(name: string, run: () => A): A => {
  if (state.active === undefined) return run()
  const capture = state.active
  const start = performance.now()
  try {
    return run()
  } finally {
    capture.spans.push({ name, start, end: performance.now() })
  }
}
export const effect = <A, E, R>(name: string, run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (state.active === undefined) return run
    const capture = state.active
    const start = performance.now()
    return run.pipe(Effect.ensuring(Effect.sync(() => {
      capture.spans.push({ name, start, end: performance.now() })
    })))
  })
export const chunk = (bytes: number) => {
  state.active?.chunks.push({ at: performance.now(), bytes })
}
export const wire = (direction: Wire["direction"], text: string) => {
  state.active?.wire.push({ direction, at: performance.now(), text })
}
// The pinned Playwright server bundle is CommonJS, so it accesses these diagnostic hooks through a symbol.
Object.assign(globalThis, {
  [Symbol.for("strider.queryProfile")]: {
    sync,
    out: (value: unknown) => wire("send", JSON.stringify(value)),
    parse: (text: string) => {
      wire("receive", text)
      return sync("pw.JSON.parse", () => JSON.parse(text))
    }
  }
})
