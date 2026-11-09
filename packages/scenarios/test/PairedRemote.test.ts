import { fork, spawnSync } from "node:child_process"
import { once } from "node:events"
import * as path from "node:path"
import { expect, it } from "vitest"

const driver = path.resolve(import.meta.dirname, "../src/benchmarks/compare-bin.ts")
it("rejects unsupported browser and workload before touching checkouts", () => {
  for (const args of [["--browser", "firefox"], ["--workload", "unknown"], ["--runs", "1"]]) {
    const result = spawnSync(process.execPath, [driver, ...args], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/support only|must be/)
  }
})

it("grants one individual sample at a time and retains warmup identity", async () => {
  const remote = path.resolve(import.meta.dirname, "../src/benchmarks/remote.ts")
  const child = fork("--eval", [
    `const { remoteSamples } = await import(${
      JSON.stringify(remote)
    }); await remoteSamples('fixture', async () => 5); process.disconnect()`
  ], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, STRIDER_PAIRED: "1" } })
  try {
    expect((await once(child, "message"))[0]).toEqual({ type: "ready", name: "fixture" })
    for (const [library, warmup] of [["playwright", true], ["strider", false]] as const) {
      const response = once(child, "message")
      child.send({ library, warmup, repetition: 1 })
      expect((await response)[0]).toEqual({ type: "sample", name: "fixture", library, warmup, repetition: 1, ms: 5 })
    }
    const exit = once(child, "exit")
    child.send({ done: true })
    expect((await exit)[0]).toBe(0)
  } finally {
    child.kill()
  }
}, 10_000)
