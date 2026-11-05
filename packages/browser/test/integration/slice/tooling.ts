/**
 * Tooling on every backend's layer: files made in the page, the outcomes `goto` accepts, a close
 * that runs `beforeunload`, the capabilities each backend has and the `Unsupported` of the others, and a span per
 * protocol command.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  AutoResolution,
  Browser,
  Capability,
  Deadline,
  Dialog,
  Expect,
  FileChooser,
  FileInput,
  FilePath,
  Locator,
  PageNavigation
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

/** A page on the local site, showing `html`. */
const fixture = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  return `${served.origin}/fixture?html=${encodeURIComponent(html)}`
})

const text = (value: string) => new TextEncoder().encode(value)

// Diagnostic Linux process-tree RSS, with shared pages counted in each process. It is not an allocator measurement.
const descendantRss = (root = process.pid): number => {
  let total = 0
  let children: string
  try {
    children = fs.readFileSync(`/proc/${root}/task/${root}/children`, "utf8")
  } catch {
    return total
  }
  for (const child of children.trim().split(/\s+/).filter(Boolean)) {
    try {
      total += Number(/^VmRSS:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${child}/status`, "utf8"))?.[1] ?? 0) * 1024
    } catch { /* The child ended between reads. */ }
    total += descendantRss(Number(child))
  }
  return total
}

// Writes each chosen file's name, type, size and text
const files = `<input type="file" id="files" multiple aria-label="Files"><button>Choose</button><p id="out">none</p>
<script>
  document.querySelector("button").onclick = () => document.getElementById("files").click()
  document.getElementById("files").addEventListener("change", async (event) => {
    const read = await Promise.all([...event.target.files].map(async (file) =>
      file.name + ":" + file.type + ":" + file.size + ":" + await file.text()))
    document.getElementById("out").textContent = read.join("|")
  })
</script>`

const made = [
  FileInput.bytes("a.txt", "text/plain", text("hello")),
  FileInput.bytes("b.csv", "text/csv", text("x,y"))
]

const findNode = (node: Capability.AxNode, found: (node: Capability.AxNode) => boolean): boolean =>
  found(node) || node.children.some((child) => findNode(child, found))

export const tooling = (name: string, backend: Layer.Layer<Browser.Browser, unknown>, attached = false) =>
  describe(`${name} tooling`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("sets files made in the page, with their names, types and contents", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByLabel("Files").setInputFiles(made)
            yield* page.getByText("a.txt:text/plain:5:hello|b.csv:text/csv:3:x,y").pipe(Expect.toBeVisible)
            // Browser-host paths cannot be combined with caller-side files
            const mixed = yield* page.getByLabel("Files").setInputFiles([
              made[0]!,
              FileInput.remote(FilePath.Remote.make("/etc/hosts"))
            ]).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(mixed), String(mixed))
            assert.strictEqual(mixed.reason._tag, "InvalidInput")
          }))
        }), timeout)

      it.effect("chooses files made in the page through a file chooser", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            // A backend that reports no chooser says so (`modules.ts` checks the refusal)
            if (!(yield* supports("fileChooser"))) return
            const handler = yield* FileChooser.handle(page, FileChooser.choose(made))
            yield* page.getByRole("button", { name: "Choose" }).click()
            yield* page.getByText("a.txt:text/plain:5:hello|b.csv:text/csv:3:x,y").pipe(Expect.toBeVisible)
            // The handler is counted as it decides, before the page sets the files (QUIRKS.md, Q152)
            assert.strictEqual(yield* handler.handled, 1)
          }))
        }), timeout)

      for (const chooser of [false, true]) {
        it.effect(
          `transfers local content and metadata${chooser ? " through a chooser" : " through a locator"}`,
          () =>
            Effect.gen(function*() {
              if (chooser && !(yield* supports("fileChooser"))) return
              const url = yield* fixture(files)
              yield* Effect.scoped(Effect.gen(function*() {
                const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-local-upload-"))
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
                )
                fs.writeFileSync(path.join(directory, "caller.txt"), "caller content")
                fs.writeFileSync(path.join(directory, "unknown.strider-unknown"), "raw")
                fs.writeFileSync(path.join(directory, "b.csv"), "x,y")
                const inputs = [
                  FileInput.local(path.relative(process.cwd(), path.join(directory, "caller.txt"))),
                  FileInput.local(path.join(directory, "unknown.strider-unknown")),
                  attached ? made[1]! : FileInput.remote(FilePath.Remote.make(path.join(directory, "b.csv")))
                ]
                const page = yield* Browser.newPage()
                yield* page.goto(url)
                if (chooser) {
                  const handler = yield* FileChooser.handle(page, FileChooser.choose(inputs))
                  yield* page.getByRole("button", { name: "Choose" }).click()
                  yield* page.getByText(
                    attached
                      ? "caller.txt:text/plain:14:caller content|unknown.strider-unknown:application/octet-stream:3:raw|b.csv:text/csv:3:x,y"
                      : /^caller\.txt:[^:]*:14:caller content\|unknown\.strider-unknown:[^:]*:3:raw\|b\.csv:[^:]*:3:x,y$/
                  ).pipe(Expect.toBeVisible)
                  assert.strictEqual(yield* handler.handled, 1)
                  yield* handler.remove
                } else yield* page.getByLabel("Files").setInputFiles(inputs)
                yield* page.getByText(
                  attached
                    ? "caller.txt:text/plain:14:caller content|unknown.strider-unknown:application/octet-stream:3:raw|b.csv:text/csv:3:x,y"
                    : /^caller\.txt:[^:]*:14:caller content\|unknown\.strider-unknown:[^:]*:3:raw\|b\.csv:[^:]*:3:x,y$/
                ).pipe(Expect.toBeVisible)
                // A refused mixture must preserve the existing selection.
                const failure = yield* page.getByLabel("Files").setInputFiles([
                  made[0]!,
                  FileInput.remote(FilePath.Remote.make("/remote/file"))
                ]).pipe(Effect.flip)
                assert.strictEqual(failure._tag, "LocatorError")
                yield* page.getByText(
                  attached
                    ? "caller.txt:text/plain:14:caller content|unknown.strider-unknown:application/octet-stream:3:raw|b.csv:text/csv:3:x,y"
                    : /^caller\.txt:[^:]*:14:caller content\|unknown\.strider-unknown:[^:]*:3:raw\|b\.csv:[^:]*:3:x,y$/
                ).pipe(Expect.toBeVisible)
                if (chooser) {
                  const clear = yield* FileChooser.handle(page, FileChooser.choose([]))
                  yield* page.getByRole("button", { name: "Choose" }).click()
                  yield* page.locator("#out").pipe(Expect.toHaveText(""))
                  assert.strictEqual(yield* clear.handled, 1)
                } else yield* page.getByLabel("Files").setInputFiles([])
                yield* page.locator("#out").pipe(Expect.toHaveText(""))
              }))
            }),
          timeout
        )
      }

      it.effect("replaces and clears browser-host paths and made files in either order", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-remote-upload-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            const file = path.join(directory, "host.txt")
            fs.writeFileSync(file, "on host")
            const remote = FileInput.remote(FilePath.Remote.make(file))
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const input = page.getByLabel("Files")
            const out = page.locator("#out")
            // Host-path MIME comes from the browser; transferred files use our MIME inference.
            yield* input.setInputFiles(remote)
            yield* out.pipe(Expect.toHaveText(/^host\.txt:[^:]*:7:on host$/))
            yield* input.setInputFiles([])
            yield* out.pipe(Expect.toHaveText(""))
            yield* input.setInputFiles(made[0]!)
            yield* out.pipe(Expect.toHaveText("a.txt:text/plain:5:hello"))
            yield* input.setInputFiles(remote)
            yield* out.pipe(Expect.toHaveText(
              name === "WebKit"
                ? /^a\.txt:text\/plain:5:hello\|host\.txt:[^:]*:7:on host$/
                : /^host\.txt:[^:]*:7:on host$/
            ))
            yield* input.setInputFiles(made[0]!)
            yield* out.pipe(Expect.toHaveText("a.txt:text/plain:5:hello"))
          }))
        }), timeout)

      it.effect("keeps a local file's modification time", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p><script>
            document.querySelector("input").addEventListener("change", (event) => {
              document.getElementById("out").textContent = String(event.target.files[0].lastModified)
            })
          </script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-local-upload-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            const file = path.join(directory, "dated.txt")
            fs.writeFileSync(file, "dated")
            fs.utimesSync(file, new Date(978307200000), new Date(978307200000))
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByLabel("File").setInputFiles(FileInput.local(file))
            yield* page.locator("#out").pipe(Expect.toHaveText("978307200000"))
          }))
        }), timeout)

      for (const source of ["local", "bytes"] as const) {
        it.effect(`refuses several ${source} files for an input that takes one`, () =>
          Effect.gen(function*() {
            const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p>
            <button>Inspect</button><p id="selected">none</p><script>
              document.querySelector("button").onclick = () => {
                document.getElementById("selected").textContent = [...document.querySelector("input").files].map((file) => file.name).join("|")
              }
              let changes = 0
              document.querySelector("input").addEventListener("change", (event) => {
                document.getElementById("out").textContent = event.target.files.length + ":" + ++changes
              })
            </script>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const input = page.getByLabel("File")
              yield* input.setInputFiles(made[0]!)
              yield* page.locator("#out").pipe(Expect.toHaveText("1:1"))
              const both = source === "local"
                ? [FileInput.local(import.meta.filename), FileInput.local(import.meta.filename)]
                : made
              const failure = yield* input.setInputFiles(both).pipe(Effect.flip)
              assert(Locator.isLocatorError(failure), String(failure))
              assert.strictEqual(failure.reason._tag, "InvalidInput")
              yield* page.locator("#out").pipe(Expect.toHaveText("1:1"))
              yield* page.getByRole("button", { name: "Inspect" }).click()
              yield* page.locator("#selected").pipe(Expect.toHaveText("a.txt"))
            }))
          }), timeout)
      }

      it.effect("uses creation time for files supplied as bytes", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p><script>
            const before = Date.now()
            document.querySelector("input").addEventListener("change", (event) => {
              const modified = event.target.files[0].lastModified
              document.getElementById("out").textContent = String(modified >= before && modified <= Date.now())
            })
          </script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByLabel("File").setInputFiles(made[0]!)
            yield* page.locator("#out").pipe(Expect.toHaveText("true"))
          }))
        }), timeout)

      it.effect("compares consecutive native uploads before any made files", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-native-compare-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            const first = path.join(directory, "first.txt")
            const second = path.join(directory, "second.txt")
            fs.writeFileSync(first, "first")
            fs.writeFileSync(second, "second")
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const input = page.getByLabel("Files")
            const out = page.locator("#out")
            // Both calls use the same native operation as pre-transfer absolute Local uploads.
            yield* input.setInputFiles(FileInput.remote(FilePath.Remote.make(first)))
            yield* out.pipe(Expect.toHaveText(/^first\.txt:[^:]*:5:first$/))
            const nativeFirst = yield* out.readText
            yield* input.setInputFiles(FileInput.remote(FilePath.Remote.make(second)))
            yield* out.pipe(Expect.toHaveText(/second\.txt:[^:]*:6:second$/))
            const nativeSecond = yield* out.readText
            yield* Effect.logInfo({ nativeFirst, nativeSecond })
          }))
        }), timeout)

      it.effect("compares native path uploads with local files", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-upload-compare-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            const file = path.join(directory, "host.txt")
            fs.writeFileSync(file, "on host")
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            // This unchanged adapter path was also used by absolute Local inputs before caller transfer.
            yield* page.getByLabel("Files").setInputFiles(FileInput.remote(FilePath.Remote.make(file)))
            yield* page.locator("#out").pipe(Expect.toHaveText(/^host\.txt:[^:]*:7:on host$/))
            const native = yield* page.locator("#out").readText
            yield* page.getByLabel("Files").setInputFiles([])
            yield* page.getByLabel("Files").setInputFiles(FileInput.local(file))
            yield* page.locator("#out").pipe(Expect.toHaveText(/^host\.txt:[^:]*:7:on host$/))
            const transferred = yield* page.locator("#out").readText
            yield* Effect.logInfo({ native, transferred })
          }))
        }), timeout)

      it.effect("compares native and local modification times", () =>
        Effect.scoped(Effect.gen(function*() {
          const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p><script>
            document.querySelector("input").onchange = (event) => { document.getElementById("out").textContent = String(event.target.files[0].lastModified) }
          </script>`)
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-native-time-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const file = path.join(directory, "dated.txt")
          fs.writeFileSync(file, "dated")
          fs.utimesSync(file, new Date(978307200000), new Date(978307200000))
          const page = yield* Browser.newPage()
          yield* page.goto(url)
          yield* page.getByLabel("File").setInputFiles(FileInput.remote(FilePath.Remote.make(file)))
          const native = yield* page.locator("#out").readText
          yield* page.getByLabel("File").setInputFiles(FileInput.local(file))
          const local = yield* page.locator("#out").readText
          yield* Effect.logInfo({ name, attached, expectedMtime: 978307200000, native, local })
          assert.match(native, /^[0-9]+$/)
          assert.match(local, /^[0-9]+$/)
        })), timeout)

      it.effect("gives local files to a chooser whose input isn't in the document", () =>
        Effect.gen(function*() {
          if (!(yield* supports("fileChooser"))) return
          const url = yield* fixture(`<button>Choose</button><p id="out">none</p><script>
            document.querySelector("button").onclick = () => {
              const input = document.createElement("input")
              input.type = "file"
              input.onchange = () => {
                document.getElementById("out").textContent = input.files[0].name + ":" + input.files.length
              }
              input.click()
            }
          </script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* FileChooser.handle(page, FileChooser.choose(FileInput.local(import.meta.filename)))
            yield* page.getByRole("button", { name: "Choose" }).click()
            yield* page.locator("#out").pipe(Expect.toHaveText("tooling.ts:1"))
          }))
        }), timeout)

      it.effect("verifies contents across upload chunk boundaries", () =>
        Effect.scoped(Effect.gen(function*() {
          const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p><script>
            document.querySelector("input").onchange = async (event) => {
              const file = event.target.files[0]
              const data = new Uint8Array(await file.arrayBuffer())
              document.getElementById("out").textContent = data.every((value, index) => value === (index * 17 + 23) % 256) ? file.name + ":" + data.length : "mismatch"
            }
          </script>`)
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-chunks-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const page = yield* Browser.newPage()
          yield* page.goto(url)
          for (const length of [0, 1, 65535, 65536, 65537, 131073]) {
            const data = Uint8Array.from({ length }, (_, index) => (index * 17 + 23) % 256)
            const file = path.join(directory, "boundary.bin")
            fs.writeFileSync(file, data)
            for (
              const input of [FileInput.local(file), FileInput.bytes("boundary.bin", "application/octet-stream", data)]
            ) {
              yield* page.getByLabel("File").setInputFiles(input)
              yield* page.locator("#out").pipe(Expect.toHaveText(`boundary.bin:${length}`))
            }
          }
        })), timeout)

      for (const megabytes of [32, 256, 600]) {
        it.effect(`transfers a local file of ${megabytes} MiB`, () =>
          Effect.gen(function*() {
            const url = yield* fixture(`<input type="file" aria-label="File"><p id="out">none</p><script>
              document.querySelector("input").addEventListener("change", async (event) => {
                const file = event.target.files[0]
                let offset = 0
                for await (const chunk of file.stream()) {
                  for (let i = 0; i < chunk.length; i++) {
                    if (chunk[i] !== ((offset + i) * 17 + 23) % 256) {
                      document.getElementById("out").textContent = "mismatch:" + (offset + i)
                      return
                    }
                  }
                  offset += chunk.length
                }
                document.getElementById("out").textContent = file.name + ":" + file.lastModified + ":" + offset
              })
            </script>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-local-upload-"))
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
              )
              const file = path.join(directory, "large.bin")
              const fd = fs.openSync(file, "w")
              try {
                const block = Buffer.alloc(64 * 1024)
                for (let i = 0; i < block.length; i++) block[i] = (i * 17 + 23) % 256
                for (let i = 0; i < megabytes * 16; i++) fs.writeSync(fd, block)
              } finally {
                fs.closeSync(fd)
              }
              fs.utimesSync(file, new Date(978307200000), new Date(978307200000))
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const baseline = process.memoryUsage()
              const peak = { ...baseline }
              const descendantBaselineRss = descendantRss()
              let descendantPeakRss = descendantBaselineRss
              const sampling = setInterval(() => {
                const current = process.memoryUsage()
                descendantPeakRss = Math.max(descendantPeakRss, descendantRss())
                for (const key of ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"] as const) {
                  peak[key] = Math.max(peak[key], current[key])
                }
              }, 100)
              yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(sampling)))
              const started = performance.now()
              yield* page.getByLabel("File").setInputFiles(FileInput.local(file))
              yield* page.locator("#out").pipe(Expect.toHaveText(
                attached
                  ? `large.bin:978307200000:${megabytes * 1024 * 1024}`
                  : new RegExp(`^large\\.bin:[0-9]+:${megabytes * 1024 * 1024}$`)
              ))
              yield* Effect.logInfo({
                upload: name,
                attached,
                megabytes,
                elapsedMillis: performance.now() - started,
                baseline,
                peak,
                descendantBaselineRss,
                descendantPeakRss,
                memorySampleMillis: 100,
                descendantRssIncludesSharedPages: true
              })
            })).pipe(Deadline.withDefaultBudget("300 seconds"))
          }), 400_000)
      }

      it.effect("cancels failed chooser preparation and allows the next chooser", () =>
        Effect.gen(function*() {
          if (!(yield* supports("fileChooser"))) return
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            for (
              const inputs of [
                ...(attached ? [[FileInput.local("/nowhere/upload.txt")]] : []),
                [made[0]!, FileInput.remote(FilePath.Remote.make("/remote/file"))]
              ]
            ) {
              const handler = yield* FileChooser.handle(page, FileChooser.choose(inputs))
              const resolution = yield* AutoResolution.next(page, { subject: "FileChooser" })
              yield* page.getByRole("button", { name: "Choose" }).click()
              assert.strictEqual((yield* resolution).decision, "cancel")
              assert.strictEqual(yield* handler.handled, 0)
              yield* handler.remove
            }
            yield* FileChooser.handle(page, FileChooser.choose(made))
            yield* page.getByRole("button", { name: "Choose" }).click()
            yield* page.getByText("a.txt:text/plain:5:hello|b.csv:text/csv:3:x,y").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("returns a download or no content as a navigation when goto accepts it", () =>
        Effect.gen(function*() {
          const served = yield* site
          const url = yield* fixture(`<p>start</p>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const refused = yield* page.goto(`${served.origin}/204`).pipe(Effect.flip)
            assert(refused._tag === "PageError", String(refused))
            assert(refused.reason instanceof PageNavigation.NoContent, String(refused.reason))
            const empty = yield* page.goto(`${served.origin}/204`, { accept: ["noContent"] })
            assert(empty._tag === "NoContent", empty._tag)
            assert.strictEqual(empty.url, `${served.origin}/204`)
            assert(Option.isSome(empty.response), "the 204's response")
            assert.strictEqual(empty.response.value.status, 204)
            const download = yield* page.goto(`${served.origin}/download`, { accept: ["download", "noContent"] })
            assert(download._tag === "BecameDownload", download._tag)
            assert.strictEqual(download.url, `${served.origin}/download`)
            // The page stayed where it was
            yield* page.getByText("start").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect(
        "runs beforeunload when closing, and a handler's stay keeps the page open",
        () =>
          Effect.gen(function*() {
            const url = yield* fixture(
              `<button>Edit</button><script>window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "" })</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              // A page prompts before unloading only after the user has interacted with it
              yield* page.getByRole("button", { name: "Edit" }).click()
              if (!(yield* supports("close.runBeforeUnload"))) {
                const error = yield* page.close({ runBeforeUnload: true }).pipe(Effect.flip)
                assert(error._tag === "PageError" && error.reason._tag === "Unsupported", String(error))
                assert.strictEqual(error.reason.capability, "close.runBeforeUnload")
                return
              }
              const staying = yield* Dialog.handle(page, Dialog.dismissAll)
              const canceled = yield* page.close({ runBeforeUnload: true }).pipe(Effect.flip)
              assert(canceled._tag === "PageError", String(canceled))
              assert.strictEqual(canceled.reason._tag, "CloseCanceled")
              yield* staying.handled.waitFor((count) => count === 1)
              assert.strictEqual((yield* page.status)._tag, "Open")
              yield* page.getByRole("button", { name: "Edit" }).pipe(Expect.toBeVisible)
              yield* staying.remove
              const leaving = yield* Dialog.handle(page, Dialog.acceptAll)
              yield* page.close({ runBeforeUnload: true })
              assert.strictEqual((yield* page.closed)._tag, "PageClosed")
              yield* leaving.handled.waitFor((count) => count === 1)
            }))
          }),
        timeout
      )

      it.effect("reads the browser's own accessibility tree where there is one", () =>
        Effect.gen(function*() {
          const { info } = yield* Browser.Browser
          const { crossSite } = yield* site
          const inner = (label: string) => `<button>${label}</button>`
          const url = yield* fixture(
            `<main><button>Save</button><iframe src="/fixture?html=${
              encodeURIComponent(inner("In frame"))
            }"></iframe><iframe src="${crossSite}/fixture?html=${
              encodeURIComponent(inner("Cross site"))
            }"></iframe></main>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url, { waitUntil: "load" })
            const acquired = yield* page.capability(Capability.AxTree).pipe(
              Effect.flatMap((tree) => tree.read),
              Effect.exit
            )
            if (info.protocol !== "cdp") {
              assert(acquired._tag === "Failure", "unsupported")
              const error = yield* Effect.flip(acquired)
              assert(Capability.isCapabilityError(error), String(error))
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.axTree" })
              return
            }
            assert(acquired._tag === "Success", String(acquired))
            const tree = acquired.value
            assert.strictEqual(tree.role, "RootWebArea")
            assert.isTrue(findNode(tree, (node) => node.role === "button" && node.name === "Save"))
            // Each iframe's tree is under it, in process or out
            for (const name of ["In frame", "Cross site"]) {
              assert.isTrue(
                findNode(tree, (node) =>
                  node.role === "Iframe" && findNode(node, (inside) =>
                    inside.role === "button" && inside.name === name)),
                name
              )
            }
            // Ignored nodes are left out: no generic container with no name is kept for the main element's parent
            assert.isFalse(findNode(tree, (node) =>
              node.properties.ignored === true))
          }))
        }), timeout)

      it.effect("streams the page's frames where the backend has a screencast", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<p id="t"></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const acquired = yield* page.capability(Capability.Screencast).pipe(Effect.exit)
            if (!(yield* supports("capability.screencast"))) {
              const error = yield* Effect.flip(acquired)
              assert(Capability.isCapabilityError(error), String(error))
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.screencast" })
              return
            }
            assert(acquired._tag === "Success", String(acquired))
            const frames = yield* acquired.value.frames.pipe(
              Stream.take(2),
              Stream.runCollect,
              Deadline.within("20 seconds")
            )
            assert.strictEqual(frames.length, 2)
            for (const frame of frames) {
              assert.deepStrictEqual([frame.jpeg[0], frame.jpeg[1]], [0xff, 0xd8])
              assert.isAbove(frame.width, 0)
              assert.isAbove(frame.height, 0)
            }
          }))
        }), timeout)

      it.effect("records the page to a video file where the browser writes one", () =>
        Effect.gen(function*() {
          const { info } = yield* Browser.Browser
          const url = yield* fixture(`<p id="t"></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>`)
          const recorded = yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            return yield* Effect.scoped(Effect.gen(function*() {
              const recording = yield* page.capability(Capability.Video)
              yield* Effect.sleep("800 millis")
              return recording
            })).pipe(Effect.exit)
          }))
          if (info.protocol !== "bidi") {
            const error = yield* Effect.flip(recorded)
            assert(Capability.isCapabilityError(error), String(error))
            assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.video" })
            return
          }
          assert(recorded._tag === "Success", String(recorded))
          // Written into the context's downloads, which go with it: read before then, so here the file is gone
          const file = yield* recorded.value.file
          assert.match(file, /\.webm$/)
        }), timeout)

      it.effect("writes a WebM file Firefox's page records, while its context lives", () =>
        Effect.gen(function*() {
          const { info } = yield* Browser.Browser
          if (info.protocol !== "bidi") return
          const url = yield* fixture(`<p id="t"></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const recording = yield* Effect.scoped(Effect.gen(function*() {
              const recording = yield* page.capability(Capability.Video)
              yield* Effect.sleep("800 millis")
              return recording
            }))
            const file = yield* recording.file
            const bytes = fs.readFileSync(file)
            // WebM is EBML
            assert.deepStrictEqual(Array.from(bytes.subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3])
          }))
        }), timeout)

      it.effect("opens a span per protocol command, under its operation's, when asked", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<p>traced</p>`)
          const spans: Array<Tracer.NativeSpan> = []
          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options)
              spans.push(span)
              return span
            }
          })
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url).pipe(Effect.provideService(Browser.TraceProtocolCommands, true))
            yield* page.reload()
          })).pipe(Effect.withTracer(tracer))
          const goto = spans.find((span) => span.name === "Page.goto")!
          assert.isDefined(goto)
          const commands = spans.filter((span) =>
            Option.isSome(span.parent) && span.parent.value.spanId === goto.spanId &&
            span.attributes.has("browser.protocol.method")
          )
          assert.isAbove(commands.length, 0, spans.map((span) => span.name).join(", "))
          // Only where asked: the reload's commands have none
          const reload = spans.find((span) => span.name === "Page.reload")!
          assert.isFalse(spans.some((span) => Option.isSome(span.parent) && span.parent.value.spanId === reload.spanId))
        }), timeout)
    })
  })
