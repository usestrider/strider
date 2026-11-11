export type Library = "strider" | "playwright"
export type Command = { library: Library; repetition: number; warmup: boolean } | { done: true }
export const remote = process.env["STRIDER_PAIRED"] === "1"

/** The parent grants one sample at a time; browser work stays in the original callbacks. */
export const remoteSamples = async (
  name: string,
  run: (library: Library, repetition: number, warmup: boolean) => Promise<number>
) => {
  const next = () => new Promise<Command>((resolve) => process.once("message", resolve))
  let command = next()
  process.send!({ type: "ready", name })
  while (true) {
    const value = await command
    if ("done" in value) break
    const ms = await run(value.library, value.repetition, value.warmup)
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid ${name} timing: ${ms}`)
    command = next()
    process.send!({ type: "sample", name, ...value, ms })
  }
}
