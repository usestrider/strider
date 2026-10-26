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
