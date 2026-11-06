// Copied beside the installed package's src/ directory by pack-check, then run in Node.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Browser, Trace } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const file = fileURLToPath(import.meta.url)
const source = fs.readFileSync(file, "utf8")
const output = path.join(path.dirname(file), "trace.zip")

await Effect.runPromise(
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const trace = yield* Trace.record(page)
    // The test backend has no DOM. Its refusal still records the public getter's call site.
    yield* Effect.exit(page.title)
    yield* trace.exportTrace(output)
  }).pipe(
    Effect.scoped,
    Effect.provide(Browser.layerTest("").pipe(Layer.provideMerge(NodeFileSystem.layer)))
  )
)

const entries = await Effect.runPromise(
  Stream.make(new Uint8Array(fs.readFileSync(output))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.mkUint8Array(entry.body).pipe(
        Effect.map((content) => [entry.header.path, content])
      )
    ),
    Stream.runCollect
  )
)
const files = new Map(entries)
const events = new TextDecoder().decode(files.get("trace.trace")).trim().split("\n").map((line) => JSON.parse(line))
const step = events.find((event) => event.type === "before" && event.title === "Page.title")
const lines = source.split("\n")
const line = lines.findIndex((line) => line.trim() === "yield* Effect.exit(page.title)")
assert.ok(line >= 0)
assert.deepEqual(step.stack?.[0], {
  file,
  line: line + 1,
  column: lines[line].indexOf("title") + 1,
  function: "Page.title"
})
const archived = `src/${createHash("sha1").update(file).digest("hex")}.mjs`
assert.equal(new TextDecoder().decode(files.get(archived)), source)
console.log(
  `trace sources: caller coordinates and source bytes match (${process.sourceMapsEnabled ? "source maps" : "plain"})`
)
