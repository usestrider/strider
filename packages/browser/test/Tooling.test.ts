/**
 * Review 20's first step, without a browser: launch profiles as values, the diagnostics presets, the span helper
 * and its references, roles, made files, `Browser.layerTest`'s fake and the Vitest adapter.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import {
  AriaRole,
  Browser,
  Diagnostics,
  Dialog,
  FileInput,
  Har,
  LaunchProfile,
  NetworkResponse,
  Page,
  PageNavigation,
  Popup,
  Trace
} from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/browser/test/vitest"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Tracer from "effect/Tracer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { TestRunner } from "vitest"
import * as Chromium from "../src/internal/chromiumLauncher.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Firefox from "../src/internal/firefoxLauncher.ts"
import * as Spans from "../src/internal/spans.ts"

/** A tracer that keeps every span it makes. */
const recording = () => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  return { spans, tracer }
}

describe("LaunchProfile", () => {
  it("names the arguments and preferences each launcher applies", () => {
    assert.deepStrictEqual(LaunchProfile.stock.args, [])
    assert.deepStrictEqual(LaunchProfile.stock.prefs, {})
    for (const profile of [LaunchProfile.automation, LaunchProfile.concurrent]) {
      const name = profile.name as Chromium.Profile
      assert.deepStrictEqual(profile.args, Chromium.profileArgs[name])
      assert.deepStrictEqual(profile.prefs, Firefox.profilePrefs[name])
    }
    assert.include(LaunchProfile.concurrent.args, "--disable-renderer-backgrounding")
    assert.notInclude(LaunchProfile.automation.args, "--disable-renderer-backgrounding")
  })

  it("launches with a profile value's own arguments, in place of its name's", () => {
    const args = Chromium.argsFor({ profile: "automation", profileArgs: ["--custom"] }, "/tmp/profile", "pipe")
    assert.strictEqual(args[0], "--custom")
    assert.notInclude(args, LaunchProfile.automation.args[0])
  })
})

describe("Diagnostics presets", () => {
  it("shows a URL's query values only locally", () => {
    const url = "https://user:secret@shop.example.com/cart?token=abc&id=1&id=2#top"
    assert.strictEqual(Spans.redactUrl(url, "local"), url)
    assert.strictEqual(
      Spans.redactUrl(url, "strict"),
      "https://shop.example.com/cart?token=REDACTED&id=REDACTED"
    )
    assert.strictEqual(Spans.redactUrl("not a url", "strict"), "REDACTED")
  })

  it.effect("is strict unless set", () =>
    Effect.gen(function*() {
      assert.strictEqual(yield* Diagnostics.CurrentPreset, "strict")
      assert.strictEqual(yield* Diagnostics.withPreset(Diagnostics.CurrentPreset, "local"), "local")
      assert.strictEqual(yield* Diagnostics.CurrentPreset.pipe(Diagnostics.withPreset("local")), "local")
    }))
})

describe("AriaRole", () => {
  it("knows the roles its type names", () => {
    assert.isTrue(AriaRole.all.has("button"))
    assert.isTrue(AriaRole.isAriaRole("treeitem"))
    assert.isFalse(AriaRole.isAriaRole("buton"))
    assert.isFalse(AriaRole.isAriaRole(1))
    assert.strictEqual(AriaRole.all.size, 82)
  })
})

describe("FileInput.bytes", () => {
  it("is a file input", () => {
    assert.isTrue(FileInput.isFileInput(FileInput.bytes("a.txt", "text/plain", new Uint8Array([104, 105]))))
  })
})

describe("Spans", () => {
  it.effect("names each operation's span, attributes its target, and redacts its URL", () =>
    Effect.gen(function*() {
      const { spans, tracer } = recording()
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto("https://shop.example.com/?q=shoes")
      })).pipe(
        Effect.provide(Browser.layerTest("")),
        Effect.withTracer(tracer),
        Effect.provideService(Browser.SpanNameGenerator, (operation) => `strider ${operation.name}`)
      )
      const goto = spans.find((span) => span.name === "strider Page.goto")
      assert.isDefined(goto, spans.map((span) => span.name).join(", "))
      assert.strictEqual(goto!.attributes.get("browser.operation"), "Page.goto")
      assert.strictEqual(goto!.attributes.get("url.full"), "https://shop.example.com/?q=REDACTED")
      assert.isString(goto!.attributes.get("browser.page.id"))
      assert.isDefined(spans.find((span) => span.name === "strider Browser.newPage"))
    }))

  it.effect("suppresses the spans a predicate picks, and shows URLs whole under the local preset", () =>
    Effect.gen(function*() {
      const { spans, tracer } = recording()
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto("https://shop.example.com/?q=shoes")
      })).pipe(
        Effect.provide(Browser.layerTest("")),
        Effect.withTracer(tracer),
        Effect.provideService(Browser.TracerDisabledWhen, (operation) => operation.name === "Browser.newPage"),
        Diagnostics.withPreset("local")
      )
      assert.isUndefined(spans.find((span) => span.name === "Browser.newPage"))
      const goto = spans.find((span) => span.name === "Page.goto")
      assert.strictEqual(goto?.attributes.get("url.full"), "https://shop.example.com/?q=shoes")
    }))
})

describe("Browser.layerTest", () => {
  it("fails at once on a step it can't read, naming where", () => {
    assert.throws(() => Fake.parse("--resp(cart)--wat"), /"wat" at 14/)
    assert.throws(() => Fake.parse("dialog(popup)"), /isn't alert, confirm, prompt or beforeunload/)
    assert.deepStrictEqual(Fake.parse(" - | ").map((step) => step._tag), ["Tick", "Close"])
  })

  it.effect("plays the first page's timeline on Effect's clock", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const cart = yield* NetworkResponse.next(page, { url: "https://example.test/cart" })
      const navigation = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* TestClock.adjust("20 millis")
      const response = yield* cart
      assert.strictEqual(response.status, 200)
      assert.strictEqual((yield* page.status)._tag, "Open")
      yield* TestClock.adjust("40 millis")
      const committed = yield* navigation
      assert.strictEqual(committed._tag, "Committed")
      assert.strictEqual(committed.url, "https://example.test/")
      yield* TestClock.adjust("20 millis")
      const reason = yield* page.closed
      assert.deepStrictEqual(reason, { _tag: "PageClosed", by: "script" })
    })).pipe(Effect.provide(Browser.layerTest("--resp(cart)--commit--load--|"))))

  it.effect("opens a timeline's dialogs and popups, decided and reported as a browser's are", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const handler = yield* Dialog.handle(page, Dialog.dismissAll)
      const popups = yield* Popup.next(page)
      yield* TestClock.adjust("10 millis")
      assert.strictEqual(yield* handler.handled, 1)
      assert.strictEqual((yield* Dialog.history(page)).entries[0]?._tag, "Confirm")
      yield* TestClock.adjust("10 millis")
      const popup = yield* popups
      assert.strictEqual((yield* popup.status)._tag, "Open")
      yield* TestClock.adjust("10 millis")
      assert.deepStrictEqual(yield* page.closed, { _tag: "PageCrashed" })
    })).pipe(Effect.provide(Browser.layerTest("dialog(confirm)-popup-crash"))))

  it.effect("has no DOM: the engine is unsupported", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const error = yield* page.title.pipe(Effect.flip)
      assert(error._tag === "PageError", String(error))
      assert.strictEqual(error.reason._tag, "Unsupported")
      const browser = yield* Browser.Browser
      assert.strictEqual(browser.info.protocol, "fake")
    })).pipe(Effect.provide(Browser.layerTest(""))))
})

describe("VitestBrowser", () => {
  it.effect("describes the test running, and attaches its files", () =>
    Effect.gen(function*() {
      const run = yield* TestRun.TestRun
      assert.include(run.info.id, "VitestBrowser > describes the test running, and attaches its files")
      assert.include(run.info.file, "Tooling.test.ts")
      assert.strictEqual(run.info.attempt, 0)
      yield* run.attach({ _tag: "Screenshot", path: "test/Tooling.test.ts" as never })
      const test = TestRunner.getCurrentTest()!
      assert.deepInclude(
        test.artifacts.map((artifact) => artifact.type),
        "@usestrider/browser"
      )
    }).pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>))))

  it("reads the current test each time", () => {
    const { info } = Effect.runSync(
      TestRun.TestRun.pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>)))
    )
    assert.include(info.id, "reads the current test each time")
  })
})

/** A fresh directory for a test's files. */
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), "strider-recordings-"))

/** A zip's entries, as text. */
const unzip = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.mkString(Stream.decodeText(entry.body)).pipe(Effect.map((text) => [entry.header.path, text] as const))
    ),
    Stream.runCollect,
    Effect.map((entries) => new Map(entries))
  )

describe("Recordings", () => {
  it.effect("records a HAR of the timeline's responses, with the library's timings", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "cart.har")
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const har = yield* Har.record(page, { content: "embed" })
        yield* TestClock.adjust("20 millis")
        yield* har.entries.waitFor((count) => count === 1)
        assert.strictEqual(yield* har.exportHar(out), out)
      })).pipe(Effect.provide(Browser.layerTest("--resp(cart)--")))
      const { log } = JSON.parse(fs.readFileSync(out, "utf8"))
      assert.strictEqual(log.version, "1.2")
      assert.strictEqual(log.entries.length, 1)
      const [entry] = log.entries
      assert.strictEqual(entry.request.url, "https://example.test/cart")
      assert.deepInclude(entry.response, { status: 200, statusText: "OK", httpVersion: "http/1.1" })
      assert.deepInclude(entry.timings, { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0 })
      assert.isAtLeast(entry.timings.wait, 0)
      assert.strictEqual(entry.response.content.text, "")
      assert.isUndefined(entry._incomplete)
      assert.strictEqual(entry._resourceType, "fetch")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("records a trace whose steps nest in the caller's spans", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "trace.zip")
      const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
        yield* page.goto("https://example.test/cart")
        yield* Effect.ignore(page.title)
      })
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        yield* checkout(page)
        yield* trace.exportTrace(out)
      })).pipe(Effect.provide(Browser.layerTest("")))
      const files = yield* unzip(out)
      const events = files.get("trace.trace")!.trim().split("\n").map((line) => JSON.parse(line))
      assert.deepInclude(events[0], { version: 9, type: "context-options", origin: "library", browserName: "fake" })
      const before = events.filter((event) => event.type === "before")
      const group = before.find((event) => event.title === "checkout")
      const goto = before.find((event) => event.title === "Page.goto")
      assert.isDefined(group)
      assert.deepInclude(goto, { class: "Page", method: "goto", parentId: group.callId })
      assert.strictEqual(goto.params["url.full"], "https://example.test/cart")
      const title = before.find((event) => event.title === "Page.title")
      const failed = events.find((event) => event.type === "after" && event.callId === title.callId)
      assert.strictEqual(failed.error.name, "PageError")
      const groupEnd = events.find((event) => event.type === "after" && event.callId === group.callId)
      assert.isAtLeast(groupEnd.endTime, group.startTime)
    }).pipe(Effect.provide(NodeServices.layer)))
})
