/**
 * Review 20's first step, without a browser: launch profiles as values, the diagnostics presets, the span helper
 * and its references, roles, made files, `Browser.layerTest`'s fake and the Vitest adapter.
 */
import { assert, describe, it } from "@effect/vitest"
import {
  AriaRole,
  Browser,
  Diagnostics,
  Dialog,
  FileInput,
  LaunchProfile,
  NetworkResponse,
  PageNavigation,
  Popup
} from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/browser/test/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"
import * as Tracer from "effect/Tracer"
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
