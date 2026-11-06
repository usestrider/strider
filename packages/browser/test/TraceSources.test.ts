import { assert, it } from "@effect/vitest"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { createHash } from "node:crypto"
import { vi } from "vitest"
import * as Diagnostics from "../src/Diagnostics.ts"
import * as Capabilities from "../src/internal/capabilities.ts"
import * as Events from "../src/internal/events.ts"
import type * as Model from "../src/internal/model.ts"
import * as Operation from "../src/internal/operation.ts"
import type * as Runtime from "../src/internal/runtime.ts"
import * as Trace from "../src/internal/trace.ts"
import * as Tracing from "../src/internal/tracing.ts"
import * as Target from "../src/Target.ts"

it.effect("exports caller locations and viewer source entries even with tracing suppressed", () =>
  Effect.scoped(Effect.gen(function*() {
    const exports: Array<Uint8Array> = []
    const id = "source-page" as Target.NavigableId
    const page = {
      id,
      events: {
        console: Events.make({ _tag: "Page", id }, () => 100),
        exception: Events.make({ _tag: "Page", id }, () => 100)
      }
    } as Model.PageEntry
    const file = new URL(import.meta.url).pathname
    const runtime = {
      model: { page: () => Option.some(page), adapter: { info: { protocol: "cdp" } } },
      fileSystem: Option.some(FileSystem.makeNoop({
        readFile: (path) => Effect.succeed(new TextEncoder().encode(`source of ${path}`)),
        makeDirectory: () => Effect.void,
        writeFile: (_path, content) => Effect.sync(() => void exports.push(content))
      })),
      path: Option.none()
    } as unknown as Runtime.Runtime
    const trace = yield* Trace.start(runtime, { _tag: "Page", entry: page }, {
      screenshots: "off",
      screencast: "off",
      domSnapshots: false,
      network: false
    }, yield* Effect.scope)
    const action = Operation.fn("Page.source", { attributes: { "browser.page.id": id } })(function*() {
      yield* Effect.void
    })
    yield* action().pipe(Effect.withSpan("caller", { captureStackTrace: () => `at caller (${file}:40:5)` }))
    yield* action().pipe(Effect.provideService(Tracing.TracerDisabledWhen, () => true))
    yield* trace.exportTrace("/trace.zip")
    const entries = yield* Stream.make(exports[0]!).pipe(
      Stream.pipeThroughChannel(Zip.decode()),
      Stream.mapEffect((entry) =>
        Stream.mkUint8Array(entry.body).pipe(Effect.map((content) => [entry.header.path, content] as const))
      ),
      Stream.runCollect
    )
    const files = new Map(entries)
    const events = new TextDecoder().decode(files.get("trace.trace")).trim().split("\n").map((line) => JSON.parse(line))
    const actions = events.filter((event) => event.type === "before" && event.title === "Page.source")
    assert.strictEqual(actions.length, 2)
    for (const action of actions) {
      assert.strictEqual(action.stack[0].file, file)
      assert.isAbove(action.stack[0].line, 0)
      assert.isAbove(action.stack[0].column, 0)
    }
    const caller = events.find((event) => event.type === "before" && event.title === "caller")
    assert.deepStrictEqual(caller.stack, [{ file, line: 40, column: 5, function: "caller" }])
    const source = `src/${createHash("sha1").update(file).digest("hex")}.ts`
    assert.strictEqual(new TextDecoder().decode(files.get(source)), `source of ${file}`)
  })))
