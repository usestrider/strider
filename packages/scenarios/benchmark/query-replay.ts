// Offline diagnostic lower bound for eliminating an intermediate tree, not a production decoder or fast path.
import * as Schema from "effect/Schema"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as Runtime from "../../browser/src/cdp/Runtime.ts"
import type * as Adapter from "../../browser/src/internal/adapter.ts"
import * as CdpEvaluation from "../../browser/src/internal/cdpAdapter/evaluation.ts"
import * as Serialization from "../../browser/src/internal/serialization.ts"

const input = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"))
const convert = Reflect.get(CdpEvaluation, "queryProfileToRemoteValue") as (
  value: Runtime.DeepSerializedValue,
  documentOf: () => undefined
) => Adapter.RemoteValue
assert.equal(typeof convert, "function", "Run with query-profile-loader.mjs")
// This intentionally refuses everything outside the captured plain-value tree. It is only a lower-bound probe;
// a production design would need every existing type, omission, depth, error-path and lifecycle guarantee.
const direct = (value: Runtime.DeepSerializedValue): unknown => {
  switch (value.type) {
    case "null":
      return null
    case "undefined":
      return undefined
    case "boolean":
    case "string":
    case "number":
      return value.value
    case "array":
      return (value.value as Array<Runtime.DeepSerializedValue>).map(direct)
    case "object":
      return Object.fromEntries((value.value as Array<[string, Runtime.DeepSerializedValue]>)
        .map(([key, item]) => [key, direct(item)]))
    default:
      throw new Error(`Unsupported diagnostic type ${value.type}`)
  }
}
const decode = Schema.decodeUnknownSync(Runtime.CallFunctionOnResult)
const results = []
for (const name of ["dom100-result100", "dom1000-result1000", "dom1000-result100", "dom0-result1000"]) {
  const sample = input.samples.find((sample: { library: string; name: string }) =>
    sample.library === "strider" && sample.name === name
  )
  const payloads = sample.capture.wire.filter((entry: { direction: string }) => entry.direction === "receive")
    .map((entry: { text: string }) => entry.text)
  const text = payloads.find((text: string) => JSON.parse(text).result?.result?.deepSerializedValue !== undefined)
  assert.ok(text)
  const envelope = JSON.parse(text)
  const deep: Runtime.DeepSerializedValue = envelope.result.result.deepSerializedValue
  const normal = () => Serialization.fromRemote(convert(deep, () => undefined))
  assert.deepEqual(direct(deep), normal())
  const timings: Record<string, Array<number>> = {
    parse: [],
    validate: [],
    convert: [],
    decode: [],
    pipeline: [],
    direct: []
  }
  const remote = convert(deep, () => undefined)
  for (let i = -20; i < 200; i++) {
    const work = {
      parse: () => JSON.parse(text),
      validate: () => decode(envelope.result),
      convert: () => convert(deep, () => undefined),
      decode: () => Serialization.fromRemote(remote),
      pipeline: normal,
      direct: () => direct(deep)
    }
    const keys = Object.keys(work) as Array<keyof typeof work>
    for (const key of i % 2 === 0 ? keys : keys.reverse()) {
      const start = performance.now()
      work[key]()
      const ms = performance.now() - start
      if (i >= 0) timings[key]!.push(ms)
    }
  }
  results.push({ name, bytes: Buffer.byteLength(text), timings })
}
fs.writeFileSync(
  process.argv[3]!,
  JSON.stringify({ kind: "offline-host-replay-not-end-to-end", input: process.argv[2], results }, null, 2)
)
