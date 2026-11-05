/** Caller-local files must cross the connection; browser-host paths must stay paths. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Browser, FileChooser, FileInput, FilePath, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { vi } from "vitest"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"
import * as Runtime from "../src/internal/runtime.ts"

const document = "upload-document" as Target.DocumentId
const node: Adapter.NodeBinding = { document, binding: "upload-input" }
const routed: Runtime.Routed = { document, hops: [] }

describe("FileInput across a connection", () => {
  for (const operation of ["Locator.setInputFiles", "FileChooser.choose"] as const) {
    for (const source of ["local", "remote"] as const) {
      it.effect(`${operation} ${source === "local" ? "transfers caller-local contents" : "preserves a browser-host path"}`, () =>
        Effect.scoped(Effect.gen(function*() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-upload-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const file = path.join(directory, "caller.txt")
          const contents = "only on the caller: upload these bytes"
          fs.writeFileSync(file, contents)
          const paths: Array<string> = []
          const evaluations: Array<Adapter.EvaluationCall> = []
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
            const input = source === "local" ? FileInput.local(file) : FileInput.remote(FilePath.Remote.make(file))
            if (operation === "Locator.setInputFiles") yield* page.locator("#file").setInputFiles(input)
            else {
              yield* FileChooser.handle(page, FileChooser.choose(input))
              yield* send({
                _tag: "ObligationOpened",
                obligation: "upload-chooser" as Adapter.ObligationId,
                subject: {
                  _tag: "FileChooser",
                  navigable: Handles.page(page).entry.id,
                  multiple: false,
                  element: Option.some(node)
                }
              })
              yield* Deferred.await(decided)
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
