import { spawn } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { expect, it } from "vitest"
it("retains owned stderr and exit", async () => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-e",
      "const fs = require(\"node:fs\"); fs.readFileSync(3); fs.writeSync(4, \"PIPE_RECEIVE\\0\"); process.stderr.write(\"OWNED_STDERR\"); process.exitCode = 7",
      "--",
      "--remote-debugging-pipe"
    ], {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
    })
    child.stderr!.resume()
    const input = child.stdio[3] as Writable
    input.write("PIPE_SEND\0")
    input.end()
    ;(child.stdio[4] as Readable).resume()
    child.on("error", reject)
    child.on("close", () => resolve())
  })
  expect(false).toBe(true)
})
