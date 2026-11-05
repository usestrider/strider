/** Caller-local files must cross the connection; browser-host paths must stay paths. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, FileChooser, FileInput, FilePath, Page, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { vi } from "vitest"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Preparation from "../src/internal/fileInput.ts"
import * as Handles from "../src/internal/handles.ts"
import * as Runtime from "../src/internal/runtime.ts"

const document = "upload-document" as Target.DocumentId
const node: Adapter.NodeBinding = { document, binding: "upload-input" }
const routed: Runtime.Routed = { document, hops: [] }

describe("FileInput across a connection", () => {
  for (const ownership of ["launched", "attached"] as const) {
    for (const operation of ["Locator.setInputFiles", "FileChooser.choose"] as const) {
      for (
        const source of [
          "local",
          "bytes",
          "remote",
          "unreadable",
          "stat-failure",
          "read-failure",
          "missing-services",
          "mixed",
          "empty",
          "no-element"
        ] as const
      ) {
        it.effect(`${ownership} ${operation}: ${source}`, () =>
          Effect.scoped(Effect.gen(function*() {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-upload-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            const file = path.join(directory, "caller.txt")
            const contents = "only on the caller: upload these bytes".repeat(5000)
            fs.writeFileSync(file, contents)
            const paths: Array<string> = []
            const evaluations: Array<Adapter.EvaluationCall> = []
            const decisions: Array<Adapter.Decision> = []
            const released: Array<Adapter.HandleId> = []
            let send!: Adapter.Sink
            const decided = yield* Deferred.make<void>()
            // No shared filesystem is implemented by this peer: paths refer to its own host.
            const connection = BrowserImpl.layer((sink) => {
              send = sink
              return Fake.connect([], {
                info: new Browser.Info(Fake.info),
                capabilities: new Browser.CapabilitySet({
                  entries: Fake.capabilities.map((entry) =>
                    entry.name === "fileChooser" ? { ...entry, status: "supported", limitations: [] } : entry
                  )
                })
              })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
                ...adapter,
                ownership,
                realm: () => Effect.succeed("upload-realm" as Target.RealmId),
                evaluate: (_realm, call) => {
                  evaluations.push(call)
                  return Effect.succeed({
                    _tag: "Value",
                    value: call.result === "handle"
                      ? { type: "object", handle: "collector" as Adapter.HandleId }
                      : { type: "undefined" }
                  })
                },
                releaseHandles: (handles) =>
                  Effect.sync(() => {
                    released.push(...handles)
                  }),
                setInputFiles: (_node, files) =>
                  Effect.sync(() => {
                    paths.push(...files)
                  }),
                resolve: Effect.fnUntraced(function*(_obligation, decision) {
                  decisions.push(decision)
                  if (decision._tag === "SetFiles") paths.push(...decision.files)
                  yield* Deferred.succeed(decided, undefined)
                })
              })))
            })
            // Stub only DOM lookup/readiness: keep file preparation and adapter dispatch real.
            const ready = vi.spyOn(Runtime, "sendRouted").mockReturnValue(Effect.succeed({
              routed,
              response: {
                _tag: "Ready",
                element: "upload-input",
                scrolled: false,
                point: null,
                draggable: false,
                checked: null,
                fill: null
              }
            }))
            const element = vi.spyOn(Runtime, "element").mockReturnValue(
              Effect.succeed({ _tag: "Found", node, routed })
            )
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                ready.mockRestore()
                element.mockRestore()
              })
            )
            yield* Effect.gen(function*() {
              const page = yield* Browser.newPage()
              if (source === "missing-services") {
                Object.assign(Handles.page(page).runtime, { fileSystem: Option.none() })
              }
              if (source === "stat-failure" || source === "read-failure") {
                const runtime = Handles.page(page).runtime
                Object.assign(runtime, {
                  fileSystem: Option.map(runtime.fileSystem, (fs) => ({
                    ...fs,
                    open: (path: string) =>
                      fs.open(path).pipe(Effect.map((file) =>
                        source === "stat-failure"
                          ? Object.defineProperty(Object.create(file), "stat", {
                            value: fs.stat("/nowhere/stat-failure")
                          })
                          : Object.assign(Object.create(file), {
                            readAlloc: (size: number) =>
                              Effect.andThen(fs.stat("/nowhere/read-failure"), file.readAlloc(size))
                          })
                      ))
                  }))
                })
              }
              const unreadable = source === "unreadable" || source === "stat-failure" || source === "read-failure"
              const input = source === "bytes" ?
                FileInput.bytes("caller.txt", "text/plain", new TextEncoder().encode(contents)) :
                source === "remote" ?
                FileInput.remote(FilePath.Remote.make(file))
                : source === "unreadable" ?
                FileInput.local(path.join(directory, "missing.txt"))
                : source === "mixed" ?
                [FileInput.local(file), FileInput.remote(FilePath.Remote.make(file))]
                : source === "empty"
                ? []
                : FileInput.local(file)
              const failure = ownership === "launched"
                ? source === "unreadable" && operation === "Locator.setInputFiles"
                : source === "missing-services" || unreadable || source === "mixed" ||
                  (source === "no-element" && operation === "FileChooser.choose")
              if (operation === "Locator.setInputFiles") {
                const action = page.locator("#file").setInputFiles(input)
                if (failure) {
                  const error = yield* action.pipe(Effect.flip)
                  assert.strictEqual(error._tag, "LocatorError")
                  if (error._tag === "LocatorError") {
                    assert.strictEqual(error.reason._tag, unreadable ? "FileUnreadable" : "InvalidInput")
                  }
                } else yield* action
              } else {
                const handler = yield* FileChooser.handle(page, FileChooser.choose(input))
                yield* send({
                  _tag: "ObligationOpened",
                  obligation: "upload-chooser" as Adapter.ObligationId,
                  subject: {
                    _tag: "FileChooser",
                    navigable: Handles.page(page).entry.id,
                    multiple: true,
                    element: source === "no-element" ? Option.none() : Option.some(node)
                  }
                })
                yield* Deferred.await(decided)
                assert.strictEqual(yield* handler.handled, ownership === "attached" && unreadable ? 1 : failure ? 0 : 1)
                if (failure) {
                  assert.deepStrictEqual(decisions, [{ _tag: "Cancel" }])
                }
                yield* handler.remove
              }
              const hasCollector = evaluations.some((call) => call.result === "handle")
              assert.strictEqual(released.length, hasCollector ? 1 : 0)
              if (hasCollector) {
                assert.isTrue(evaluations.some((call) => call.functionDeclaration.includes("function discardUpload")))
              }
              if (failure || source === "empty") {
                assert.deepStrictEqual(paths, [])
                if (failure) {
                  if (!unreadable) assert.deepStrictEqual(evaluations, [])
                } else assert.strictEqual(evaluations.length, 3)
                return
              }
              if (source === "remote" || (ownership === "launched" && source !== "bytes")) {
                assert.deepStrictEqual(
                  paths,
                  source === "mixed"
                    ? [file, file]
                    : [source === "unreadable" ? path.join(directory, "missing.txt") : file]
                )
                assert.strictEqual(
                  evaluations.length,
                  source === "mixed" && operation === "Locator.setInputFiles" ? 1 : 0
                )
              } else {
                assert.notInclude(paths, file, "the caller's path is not a file on the browser host")
                const chunks = evaluations.filter((call) => call.functionDeclaration.includes("function appendChunk"))
                assert.isAbove(chunks.length, 1)
                const decoded = chunks.map((call) => {
                  const value = call.arguments[1]!
                  assert.strictEqual(value._tag, "Value")
                  if (value._tag !== "Value" || value.value.type !== "string") throw new Error("missing chunk")
                  const bytes = Buffer.from(value.value.value, "base64")
                  assert.isAtMost(bytes.length, 64 * 1024)
                  return bytes
                })
                assert.strictEqual(Buffer.concat(decoded).toString(), contents)
              }
            }).pipe(Effect.provide(connection))
          })).pipe(Effect.provide(NodeServices.layer)))
      }
    }
  }
})

describe("file preparation", () => {
  const connection = BrowserImpl.layer(
    Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })
  )
  const run = (test: (runtime: Runtime.Runtime) => Effect.Effect<void, unknown>) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* test(Handles.page(page).runtime)
    })).pipe(Effect.provide(Layer.provide(connection, NodeServices.layer)))

  it.effect("keeps launched absolute Local and Remote paths without caller services", () =>
    run((runtime) =>
      Effect.gen(function*() {
        const launched = {
          ...runtime,
          model: { ...runtime.model, adapter: { ...runtime.model.adapter, ownership: "launched" as const } },
          fileSystem: Option.none(),
          path: Option.none()
        }
        const prepared = yield* Preparation.prepare(launched, [
          FileInput.local("/caller/a.txt"),
          FileInput.remote(FilePath.Remote.make("/host/b.txt"))
        ])
        assert.deepStrictEqual(prepared, { _tag: "Paths", files: ["/caller/a.txt", "/host/b.txt"] })
        const mixed = yield* Preparation.prepare(launched, [
          FileInput.local("/caller/a.txt"),
          FileInput.bytes("b", "text/plain", new Uint8Array())
        ]).pipe(Effect.flip)
        assert.strictEqual(mixed._tag, "InvalidInput")
      })
    ))

  it.effect("resolves relative paths, preserves names and infers MIME alongside bytes", () =>
    run((runtime) =>
      Effect.gen(function*() {
        const file = FileInput.local(path.relative(process.cwd(), import.meta.filename))
        const prepared = yield* Preparation.prepare(runtime, [
          file,
          FileInput.bytes("empty.bin", "x/test", new Uint8Array())
        ])
        assert.strictEqual(prepared._tag, "Made")
        if (prepared._tag !== "Made") return
        assert.strictEqual(prepared.files[0]!.name, "FileInput.test.ts")
        assert.propertyVal(prepared.files[0], "path", import.meta.filename)
        assert.notProperty(prepared.files[0], "data")
        assert.strictEqual(prepared.files[1]!.mimeType, "x/test")
      })
    ))

  it.effect("requires both captured caller services even for absolute local paths", () =>
    run((runtime) =>
      Effect.gen(function*() {
        for (const missing of [{ fileSystem: Option.none() }, { path: Option.none() }]) {
          const failure = yield* Preparation.prepare({ ...runtime, ...missing }, [
            FileInput.local(import.meta.filename)
          ]).pipe(Effect.flip)
          assert.strictEqual(failure._tag, "InvalidInput")
          assert.include(String(failure), "FileSystem and Path")
        }
      })
    ))

  it.effect("reports read failures and rejects remote mixtures before reading", () =>
    run((runtime) =>
      Effect.gen(function*() {
        const missing = FileInput.local("/nowhere/upload-file.txt")
        for (const file of [missing, FileInput.bytes("a", "text/plain", new Uint8Array())]) {
          const mixed = yield* Preparation.prepare(runtime, [
            file,
            FileInput.remote(FilePath.Remote.make("/remote/file"))
          ]).pipe(Effect.flip)
          assert.strictEqual(mixed._tag, "InvalidInput")
        }
        const empty = yield* Preparation.prepare({ ...runtime, fileSystem: Option.none(), path: Option.none() }, [])
        assert.deepStrictEqual(empty, { _tag: "Made", files: [] })
      })
    ))
})

describe("a local read under the deadline", () => {
  // A read that never ends, as a FIFO with no writer or a hung network mount gives
  const stuck = (page: Page.Page) =>
    Effect.sync(() => {
      const runtime = Handles.page(page).runtime
      Object.assign(runtime, {
        fileSystem: Option.map(runtime.fileSystem, (fs) => ({ ...fs, open: () => Effect.never }))
      })
    })

  it.live("Locator.setInputFiles times out when the read doesn't end", () =>
    Effect.scoped(Effect.gen(function*() {
      const ready = vi.spyOn(Runtime, "sendRouted").mockReturnValue(Effect.succeed({
        routed,
        response: {
          _tag: "Ready",
          element: "upload-input",
          scrolled: false,
          point: null,
          draggable: false,
          checked: null,
          fill: null
        }
      }))
      yield* Effect.addFinalizer(() => Effect.sync(() => ready.mockRestore()))
      const page = yield* Browser.newPage()
      yield* stuck(page)
      const ended = yield* page.locator("#file").setInputFiles(FileInput.local("/caller/stuck.txt")).pipe(
        Deadline.withDefaultBudget("200 millis"),
        Effect.exit,
        Effect.timeoutOption("3 seconds")
      )
      assert.isTrue(Option.isSome(ended), "the operation outlived its 200ms deadline by more than 3s")
    })).pipe(Effect.provide(Layer.provide(
      BrowserImpl.layer(Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })),
      NodeServices.layer
    ))))

  for (
    const scenario of [
      "stalled read",
      "time spent in handler",
      "scope interruption",
      "stalled chunk acknowledgement"
    ] as const
  ) {
    it.live(`FileChooser.choose cancels after ${scenario} without applying late files`, () => {
      let send!: Adapter.Sink
      const decisions: Array<Adapter.Decision> = []
      const evaluations: Array<Adapter.EvaluationCall> = []
      let released = 0
      let closed = 0
      return Effect.scoped(Effect.gen(function*() {
        const decided = yield* Deferred.make<void>()
        const reading = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<Uint8Array>()
        const connection = BrowserImpl.layer((sink) => {
          send = sink
          return Fake.connect([], {
            info: new Browser.Info(Fake.info),
            capabilities: new Browser.CapabilitySet({
              entries: Fake.capabilities.map((entry) =>
                entry.name === "fileChooser" ? { ...entry, status: "supported", limitations: [] } : entry
              )
            })
          })(sink).pipe(Effect.map((adapter): Adapter.AdapterConnection => ({
            ...adapter,
            realm: () => Effect.succeed("upload-realm" as Target.RealmId),
            evaluate: (_realm, call) => {
              evaluations.push(call)
              if (
                scenario === "stalled chunk acknowledgement" &&
                call.functionDeclaration.includes("function appendChunk")
              ) {
                return Effect.andThen(Deferred.succeed(reading, undefined), Effect.never).pipe(
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
                )
              }
              return Effect.succeed({
                _tag: "Value",
                value: call.result === "handle"
                  ? { type: "object", handle: "collector" as Adapter.HandleId }
                  : { type: "undefined" }
              })
            },
            releaseHandles: () =>
              Effect.sync(() => {
                released++
              }),
            resolve: Effect.fnUntraced(function*(_obligation, decision) {
              decisions.push(decision)
              yield* Deferred.succeed(decided, undefined)
            })
          })))
        })
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const runtime = Handles.page(page).runtime
          Object.assign(runtime, {
            fileSystem: Option.map(runtime.fileSystem, (fs) => ({
              ...fs,
              open: () =>
                fs.open(import.meta.filename).pipe(
                  Effect.tap(() =>
                    Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        closed++
                      })
                    )
                  ),
                  Effect.map((file) =>
                    Object.assign(Object.create(file), {
                      readAlloc: () =>
                        Effect.andThen(
                          scenario === "stalled chunk acknowledgement"
                            ? Effect.void
                            : Deferred.succeed(reading, undefined),
                          scenario === "stalled chunk acknowledgement" ?
                            Effect.succeed(Option.some(new Uint8Array([1]))) :
                            scenario === "time spent in handler"
                            ? Effect.as(Effect.sleep("150 millis"), Option.some(new Uint8Array([1])))
                            : Deferred.await(release).pipe(Effect.map(Option.some))
                        ).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
                    })
                  )
                )
            }))
          })
          const scope = yield* Scope.fork(yield* Effect.scope)
          const choose = FileChooser.choose(FileInput.local("/caller/stuck.txt"))
          const handler = yield* FileChooser.handle(
            page,
            (chooser) =>
              scenario === "time spent in handler"
                ? Effect.andThen(Effect.sleep("150 millis"), choose(chooser))
                : choose(chooser)
          ).pipe(Scope.provide(scope))
          yield* send({
            _tag: "ObligationOpened",
            obligation: "stuck-chooser" as Adapter.ObligationId,
            subject: {
              _tag: "FileChooser",
              navigable: Handles.page(page).entry.id,
              multiple: true,
              element: Option.some(node)
            }
          })
          const started = yield* Deferred.await(reading).pipe(Effect.timeoutOption("3 seconds"))
          assert.isTrue(Option.isSome(started), "file preparation never started")
          if (scenario === "scope interruption") yield* Scope.close(scope, Exit.void)
          const ended = yield* Deferred.await(decided).pipe(Effect.timeoutOption("3 seconds"))
          assert.isTrue(Option.isSome(ended), "the chooser stayed undecided past its budget or scope")
          assert.deepStrictEqual(decisions, [{ _tag: "Cancel" }])
          const stopped = yield* Deferred.await(interrupted).pipe(Effect.timeoutOption("3 seconds"))
          assert.isTrue(Option.isSome(stopped), "the read was left running")
          yield* Deferred.succeed(release, new Uint8Array([1]))
          assert.isFalse(
            evaluations.some((call) => call.functionDeclaration.includes("function commitUpload")),
            "canceled reads must never apply files"
          )
          assert.strictEqual(yield* handler.handled, 1)
          assert.strictEqual(released, 1)
          assert.strictEqual(closed, 1)
        }).pipe(
          Deadline.withDefaultBudget(scenario === "scope interruption" ? "30 seconds" : "200 millis"),
          Effect.provide(connection)
        )
      })).pipe(Effect.provide(NodeServices.layer))
    })
  }
})
