import { assert, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as References from "effect/References"
import * as Stream from "effect/Stream"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as Events from "../src/internal/events.ts"
import type * as Model from "../src/internal/model.ts"
import * as Operation from "../src/internal/operation.ts"
import type * as Runtime from "../src/internal/runtime.ts"
import * as Trace from "../src/internal/trace.ts"
import * as Tracing from "../src/internal/tracing.ts"
import * as Target from "../src/Target.ts"

const file = new URL(import.meta.url).pathname
const sourcePath = `src/${createHash("sha1").update(file).digest("hex")}.ts`
const scenario = (run: Effect.Effect<void>, read?: "missing" | "interrupt") =>
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
    const runtime = {
      model: { page: () => Option.some(page), adapter: { info: { protocol: "cdp" } } },
      fileSystem: Option.some(FileSystem.makeNoop({
        readFile: (path) =>
          read === "interrupt"
            ? Effect.interrupt
            : read === "missing"
            ? Effect.fail(
              new PlatformError.PlatformError(
                new PlatformError.SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFile" })
              )
            )
            : Effect.succeed(new TextEncoder().encode(`source of ${path}`)),
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
    yield* run
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
    return { files, events }
  }))

const id = "source-page"
const action = Operation.fn("Page.source", { attributes: { "browser.page.id": id } })(function*() {
  yield* Effect.void
})

it.effect("exports caller locations and viewer source entries even with tracing suppressed", () =>
  Effect.gen(function*() {
    const { files, events } = yield* scenario(Effect.gen(function*() {
      yield* action().pipe(Effect.withSpan("caller", {}, { captureStackTrace: () => `at caller (${file}:40:5)` }))
      yield* action().pipe(Effect.provideService(Tracing.TracerDisabledWhen, () => true))
    }))
    const actions = events.filter((event) => event.type === "before" && event.title === "Page.source")
    assert.strictEqual(actions.length, 2)
    const lines = readFileSync(file, "utf8").split("\n")
    const calls = lines.flatMap((line, index) =>
      line.includes("yield* action().pipe(") ? [{ line: index + 1, column: line.indexOf("action()") + 1 }] : []
    )
    for (const [index, action] of actions.entries()) {
      assert.deepStrictEqual(action.stack[0], { file, ...calls[index], function: "Page.source" })
    }
    const caller = events.find((event) => event.type === "before" && event.title === "caller")
    assert.deepStrictEqual(caller.stack, [{ file, line: 40, column: 5, function: "caller" }])
    assert.strictEqual(new TextDecoder().decode(files.get(sourcePath)), `source of ${file}`)
  }))

for (const read of ["missing", "interrupt"] as const) {
  it.effect(`handles ${read} source reads`, () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(scenario(action(), read))
      if (read === "interrupt") {
        assert(Exit.isFailure(exit))
        assert.isTrue(Cause.hasInterruptsOnly(exit.cause))
      } else {
        assert(Exit.isSuccess(exit))
        assert.isFalse(exit.value.files.has(sourcePath))
        assert.isArray(exit.value.events.find((event) => event.title === "Page.source").stack)
      }
    }))
}

it.effect("omits unavailable stacks", () =>
  Effect.gen(function*() {
    const unavailable = Operation.named("Page.unavailable", { attributes: { "browser.page.id": id } })(Effect.void)
    const { events } = yield* scenario(
      unavailable.pipe(Effect.provideService(References.CurrentStackFrame, {
        name: "Page.unavailable",
        stack: () => undefined,
        parent: undefined
      }))
    )
    assert.isUndefined(events.find((event) => event.title === "Page.unavailable").stack)
  }))

it.effect("captures synchronous named-only public wrappers", () =>
  Effect.gen(function*() {
    const { events } = yield* scenario(Effect.gen(function*() {
      yield* Effect.void.pipe(Operation.named("Page.named", { attributes: { "browser.page.id": id } }))
    }))
    const frame = events.find((event) => event.title === "Page.named").stack[0]
    const lines = readFileSync(file, "utf8").split("\n")
    const line = lines.findIndex((line) => line.includes("yield* Effect.void.pipe(Operation.named(\"Page.named\""))
    assert.deepStrictEqual(frame, {
      file,
      line: line + 1,
      column: lines[line]!.indexOf("Operation.named") + 11,
      function: "Page.named"
    })
  }))

it.effect("respects disabled stack capture", () =>
  Effect.gen(function*() {
    const uncaptured = yield* Effect.sync(() => {
      const limit = Error.stackTraceLimit
      try {
        Error.stackTraceLimit = 0
        return action()
      } finally {
        Error.stackTraceLimit = limit
      }
    })
    const { events } = yield* scenario(uncaptured.pipe(Effect.provideService(References.CurrentStackFrame, undefined)))
    assert.isUndefined(events.find((event) => event.title === "Page.source").stack)
  }))

it.effect("matches enclosing caller spans from inner to outer when names repeat", () =>
  Effect.gen(function*() {
    const { events } = yield* scenario(
      action().pipe(
        Effect.withSpan("caller", {}, { captureStackTrace: () => `at inner (${file}:20:3)` }),
        Effect.withSpan("caller", {}, { captureStackTrace: () => `at outer (${file}:10:2)` })
      )
    )
    const step = events.find((event) => event.type === "before" && event.title === "Page.source")
    const inner = events.find((event) => event.type === "before" && event.callId === step.parentId)
    const outer = events.find((event) => event.type === "before" && event.callId === inner.parentId)
    assert.strictEqual(inner.stack[0].line, 20)
    assert.strictEqual(outer.stack[0].line, 10)
  }))

it.effect("keeps an operation's frame separate from a caller span with the same name", () =>
  Effect.gen(function*() {
    const { events } = yield* scenario(
      action().pipe(
        Effect.withSpan("Page.source", {}, { captureStackTrace: () => `at caller (${file}:40:5)` })
      )
    )
    const group = events.find((event) => event.type === "before" && event.class === "Effect")
    assert.deepStrictEqual(group.stack, [{ file, line: 40, column: 5, function: "Page.source" }])
  }))

it.effect("captures a named-only operation inside a caller span with the same name", () =>
  Effect.gen(function*() {
    const { events } = yield* scenario(
      Effect.gen(function*() {
        yield* Effect.void.pipe(Operation.named("Page.same", { attributes: { "browser.page.id": id } }))
      }).pipe(Effect.withSpan("Page.same", {}, { captureStackTrace: () => `at caller (${file}:40:5)` }))
    )
    const step = events.find((event) => event.type === "before" && event.class === "Page")
    const lines = readFileSync(file, "utf8").split("\n")
    const line = lines.findIndex((line) => line.includes("yield* Effect.void.pipe(Operation.named(\"Page.same\""))
    assert.deepStrictEqual(step.stack[0], {
      file,
      line: line + 1,
      column: lines[line]!.indexOf("Operation.named") + 11,
      function: "Page.same"
    })
  }))
