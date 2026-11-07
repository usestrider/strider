/** Runs a genuinely failing Vitest callback, without the integration runner's own trace recorder. */
import { Effect, Stream } from "effect"
import * as Zip from "effect/encoding/Zip"
import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { assert, it } from "vitest"

it("exports and attaches the real failed callback, keeping successful callbacks artifact-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strider-vitest-traces-"))
  try {
    const result = await promisify(execFile)(process.execPath, [
      "node_modules/vitest/vitest.mjs",
      "--run",
      "--config",
      "packages/vitest/test/fixtures/vitest.config.ts"
    ], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: { ...process.env, STRIDER_VITEST_TRACES: directory },
      timeout: 120_000
    }).then(
      () => ({ code: 0, stdout: "", stderr: "" }),
      (error: { code: number; stdout: string; stderr: string }) => error
    )
    assert.equal(result.code, 1, result.stdout + result.stderr)
    assert.include(result.stderr, "expected failure fixture")
    const tasks = JSON.parse(await readFile(join(directory, "tasks.json"), "utf8"))
    assert.equal(tasks[0].state, "fail")
    assert.equal(tasks[0].artifacts.length, 1)
    assert.equal(tasks[1].state, "pass")
    assert.equal(tasks[1].artifacts.length, 0)
    assert.equal(tasks[2].state, "pass")
    assert.equal(tasks[2].artifacts.length, 0)
    const files = await readdir(directory, { recursive: true })
    assert.equal(files.filter((file) => file.startsWith("context-") && file.endsWith(".zip")).length, 1)
    const attachment = tasks[0].artifacts[0].attachments[0]
    assert.equal(attachment.contentType, "application/zip")
    const bytes = await readFile(attachment.path)
    const entries = new Map(
      await Effect.runPromise(
        Stream.make(new Uint8Array(bytes)).pipe(
          Stream.pipeThroughChannel(Zip.decode()),
          Stream.mapEffect((entry) =>
            Stream.mkUint8Array(entry.body).pipe(
              Effect.map((body) => [entry.header.path, body] as const)
            )
          ),
          Stream.runCollect
        )
      )
    )
    const lines = new TextDecoder().decode(entries.get("trace.trace")).trim().split("\n").map((line) =>
      JSON.parse(line)
    )
    assert.include(lines[0].striderTest.id, "failed assertion")
    assert.equal(lines[0].striderTest.attempt, 0)
    assert.isTrue(lines.some((event) => event.type === "frame-snapshot"))
    assert.isTrue(lines.some((event) => event.type === "screenshot"))
    assert.isTrue(entries.has("trace.network"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 150_000)
