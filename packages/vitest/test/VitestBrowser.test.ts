/**
 * The Vitest adapter: `TestRun` for the test running, read each time, and its attachments.
 */
import { assert, describe, it } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { TestRunner } from "vitest"

describe("VitestBrowser", () => {
  it.effect("describes the test running, and attaches its files", () =>
    Effect.gen(function*() {
      const run = yield* TestRun.TestRun
      assert.include(run.info.id, "VitestBrowser > describes the test running, and attaches its files")
      assert.include(run.info.file, "VitestBrowser.test.ts")
      assert.strictEqual(run.info.attempt, 0)
      yield* run.attach({ _tag: "Screenshot", path: "test/VitestBrowser.test.ts" as never })
      const test = TestRunner.getCurrentTest()!
      assert.deepInclude(
        test.artifacts.map((artifact) => artifact.type),
        "@usestrider/browser"
      )
    }).pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>))))

  it("reads the current test each time", () => {
    const { info } = Effect.runSync(
      TestRun.TestRun.pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>)))
    )
    assert.include(info.id, "reads the current test each time")
  })
})

it("names traces deterministically without traversal or slug collisions", () => {
  const info = new TestRun.TestInfo({
    project: "chrome",
    file: "../../a.test.ts",
    id: "../a/b",
    attempt: 0,
    worker: "1",
    shard: ""
  })
  const name = VitestBrowser.traceFileName(info)
  assert.match(name, /^[a-zA-Z0-9_-]+\.zip$/)
  assert.isBelow(name.length, 150)
  assert.strictEqual(VitestBrowser.traceFileName(info), name)
  for (
    const changed of [
      { id: "../a?b" },
      { project: "firefox" },
      { file: "../../b.test.ts" },
      { attempt: 1 },
      { id: "a".repeat(1000) },
      { id: "🦆" },
      { id: "" }
    ]
  ) {
    const other = VitestBrowser.traceFileName(new TestRun.TestInfo({ ...info, ...changed }))
    assert.notStrictEqual(other, name)
    assert.match(other, /^[a-zA-Z0-9_-]+\.zip$/)
    assert.isBelow(other.length, 150)
  }
})
