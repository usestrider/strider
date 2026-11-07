import { assert, it } from "@effect/vitest"
import { TestRun } from "@usestrider/browser/test"
import * as Schema from "effect/Schema"

const legacy = { project: "chrome", file: "cart.test.ts", id: "pays", attempt: 2, worker: "1", shard: "" }
it("defaults repeat for existing constructors and encoded identities", () => {
  assert.strictEqual(new TestRun.TestInfo(legacy).repeat, 0)
  assert.strictEqual(Schema.decodeUnknownSync(TestRun.TestInfo)(legacy).repeat, 0)
  const repeated = new TestRun.TestInfo({ ...legacy, repeat: 3 })
  assert.strictEqual(repeated.attempt, 2)
  assert.strictEqual(repeated.repeat, 3)
  assert.deepStrictEqual(Schema.encodeSync(TestRun.TestInfo)(repeated), { ...legacy, repeat: 3 })
})
