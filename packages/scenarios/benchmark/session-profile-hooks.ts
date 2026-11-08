// Diagnostic hooks loaded only by session-profile-loader.mjs. No production files are modified.
import * as Effect from "effect/Effect"
import * as fs from "node:fs"

const output = process.env["STRIDER_SESSION_PROFILE"]
if (!output) throw new Error("STRIDER_SESSION_PROFILE must name a new absolute JSONL file")
const fd = fs.openSync(output, "wx")
let active: { start: number; expected: string; events: Array<unknown> } | undefined
let sequence = 0
export const event = (kind: string, data: unknown) => {
  active?.events.push({ at: performance.now(), kind, data })
}
export const value = <A>(result: A): A => {
  event("verification.end", {})
  return result
}
export const outgoing = (text: string) => {
  event("send", JSON.parse(text))
  return text
}
export const incoming = (text: string) => {
  event("receive", JSON.parse(text))
  return text
}
export const effect = <A, E, R>(name: string, run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const id = sequence++
    event("start", { id, name })
    return run.pipe(Effect.ensuring(Effect.sync(() => event("end", { id, name }))))
  })
export const promise = async <A>(name: string, run: () => Promise<A>): Promise<A> => {
  const id = sequence++
  event("start", { id, name })
  try {
    return await run()
  } finally {
    event("end", { id, name })
  }
}
export const scenario = async <A>(run: () => Promise<A>, expected: string): Promise<A> => {
  const capture = { start: performance.now(), expected, events: [] as Array<unknown> }
  active = capture
  let outcome = "failed"
  try {
    const result = await run()
    outcome = String(result)
    return result
  } finally {
    active = undefined
    fs.writeSync(fd, JSON.stringify({ ...capture, end: performance.now(), outcome }) + "\n")
  }
}
Object.assign(globalThis, {
  [Symbol.for("strider.sessionProfile")]: {
    out: (value: unknown) => event("send", value),
    parse: (text: string) => {
      const value = JSON.parse(text)
      event("receive", value)
      return value
    }
  }
})
