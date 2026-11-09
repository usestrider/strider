import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { recorder } from "../src/benchmarks/cost-profiler.ts"

it("retains CPU/allocation capture and phase boundaries when a diagnostic action fails", async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cost-recorder-"))
  const profile = await recorder("synthetic-instrumentation-check", output)
  try {
    await assert.rejects(
      profile.phase("failed-action", async () => {
        await new Promise<void>((resolve) => setImmediate(resolve))
        throw new Error("synthetic diagnostic failure")
      }),
      /synthetic diagnostic failure/
    )
    await profile.finish(false)
    const capture = JSON.parse(fs.readFileSync(path.join(output, "capture.json"), "utf8"))
    assert.equal(capture.success, false)
    assert.equal(capture.phases.length, 1)
    const phase = capture.phases[0]
    assert.equal(phase.complete, true)
    assert.ok(phase.start <= phase.actionStart && phase.actionStart <= phase.actionEnd && phase.actionEnd <= phase.end)
    assert.ok(JSON.parse(fs.readFileSync(path.join(output, "failed-action.cpuprofile"), "utf8")).nodes.length > 0)
    assert.ok(JSON.parse(fs.readFileSync(path.join(output, "failed-action.heapprofile"), "utf8")).head)
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
})
