import { spawn } from "node:child_process"
import { expect, it } from "vitest"
it("retains owned stderr and exit", async () => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.stderr.write(\"OWNED_STDERR\"); process.exitCode = 7"])
    child.stderr.resume()
    child.on("error", reject)
    child.on("close", () => resolve())
  })
  expect(false).toBe(true)
})
