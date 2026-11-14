/**
 * Playwright's `tests/library/tracing.spec.ts`: the trace a context or page records, its steps, screenshots, DOM
 * snapshots, network resources, sources, and its export.
 *
 * What the port changes:
 * - A recording is `Trace.record(context, options)`, scoped to the test (or to an `Effect.scoped` block where the
 *   original starts a second trace), and `exportTrace(path)` writes the archive. The archive is read with
 *   `effect/encoding/Zip`, as the HAR port reads one: `trace.trace` holds the header (`context-options`) and the
 *   steps and events, and `trace.network` the network entries as `resource-snapshot` events, as `parseTraceRaw`
 *   joins them.
 * - Steps are Strider's operations, named by the operation (`Page.goto`, `Locator.click`, `Mouse.click`), never
 *   Playwright's titles (`Navigate <url>`, `Click locator(...)`). The port asserts the top-level steps only: an
 *   operation run inside another is a step of it, with `parentId`, and Playwright's list has no such steps.
 * - `snapshots: { screen: true }` is `screenshots: "perAction"`. Strider takes one screenshot after each action, where
 *   the original expects three, so TR-006 fails on its phases.
 * - `snapshots: true` is `domSnapshots: true` with `network: true`, which the types require together.
 * - `screencast: true` frames are `screencast: { polled }`, which produces the same `screencast-frame` events on
 *   every browser.
 * - TR-003 sets the context's viewport, device scale factor, mobile flag, user agent, and extra headers through its
 *   `emulation`; Strider has no `baseURL`. Its header records no context options, so the options check fails.
 * - Strider exports local sources always, when a step has a caller location, so TR-016 has no `sources` option.
 * - Playwright's `waitForTimeout` is a fixed wait the original makes itself; it's ported as `Effect.sleep`, and
 *   Strider records no step for it, as Playwright's "Wait for timeout" step has no Strider operation.
 * - Playwright's `page.evaluate(...)` runs in the page's main world, where the page's own `alert`, `confirm`, and
 *   `window` globals are, so it's `page.evaluateInMainWorld`. Its `window.builtins.setTimeout` is `window.setTimeout`.
 * - `page.dblclick` and `page.mouse.dblclick` are `Locator.dblclick` and `Mouse.click` with `clickCount: 2`.
 * - `page.route` handlers that continue are `Route.fallthrough`, which runs no operation and so records no step.
 * - Dialogs: the original's default handler is the context's `dismiss` policy, and its listener is `Dialog.handle`.
 *   A click's dialog is held by its handler, so TR-032's handler waits for the test to decide it, as the original's
 *   manual `dialog.dismiss()` does.
 * - TR-020 and TR-021 launch a second browser, as the originals do, and close it while a recording runs: the browser's
 *   scope and the recording's are separate, so the browser's closing is what the recording survives.
 * - TR-025 asserts the second recording on a context fails, as Playwright's second `start` does. Strider's recordings
 *   are independent, so it doesn't.
 * - Strider has no `context.tracing.group`. The group of TR-008 is an operation named `actual`, which is what
 *   `Operation.named` provides; the groups the original leaves open or ends early have no counterpart.
 * - Strider has no `page.click(selector)` text syntax: `page.getByText("…", { exact: true })` is the original's
 *   `'"…"'` selector.
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  ConsoleMessage,
  Deadline,
  Dialog,
  Expect,
  FileInput,
  Operation,
  Route,
  Trace
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend } from "../../harness/browsers.ts"
import { assetPath, failureOf, startWaiting } from "../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/** A trace event: the header, a step's `before` and `after`, and each recorded capture or event. */
interface Frame {
  readonly line: number
  readonly column: number
  readonly file: string
  readonly function: string
}
interface Snapshot {
  readonly callId?: string
  readonly phase?: string
  readonly pageId?: string
  readonly html?: unknown
  readonly request?: { readonly url: string; readonly method: string }
  readonly response?: {
    readonly status?: number
    readonly content?: { readonly _file?: string }
    readonly _failureText?: string
  }
  readonly time?: number
  readonly _monotonicTime?: number
}
interface Event {
  readonly type: string
  readonly callId?: string
  readonly parentId?: string
  readonly title?: string
  readonly method?: string
  readonly params?: Readonly<Record<string, unknown>>
  readonly class?: string
  readonly phase?: string
  readonly file?: string
  readonly pageId?: string
  readonly width?: number
  readonly height?: number
  readonly stack?: ReadonlyArray<Frame>
  readonly result?: unknown
  readonly snapshot?: Snapshot
}

/** The captures the original's `snapshots: true` enables: screenshots, a polled screencast, and DOM snapshots. */
const snapshots: Trace.Options = {
  screenshots: "perAction",
  screencast: { polled: "100 millis" },
  domSnapshots: true,
  network: true
}

/** A scratch directory for one test's exports, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-tracing-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/** Reads a zip's entries, by path, as the HAR port does. */
const unzip = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
        const all = Array.from(chunks)
        const bytes = new Uint8Array(all.reduce((size, chunk) => size + chunk.length, 0))
        let at = 0
        for (const chunk of all) {
          bytes.set(chunk, at)
          at += chunk.length
        }
        return [entry.header.path, bytes] as const
      }))
    ),
    Stream.runCollect,
    Effect.map((entries) => new Map(entries))
  )

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

/** The archive's trace, as the viewer reads it: the header and steps in `trace.trace`, the network in `trace.network`. */
const readTrace = Effect.fnUntraced(function*(file: string) {
  const resources = yield* unzip(file)
  const lines = (name: string): ReadonlyArray<Event> =>
    text(resources.get(name)).split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as Event)
  const events = [...lines("trace.trace"), ...lines("trace.network")]
  return {
    events,
    resources,
    actions: events.filter((event) => event.type === "before" && event.parentId === undefined).map((event) =>
      event.title ?? ""
    )
  }
})

/** The element at `index`, which the test asserts exists: a missing element fails the test where it's read. */
const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no element ${index} of ${items.length}`)
  return item
}

/** The width of a PNG, from its IHDR chunk. */
const pngWidth = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)

/** Exports a recording to `name` in the scratch directory, and reads it back. */
const exportTrace = Effect.fnUntraced(function*(
  recording: Trace.Recording,
  directory: string,
  name = "trace.zip"
) {
  const file = yield* recording.exportTrace(path.join(directory, name))
  return yield* readTrace(file)
})

/** The page's context, which the original's `context.tracing` records. */
const recordContext = (page: Fixtures["page"], options?: Trace.Options) => Trace.record(page.context, options)

/** Whether every frame of a step's stack is in this file, as the original's `relativeStack` checks. */
const inThisFile = (event: Event) =>
  (event.stack ?? []).every((frame) => path.basename(frame.file) === "tracing.test.ts")

upstream(import.meta.filename, {}, (test) => {
  test("TR-001", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      yield* page.goto(server.PREFIX + "/frames/frame.html")
      yield* page.setContent("<button>Click</button>")
      yield* page.getByText("Click", { exact: true }).click()
      yield* page.mouse.move({ x: 20, y: 20 })
      yield* page.mouse.click({ x: 30, y: 30 }, { clickCount: 2 })
      yield* page.keyboard.insertText("abc")
      yield* page.goto(server.PREFIX + "/input/fileupload.html")
      yield* page.locator("input[type=\"file\"]").setInputFiles(
        FileInput.local(assetPath("playwright", "file-to-upload.txt"))
      )
      // Give it some time to produce screenshots. Strider records no step for this wait.
      yield* Effect.sleep("2 seconds")
      yield* page.close()
      const { events, actions } = yield* exportTrace(trace, directory)

      assert.strictEqual(events[0]!.type, "context-options")
      assert.deepStrictEqual(actions, [
        "Page.goto",
        "Page.setContent",
        "Locator.click",
        "Mouse.move",
        "Mouse.click",
        "Keyboard.insertText",
        "Page.goto",
        "Locator.setInputFiles",
        "Page.close"
      ])

      assert.isTrue(events.some((event) => event.type === "frame-snapshot"))
      assert.isTrue(events.some((event) => event.type === "screencast-frame"))
      const style = events.find((event) =>
        event.type === "resource-snapshot" && event.snapshot?.request?.url.endsWith("style.css") === true
      )
      assert.isDefined(style)
      assert.isDefined(style!.snapshot!.response!.content!._file)
      const script = events.find((event) =>
        event.type === "resource-snapshot" && event.snapshot?.request?.url.endsWith("script.js") === true
      )
      assert.isDefined(script)
      // Playwright's traces keep no JavaScript, so the original's archive has no file for the script. Strider writes
      // every response body it records, scripts included, so this fails.
      assert.isUndefined(script!.snapshot!.response!.content!._file)
    }))

  test("TR-002", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page)
      // `route` continues without a step: a fallthrough runs no operation, so the registration is the only route step.
      yield* page.route("**/empty.html", () => Route.fallthrough)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.goto(server.PREFIX + "/grid.html")

      // The default dialog policy decides this alert: it's dismissed without a handler, and records no step.
      yield* page.evaluateInMainWorld(() => {
        alert("yo")
      })
      yield* page.reload()
      // Now a dialog handler decides, and its decision is a step, which follows the evaluation that opened the
      // dialog. The handler's decision is the operation `Dialog.handle`, as the original's step is "Accept dialog".
      yield* Dialog.handle(page, Dialog.acceptAll)
      yield* page.evaluateInMainWorld(() => {
        alert("yo")
      })

      const { events, actions } = yield* exportTrace(trace, directory)
      assert.strictEqual(events[0]!.type, "context-options")
      assert.deepStrictEqual(actions, [
        "Page.route",
        "Page.goto",
        "Page.goto",
        "Page.evaluateInMainWorld",
        "Page.reload",
        "Page.evaluateInMainWorld",
        "Dialog.handle"
      ])
    }))

  test("TR-003", ({ server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const context = yield* Browser.newContext({
        emulation: {
          viewport: { width: 500, height: 600, deviceScaleFactor: 2, mobile: false },
          userAgent: "custom-ua",
          extraHTTPHeaders: { "x-secret": "secret-header" }
        },
        httpCredentials: { username: "user", password: Redacted.make("secret-password") }
      })
      yield* context.cookies.set({
        name: "session",
        value: "secret-cookie",
        scope: { domain: "localhost", path: "/" }
      })
      const trace = yield* Trace.record(context)
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const file = yield* trace.exportTrace(path.join(directory, "trace.zip"))
      const { events, resources } = yield* readTrace(file)

      assert.strictEqual(events[0]!.type, "context-options")
      // The archive's bytes, as the original reads them: the secrets are absent from the file itself. These are checked
      // before the options, which Strider's header doesn't carry, so that failure doesn't hide them.
      const archive = text(new Uint8Array(fs.readFileSync(file)))
      assert.isFalse(archive.includes("secret-password"))
      assert.isFalse(archive.includes("secret-header"))
      assert.isFalse(archive.includes("secret-cookie"))
      assert.isTrue(resources.has("trace.trace"))
      // The context's configuration, but its secrets: Strider has no `baseURL` option, so the original's is absent.
      assert.deepStrictEqual((events[0] as { readonly options?: unknown }).options, {
        viewport: { width: 500, height: 600 },
        deviceScaleFactor: 2,
        isMobile: false,
        userAgent: "custom-ua"
      })
    }))

  test("TR-004", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page)
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<button>Click</button>")
      yield* page.getByText("Click", { exact: true }).click()
      yield* page.close()
      const { events } = yield* exportTrace(trace, directory)
      assert.isFalse(events.some((event) => event.type === "frame-snapshot"))
      assert.isFalse(events.some((event) => event.type === "resource-snapshot"))
    }))

  test("TR-005", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, { domSnapshots: true, network: true })
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").click()
      const { events } = yield* exportTrace(trace, directory)
      assert.isFalse(events.some((event) => event.type === "screenshot"))
      // Strider has no aria snapshot in a trace, so the original's `aria-snapshot` events are absent.
      assert.isFalse(events.some((event) => event.type === "aria-snapshot"))
    }))

  test("TR-006", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, { screenshots: "perAction" })
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").click()
      const { events, resources } = yield* exportTrace(trace, directory)

      const clickCallId = nth(events.filter((event) => event.type === "before" && event.method === "click"), 0).callId
      const screenshots = events.filter((event) => event.type === "screenshot" && event.callId === clickCallId)
      // Each screenshot there is, checked as the original checks them; the phases follow, which fail for Strider's one.
      for (const screenshot of screenshots) {
        assert.strictEqual(screenshot.file, `screenshots/${clickCallId}-${screenshot.phase}.png`)
        assert.isAbove(pngWidth(resources.get(screenshot.file!)!), 0)
      }
      assert.deepStrictEqual(screenshots.map((event) => event.phase), ["before", "action", "after"])
    }))

  test("TR-008", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      // Strider has no imperative group: an operation named `actual` is the group, and the steps inside it nest under it.
      const trace = yield* recordContext(page)
      yield* page.goto(server.EMPTY_PAGE).pipe(Operation.named("actual"))
      const { events } = yield* exportTrace(trace, directory)

      const groups = events.filter((event) => event.type === "before" && event.title === "actual")
      assert.strictEqual(groups.length, 1)
      assert.strictEqual(groups[0]!.title, "actual")
      assert.isTrue(events.some((event) => event.type === "after" && event.callId === groups[0]!.callId))
    }))

  test("TR-009", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.screenshot()
      const { events } = yield* exportTrace(trace, directory)
      const screenshot = nth(events.filter((event) => event.type === "before" && event.title === "Page.screenshot"), 0)
      const phases = events
        .filter((event) => event.type === "frame-snapshot" && event.snapshot?.callId === screenshot.callId)
        .map((event) => event.snapshot?.phase)
      assert.include(phases, "before")
      assert.include(phases, "after")
      // Strider records no result value for a step, so the screenshot's bytes appear only as a screenshot event.
      const after = events.find((event) => event.type === "after" && event.callId === screenshot.callId)
      assert.isUndefined(after?.result)
    }))

  test("TR-010", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* page.goto(server.EMPTY_PAGE)
      const trace = yield* recordContext(page)
      yield* page.context.exportStorageState
      yield* page.close()
      const { events } = yield* exportTrace(trace, directory)
      const pageIds = new Set<string>()
      for (const event of events) {
        // Playwright's `params.pageId` is the `browser.page.id` Strider's steps carry as a param
        const pageId = event.pageId ?? event.snapshot?.pageId ?? event.params?.["browser.page.id"]
        if (typeof pageId === "string") pageIds.add(pageId)
      }
      assert.strictEqual(pageIds.size, 1)
    }))

  test("TR-012", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      // Each recording ends with its scope, as the original's `stop` ends its trace before the next `start`.
      yield* Effect.scoped(Effect.gen(function*() {
        const trace = yield* recordContext(page, snapshots)
        yield* page.goto(server.EMPTY_PAGE)
        yield* page.setContent("<button>Click</button>")
        yield* page.getByText("Click", { exact: true }).click()
        const { events, actions } = yield* exportTrace(trace, directory, "trace1.zip")
        assert.strictEqual(events[0]!.type, "context-options")
        assert.deepStrictEqual(actions, ["Page.goto", "Page.setContent", "Locator.click"])
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const trace = yield* recordContext(page, snapshots)
        yield* page.getByText("Click", { exact: true }).dblclick()
        yield* page.close()
        const { events, actions } = yield* exportTrace(trace, directory, "trace2.zip")
        assert.strictEqual(events[0]!.type, "context-options")
        assert.deepStrictEqual(actions, ["Locator.dblclick", "Page.close"])
      }))
    }))

  test("TR-015", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const file = path.join(directory, "trace1.zip")
      yield* Effect.scoped(Effect.gen(function*() {
        const trace = yield* recordContext(page, snapshots)
        yield* page.goto(server.EMPTY_PAGE)
        yield* page.setContent("<button>Click</button>")
        yield* page.getByText("Click", { exact: true }).click()
        yield* trace.exportTrace(file)
        const { resources } = yield* readTrace(file)
        assert.strictEqual(Array.from(resources.keys()).filter((name) => name.endsWith(".html")).length, 1)
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        // A second recording with no actions overwrites the same file.
        const trace = yield* recordContext(page, snapshots)
        yield* trace.exportTrace(file)
        const { resources } = yield* readTrace(file)
        assert.strictEqual(Array.from(resources.keys()).filter((name) => name.endsWith(".html")).length, 0)
      }))
    }))

  test("TR-016", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page)
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<button>Click</button>")
      yield* page.getByText("Click", { exact: true }).click()
      const { resources } = yield* exportTrace(trace, directory, "trace1.zip")

      // Strider exports the local sources of the steps' caller locations; it has no `sources` option to ask for them.
      const sourceNames = Array.from(resources.keys()).filter((key) => key.startsWith("src/"))
      assert.strictEqual(sourceNames.length, 1)
      assert.match(nth(sourceNames, 0), /^src\/[0-9a-f]{40}\.ts$/)
      const thisFile = fs.readFileSync(import.meta.filename)
      assert.deepStrictEqual(Buffer.from(resources.get(nth(sourceNames, 0))!), thisFile)
    }))

  test("TR-017", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      yield* page.route("**/*", () => Route.abort("connectionAborted"))
      yield* page.goto(server.EMPTY_PAGE).pipe(Effect.ignore)
      const { events } = yield* exportTrace(trace, directory)

      const requestEvent = events.find((event) =>
        event.type === "resource-snapshot" && event.snapshot?.response?._failureText !== undefined
      )
      assert.isDefined(requestEvent)
      assert.isAbove(requestEvent!.snapshot!._monotonicTime!, 0)
      assert.isAtLeast(requestEvent!.snapshot!.time!, 0)
    }))

  test("TR-018", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const first = yield* recordContext(page)
      // Saving fails: a parent of the destination is a file, not a directory.
      const blocker = path.join(directory, "blocker")
      yield* Effect.sync(() => fs.writeFileSync(blocker, ""))
      const failure = yield* first.exportTrace(path.join(blocker, "trace1.zip")).pipe(Effect.flip)
      assert.strictEqual(failure.reason._tag, "WriteFailed")
      if (failure.reason._tag === "WriteFailed") {
        assert.strictEqual(failure.reason.path, path.join(blocker, "trace1.zip"))
      }

      // The failed export must not wedge tracing for the rest of the context's life.
      const second = yield* recordContext(page)
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.locator("button").click()
      const { events, actions } = yield* exportTrace(second, directory, "trace2.zip")
      assert.strictEqual(events[0]!.type, "context-options")
      assert.include(actions, "Locator.click")
    }))

  test("TR-020", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      // The original launches its own browser and closes it mid-trace. The recording's scope is apart from the
      // browser's, so the browser closes while the recording runs.
      const browser = yield* Scope.make()
      const recording = yield* Scope.make()
      const services = yield* Layer.buildWithScope(backend(browserName, undefined), browser)
      yield* Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* recordContext(page, snapshots).pipe(Scope.provide(recording))
        yield* page.goto(server.EMPTY_PAGE)
      }).pipe(Effect.provideContext(services), Scope.provide(browser))
      yield* Scope.close(browser, Exit.void)
      // Give it some time to throw errors: the original's own wait.
      yield* Effect.sleep("1 second")
      yield* Scope.close(recording, Exit.void)
    }))

  test("TR-021", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      // Playwright's own `_defaultTracesDir` has no Strider counterpart; the rest is a browser closing while a recording
      // runs and many operations are in flight.
      const browser = yield* Scope.make()
      const recording = yield* Scope.make()
      const services = yield* Layer.buildWithScope(backend(browserName, undefined), browser)
      const page = yield* Browser.newPage().pipe(Effect.provideContext(services), Scope.provide(browser))
      yield* recordContext(page).pipe(Scope.provide(recording))

      let done = false
      const go = Effect.gen(function*() {
        while (!done) {
          // Produce a lot of operations to make sure the recording has work queued.
          for (let i = 0; i < 100; i++) yield* Effect.forkDetach(page.evaluate(() => 1 + 1).pipe(Effect.ignore))
          yield* Effect.sleep("250 millis")
        }
      })
      const loop = yield* Effect.forkDetach(go)
      yield* Effect.sleep("1 second")

      // Close the browser and give it some time to fail.
      yield* Effect.all([Scope.close(browser, Exit.void), Effect.sleep("500 millis")], { concurrency: 2 })
      done = true
      yield* Fiber.interrupt(loop)
      yield* Scope.close(recording, Exit.void)
    }))

  test("TR-022", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      yield* page.goto(server.EMPTY_PAGE)
      yield* Dialog.handle(page, Dialog.acceptAll)
      yield* page.evaluateInMainWorld(() => {
        confirm("are you sure")
      })
      // The export completes: the dialog was decided, so nothing stalls.
      yield* trace.exportTrace(path.join(directory, "trace.zip"))
    }))

  test("TR-024", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<button>Click</button>")
      // The click can't finish: its element doesn't exist. Its step is in flight when the trace is exported, as the
      // original's un-awaited click is when `stop` runs.
      const pending = yield* startWaiting(page.getByText("ClickNoButton", { exact: true }).click().pipe(Effect.ignore))
      const { actions } = yield* exportTrace(trace, directory)
      yield* Fiber.interrupt(pending.fiber)
      assert.include(actions, "Locator.click")
    }))

  test("TR-025", ({ page }) =>
    Effect.gen(function*() {
      yield* recordContext(page, snapshots)
      // Playwright refuses a second start on the context; Strider's recordings are independent.
      const failure = yield* failureOf(recordContext(page, { screenshots: "off" }), "the second recording")
      assert.isTrue(Trace.isTraceError(failure))
    }))

  test("TR-031", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      for (let timeout = 0; timeout < 200; timeout += 20) {
        yield* Effect.scoped(Effect.gen(function*() {
          const trace = yield* recordContext(page, snapshots)
          yield* page.goto(server.PREFIX + "/grid.html")

          // Navigate to the same page to produce the same trace resources that might be concurrently exported.
          const navigation = yield* startWaiting(page.goto(server.PREFIX + "/grid.html"))
          // The original's own `page.waitForTimeout(timeout)`, which lets the navigation get as far as it gets.
          yield* Effect.sleep(timeout)
          yield* Effect.all([Fiber.join(navigation.fiber), trace.exportTrace(path.join(directory, "trace.zip"))], {
            concurrency: 2
          })
        }))
      }
    }))

  test("TR-032", ({ page }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      // The dialog is held until the test releases it, as the original dismisses it by hand after its click.
      const opened = yield* Deferred.make<Dialog.Pending>()
      const release = yield* Deferred.make<void>()
      yield* Dialog.handle(page, (dialog) =>
        Effect.gen(function*() {
          yield* Deferred.succeed(opened, dialog)
          yield* Deferred.await(release)
          return yield* Dialog.dismissAll(dialog)
        }))
      yield* page.setContent(`<div onclick='window.alert(123)'>Click me</div>`)
      // The click waits for the dialog's decision, so it times out at 3.5 seconds, as the original's does.
      yield* page.locator("div").click().pipe(Deadline.within("3500 millis"), Effect.ignore)
      yield* Deferred.await(opened)
      yield* Deferred.succeed(release, undefined)
      yield* trace.exportTrace(path.join(directory, "trace.zip"))
    }))

  test("TR-033", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* page.goto(server.PREFIX + "/input/button.html")
      yield* page.evaluateInMainWorld(() => {
        document.head.appendChild(document.createElement("iframe"))
        // Add iframe in a shadow tree.
        const div = document.createElement("div")
        document.head.appendChild(div)
        const shadow = div.attachShadow({ mode: "open" })
        shadow.appendChild(document.createElement("iframe"))
      })

      const trace = yield* recordContext(page, snapshots)
      yield* page.locator("button").click()
      const { events, actions } = yield* exportTrace(trace, directory)
      assert.deepStrictEqual(actions, ["Locator.click"])
      assert.isDefined(events.find((event) => event.type === "frame-snapshot"))
      assert.isUndefined(
        events.find((event) =>
          event.type === "frame-snapshot" && JSON.stringify(event.snapshot?.html).includes("IFRAME")
        )
      )
    }))

  test("TR-034", ({ page }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      const evaluations: Array<Fiber.Fiber<unknown, unknown>> = []
      yield* Dialog.handle(page, (dialog) =>
        Effect.gen(function*() {
          // Playwright's evaluate isn't awaited inside the listener: it runs alongside the dismissal.
          // Detached, since a child fiber ends with the handler's, which decides before the evaluation can finish.
          evaluations.push(yield* Effect.forkDetach(page.evaluate(() => 2 + 2)))
          return yield* Dialog.dismissAll(dialog)
        }))
      yield* page.setContent(`<div onclick='window.alert(123)'>Click me</div>`)
      yield* page.locator("div").click()
      yield* Effect.all(evaluations.map(Fiber.join))
      const { events } = yield* exportTrace(trace, directory)

      const actions = events.filter((event) => event.type === "before" && event.class !== "Tracing")
      // The stacks first, so that a missing step (the dialog's decision, which Strider records no step for) doesn't hide them.
      for (const action of actions) assert.isTrue(inThisFile(action))
      assert.strictEqual(actions.length, 4)
    }))

  test("TR-035", ({ page }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page, snapshots)
      const waits: Array<Fiber.Fiber<void, unknown>> = []
      yield* Dialog.handle(page, (dialog) =>
        Effect.gen(function*() {
          waits.push(yield* Effect.forkDetach(Expect.toHaveTitle(page, "Hello")))
          return yield* Dialog.dismissAll(dialog)
        }))
      yield* page.setContent(`<title>Hello</title><div onclick='window.alert(123)'>Click me</div>`)
      yield* page.locator("div").click()
      yield* Expect.toBeVisible(page.locator("div"))
      yield* Effect.all(waits.map(Fiber.join))
      const { events } = yield* exportTrace(trace, directory)

      const actions = events.filter((event) => event.type === "before" && event.class !== "Tracing")
      // The stacks first, so that a missing step (the dialog's decision, which Strider records no step for) doesn't hide them.
      for (const action of actions) assert.isTrue(inThisFile(action))
      assert.strictEqual(actions.length, 5)
    }))

  test("TR-040", ({ page }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const trace = yield* recordContext(page)
      const consoleMessages = yield* ConsoleMessage.stream(page)
      const messages = yield* startWaiting(consoleMessages.pipe(Stream.take(100), Stream.runDrain))
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          for (let i = 0; i < 100; ++i) console.log("hello " + i)
        })
      })
      yield* Fiber.join(messages.fiber)
      const { events } = yield* exportTrace(trace, directory)
      assert.strictEqual(events.filter((event) => event.type === "console").length, 100)
    }))
})
