/** Caller-local files must cross the connection; browser-host paths must stay paths. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Browser, Deadline, FileChooser, FileInput, FilePath, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
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
  for (const operation of ["Locator.setInputFiles", "FileChooser.choose"] as const) {
    for (
      const source of ["local", "remote", "unreadable", "missing-services", "mixed", "empty", "no-element"] as const
    ) {
      it.effect(`${operation}: ${source}`, () =>
        Effect.scoped(Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-upload-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const file = path.join(directory, "caller.txt")
          const contents = "only on the caller: upload these bytes"
          fs.writeFileSync(file, contents)
          const paths: Array<string> = []
          const evaluations: Array<Adapter.EvaluationCall> = []
          const decisions: Array<Adapter.Decision> = []
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
              realm: () => Effect.succeed("upload-realm" as Target.RealmId),
              evaluate: (_realm, call) => {
                evaluations.push(call)
                return Effect.succeed({ _tag: "Value", value: { type: "undefined" } })
              },
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
          const element = vi.spyOn(Runtime, "element").mockReturnValue(Effect.succeed({ _tag: "Found", node, routed }))
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              ready.mockRestore()
              element.mockRestore()
            })
          )
          yield* Effect.gen(function*() {
            const page = yield* Browser.newPage()
            if (source === "missing-services") Object.assign(Handles.page(page).runtime, { fileSystem: Option.none() })
            const input = source === "remote" ?
              FileInput.remote(FilePath.Remote.make(file))
              : source === "unreadable" ?
              FileInput.local(path.join(directory, "missing.txt"))
              : source === "mixed" ?
              [FileInput.local(file), FileInput.remote(FilePath.Remote.make(file))]
              : source === "empty"
              ? []
              : FileInput.local(file)
            const failure = source === "missing-services" || source === "unreadable" || source === "mixed" ||
              (source === "no-element" && operation === "FileChooser.choose")
            if (operation === "Locator.setInputFiles") {
              const action = page.locator("#file").setInputFiles(input)
              if (failure) {
                const error = yield* action.pipe(Effect.flip)
                assert.strictEqual(error._tag, "LocatorError")
                if (error._tag === "LocatorError") {
                  assert.strictEqual(error.reason._tag, source === "unreadable" ? "FileUnreadable" : "InvalidInput")
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
              assert.strictEqual(yield* handler.handled, failure ? 0 : 1)
              if (failure) {
                assert.deepStrictEqual(decisions, [{ _tag: "Cancel" }])
              }
              yield* handler.remove
            }
            if (failure || source === "empty") {
              assert.deepStrictEqual(paths, [])
              if (failure) assert.deepStrictEqual(evaluations, [])
              else assert.strictEqual(evaluations.length, 1)
              return
            }
            if (source === "remote") assert.deepStrictEqual(paths, [file])
            else {
              assert.notInclude(paths, file, "the caller's path is not a file on the browser host")
              assert.include(JSON.stringify(evaluations), Buffer.from(contents).toString("base64"))
            }
          }).pipe(Effect.provide(connection))
        })).pipe(Effect.provide(NodeServices.layer)))
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
        assert.deepStrictEqual(prepared.files[0]!.data, new Uint8Array(fs.readFileSync(import.meta.filename)))
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
        const failure = yield* Preparation.prepare(runtime, [missing]).pipe(Effect.flip)
        assert.strictEqual(failure._tag, "FileUnreadable")
        const directory = yield* Preparation.prepare(runtime, [FileInput.local(path.dirname(import.meta.filename))])
          .pipe(Effect.flip)
        assert.strictEqual(directory._tag, "FileUnreadable")
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
  const stuck = (page: Browser.Page) =>
    Effect.sync(() => {
      const runtime = Handles.page(page).runtime
      Object.assign(runtime, {
        fileSystem: Option.map(runtime.fileSystem, (fs) => ({ ...fs, readFile: () => Effect.never }))
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

  it.live("FileChooser.choose leaves the chooser to the policy when the read doesn't end", () => {
    let send!: Adapter.Sink
    const decisions: Array<Adapter.Decision> = []
    return Effect.scoped(Effect.gen(function*() {
      const decided = yield* Deferred.make<void>()
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
          resolve: Effect.fnUntraced(function*(_obligation, decision) {
            decisions.push(decision)
            yield* Deferred.succeed(decided, undefined)
          })
        })))
      })
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* stuck(page)
        yield* FileChooser.handle(page, FileChooser.choose(FileInput.local("/caller/stuck.txt")))
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
        const ended = yield* Deferred.await(decided).pipe(Effect.timeoutOption("3 seconds"))
        assert.isTrue(Option.isSome(ended), "the chooser stayed undecided 3s past the handler's 200ms budget")
        assert.deepStrictEqual(decisions, [{ _tag: "Cancel" }])
      }).pipe(Deadline.withDefaultBudget("200 millis"), Effect.provide(connection))
    })).pipe(Effect.provide(NodeServices.layer))
  })
})
