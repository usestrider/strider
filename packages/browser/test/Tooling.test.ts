/**
 * The tooling, without a browser: launch profiles as values, the diagnostics presets, the span helper
 * and its references, roles, made files, `Browser.layerTest`'s fake and the Vitest adapter.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import {
  AriaRole,
  Browser,
  Deadline,
  Diagnostics,
  Dialog,
  Expect,
  FileInput,
  Har,
  LaunchProfile,
  NetworkResponse,
  Operation as PublicOperation,
  Page,
  PageNavigation,
  Popup,
  Target,
  Trace
} from "@usestrider/browser"
import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Tracer from "effect/Tracer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Chromium from "../src/internal/chromiumLauncher.ts"
import * as ExportTest from "../src/internal/cli/exportTest.ts"
import * as CliSession from "../src/internal/cli/session.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Firefox from "../src/internal/firefoxLauncher.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Recorders from "../src/internal/recorders.ts"
import * as Spans from "../src/internal/spans.ts"
import * as ToolkitImpl from "../src/internal/toolkit.ts"

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

  it("shares the screenshot surface feature with concurrent", () => {
    const feature = "--enable-features=CDPScreenshotNewSurface"
    for (const profile of [LaunchProfile.automation, LaunchProfile.concurrent]) {
      assert.strictEqual(profile.args.filter((arg) => arg === feature).length, 1)
    }
    assert.deepStrictEqual(
      LaunchProfile.concurrent.args.slice(0, LaunchProfile.automation.args.length),
      LaunchProfile.automation.args
    )
    assert.notInclude(LaunchProfile.stock.args, feature)
  })

  it("keeps caller feature switches verbatim after the preset", () => {
    const caller = [
      "--enable-features=Other",
      "--disable-features=CDPScreenshotNewSurface",
      "--enable-features=Final"
    ] as const
    const args = Chromium.argsFor({ profile: "automation", args: [...caller] }, "/tmp/profile", "pipe")
    const index = args.indexOf(caller[0])
    assert.deepStrictEqual(args.slice(index, index + caller.length), [...caller])
    assert.isBelow(args.indexOf("--enable-features=CDPScreenshotNewSurface"), index)
  })

  it("launches with a profile value's own arguments, in place of its name's", () => {
    const args = Chromium.argsFor({ profile: "automation", profileArgs: ["--custom"] }, "/tmp/profile", "pipe")
    assert.strictEqual(args[0], "--custom")
    assert.notInclude(args, LaunchProfile.automation.args[0])
    assert.notInclude(args, "--enable-features=CDPScreenshotNewSurface")
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

  it.effect("names a failed operation's error by its tag and its reason's", () =>
    Effect.gen(function*() {
      const { spans, tracer } = recording()
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        // Browser.layerTest has no DOM, so a read is Unsupported
        yield* page.locator("#missing").readText.pipe(Effect.ignore)
      })).pipe(Effect.provide(Browser.layerTest("")), Effect.withTracer(tracer))
      const read = spans.find((span) => span.name === "Locator.readText")
      assert.strictEqual(read?.attributes.get("error.type"), "LocatorError.Unsupported")
      assert.isFalse(spans.find((span) => span.name === "Browser.newPage")!.attributes.has("error.type"))
      assert.strictEqual(Spans.errorType({ _tag: "Timeout" }), "Timeout")
      assert.strictEqual(Spans.errorType(new Error("boom")), "_OTHER")
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
      assert.deepStrictEqual(reason, new Target.PageClosed({ by: "script" }))
    })).pipe(Effect.provide(Browser.layerTest("--resp(cart)--commit--load--|"))))

  it.effect("opens a timeline's dialogs and popups, decided and reported as a browser's are", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const handler = yield* Dialog.handle(page, Dialog.dismissAll)
      const popups = yield* Popup.next(page)
      // The dialog opens a tick in: a handler decides what opens after it is registered
      yield* TestClock.adjust("10 millis")
      assert.strictEqual(yield* handler.handled, 1)
      assert.strictEqual((yield* Dialog.history(page)).entries[0]?._tag, "Confirm")
      yield* TestClock.adjust("10 millis")
      const popup = yield* popups
      assert.strictEqual((yield* popup.status)._tag, "Open")
      yield* TestClock.adjust("10 millis")
      assert.deepStrictEqual(yield* page.closed, new Target.PageCrashed({}))
    })).pipe(Effect.provide(Browser.layerTest("-dialog(confirm)-popup-crash"))))

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
      // The directories on the way don't exist yet: the export creates them
      const out = path.join(directory(), "test-results", "cart", "cart.har")
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

  it.effect("exports expectation evidence in the viewer's error message", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "expectation.zip")
      const first = Operation.observed(false)
      const last = Operation.observed({ text: "Loading", count: 2 })
      const details = {
        subject: "cart",
        condition: "to be visible",
        last: Option.some(last),
        history: [first, last],
        elapsed: Duration.millis(125),
        checks: { count: 3, triggeredBy: ["initial", "change"] as const },
        nearest: Option.some("- button \"Cart\""),
        suggestions: ["getByRole(\"button\", { name: \"Cart\" })"],
        diagnostics: Operation.diagnostics("OP-test" as Diagnostics.OperationId)
      }
      const circular: { self?: unknown } = {}
      circular.self = circular
      const unprintable = {
        toJSON() {
          throw new Error("cannot encode")
        },
        toString() {
          throw new Error("cannot display")
        }
      }
      const errors = [
        new Expect.ExpectationFailed(details),
        new Expect.ExpectationFailed({
          ...details,
          last: Option.none(),
          history: [],
          nearest: Option.none(),
          suggestions: [],
          checks: { count: 0, triggeredBy: [] }
        }),
        new Expect.ExpectationFailed({
          ...details,
          last: Option.some(Operation.observed(circular)),
          history: [
            Operation.observed(1n),
            Operation.observed(undefined),
            Operation.observed(circular),
            Operation.observed(unprintable),
            Operation.observed(Redacted.make("wrapped-secret"))
          ]
        }),
        new Error("ordinary failure")
      ]
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        for (const error of errors) {
          const result = yield* Recorders.observe(
            "Expect.test",
            { "browser.page.id": page.id },
            false,
            Effect.fail(error)
          ).pipe(Effect.flip)
          assert.strictEqual(result, error)
        }
        yield* trace.exportTrace(out)
      })).pipe(Effect.provide(Browser.layerTest("")))
      const files = yield* unzip(out)
      const failures = files.get("trace.trace")!.trim().split("\n").map((line) => JSON.parse(line))
        .filter((event) => event.type === "after" && event.error).map((event) => event.error)
      assert.strictEqual(failures.length, 4)
      assert.strictEqual(failures[0].name, "ExpectationFailed")
      for (
        const evidence of [
          "Expected cart to be visible",
          "Last observed:",
          "Loading",
          "History:",
          "false",
          "Checks: 3 (initial, change)",
          "Elapsed: 125 ms",
          "Nearest match:\n- button \"Cart\"",
          "Suggestions:\ngetByRole(\"button\", { name: \"Cart\" })"
        ]
      ) assert.include(failures[0].message, evidence)
      assert.include(failures[1].message, "Checks: 0")
      for (const absent of ["Last observed:", "History:", "Nearest match:", "Suggestions:"]) {
        assert.notInclude(failures[1].message, absent)
      }
      assert.include(failures[2].message, "History:")
      assert.include(failures[2].message, "undefined")
      assert.include(failures[2].message, "1")
      assert.include(failures[2].message, "[Unprintable observed value]")
      assert.notInclude(files.get("trace.trace")!, "wrapped-secret")
      assert.deepStrictEqual(failures[3], { name: "Error", message: "ordinary failure" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("strips classified value evidence from exported expectation errors", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "value.zip")
      const value = Operation.observed("typed-password-secret")
      const error = new Expect.ExpectationFailed({
        subject: "getByLabel(\"Password\")",
        condition: "to have the value \"expected-password-secret\"",
        last: Option.some(value),
        history: [value],
        elapsed: Duration.millis(100),
        checks: { count: 1, triggeredBy: ["initial"] },
        nearest: Option.none(),
        suggestions: [],
        diagnostics: Operation.diagnostics("OP-test" as Diagnostics.OperationId)
      })
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        const result = yield* Recorders.observe(
          "Expect.toHaveValue",
          { "browser.page.id": page.id },
          false,
          Effect.fail(error)
        ).pipe(Effect.flip)
        assert.strictEqual(result, error)
        for (const preset of ["strict", "local"] as const) {
          yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
          const content = (yield* unzip(out)).get("trace.trace")!
          assert.notInclude(content, "typed-password-secret")
          assert.notInclude(content, "expected-password-secret")
          assert.include(content, "Last observed: REDACTED")
        }
        assert.include(error.message, "expected-password-secret")
        assert.deepStrictEqual(error.last, Option.some(value))
      })).pipe(Effect.provide(Browser.layerTest("")))
    }).pipe(Effect.provide(NodeServices.layer)))

  for (
    const [matcher, condition, observed, secrets] of [
      ["toHaveValue", "to have the value \"expected-password-secret\"", "typed-password-secret", [
        "expected-password-secret",
        "typed-password-secret"
      ]],
      [
        "toHaveURL",
        "to have the URL \"https://user:password@example.test/done?token=expected-secret#expected-fragment\"",
        "https://user:password@example.test/start?token=observed-secret#observed-fragment",
        ["user:", "password@", "expected-secret", "observed-secret", "expected-fragment", "observed-fragment"]
      ],
      ["toHaveTitle", "to have the title \"expected-title-secret\"", "observed-title-secret", [
        "expected-title-secret",
        "observed-title-secret"
      ]]
    ] as const
  ) {
    it.effect(`keeps ${matcher} classification through enclosing operations and rethrows`, () =>
      Effect.gen(function*() {
        const out = path.join(directory(), "enclosing.zip")
        const value = Operation.observed(observed)
        const error = new Expect.ExpectationFailed({
          subject: "subject",
          condition,
          last: Option.some(value),
          history: [value],
          elapsed: Duration.millis(100),
          checks: { count: 1, triggeredBy: ["initial"] },
          nearest: Option.none(),
          suggestions: [],
          diagnostics: Operation.diagnostics("OP-test" as Diagnostics.OperationId)
        })
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const trace = yield* Trace.record(page)
          const attributes = { "browser.page.id": page.id }
          const caught = yield* Recorders.observe(`Expect.${matcher}`, attributes, false, Effect.fail(error)).pipe(
            PublicOperation.named("checkout", { attributes }),
            Effect.flip
          )
          assert.strictEqual(caught, error)
          yield* trace.stop
          // The originating recording has stopped; classification follows the same error into a new one.
          const later = yield* Trace.record(page)
          const rethrown = yield* Effect.fail(caught).pipe(
            PublicOperation.named("retry checkout", { attributes }),
            Effect.flip
          )
          assert.strictEqual(rethrown, error)
          for (const [index, preset] of (["strict", "local", "strict"] as const).entries()) {
            for (const [recording, count] of [[trace, 2], [later, 1]] as const) {
              yield* recording.exportTrace(`${out}-${index}-${count}`).pipe(Diagnostics.withPreset(preset))
              const content = (yield* unzip(`${out}-${index}-${count}`)).get("trace.trace")!
              const failures = content.trim().split("\n").map((line) => JSON.parse(line))
                .filter((event) => event.type === "after" && event.error).map((event) => event.error)
              assert.strictEqual(failures.length, count)
              assert.isTrue(failures.every((failure) => failure.message === failures[0].message))
              for (const secret of secrets) {
                if (matcher === "toHaveValue" || preset === "strict") assert.notInclude(content, secret)
                else assert.include(failures[0].message, secret)
              }
            }
          }
        })).pipe(Effect.provide(Browser.layerTest("")))
      }).pipe(Effect.provide(NodeServices.layer)))
  }

  it.effect("keeps a real URL failure classified when caught before recording and rethrown", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "real-rethrow.zip")
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const pending = yield* page.pipe(
          Expect.toHaveURL("https://example.test/done?token=expected-secret#fragment-secret"),
          Deadline.within("100 millis"),
          Effect.flip,
          Effect.forkChild
        )
        yield* TestClock.adjust("2 seconds")
        const caught = yield* Fiber.join(pending)
        assert(Expect.isExpectationFailed(caught), String(caught))
        const trace = yield* Trace.record(page)
        const rethrown = yield* Effect.fail(caught).pipe(
          PublicOperation.named("checkout", { attributes: { "browser.page.id": page.id } }),
          Effect.flip
        )
        assert.strictEqual(rethrown, caught)
        for (const preset of ["strict", "local", "strict"] as const) {
          yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
          const content = (yield* unzip(out)).get("trace.trace")!
          if (preset === "strict") {
            assert.notInclude(content, "expected-secret")
            assert.notInclude(content, "fragment-secret")
          } else assert.include(content, "expected-secret#fragment-secret")
        }
      })).pipe(Effect.provide(Browser.layerTest("")))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("hides title evidence only under strict and URL regexps under strict", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "classified.zip")
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        for (
          const [name, condition] of [
            ["Expect.toHaveTitle", "to have the title \"expected-title-secret\""],
            ["Expect.toHaveURL", "to have the URL /expected-regexp-secret/"]
          ]
        ) {
          const value = Operation.observed("observed-title-secret")
          const error = new Expect.ExpectationFailed({
            subject: `page ${page.id}`,
            condition: condition!,
            last: Option.some(value),
            history: [value],
            elapsed: Duration.millis(1.703511),
            checks: { count: 1, triggeredBy: ["initial"] },
            nearest: Option.none(),
            suggestions: [],
            diagnostics: Operation.diagnostics("OP-test" as Diagnostics.OperationId)
          })
          yield* Recorders.observe(name!, { "browser.page.id": page.id }, false, Effect.fail(error)).pipe(Effect.flip)
        }
        for (const preset of ["strict", "local"] as const) {
          yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
          const content = (yield* unzip(out)).get("trace.trace")!
          for (const secret of ["expected-title-secret", "observed-title-secret", "expected-regexp-secret"]) {
            if (preset === "strict") assert.notInclude(content, secret)
            else assert.include(content, secret)
          }
          assert.include(content, "Elapsed: 2 ms")
        }
      })).pipe(Effect.provide(Browser.layerTest("")))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("records a failed URL expectation as a step of the page's trace", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "url-expectation.zip")
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        yield* page.goto("https://shop.example.com/account?token=secret-token")
        const pending = yield* page.pipe(
          Expect.toHaveURL("https://shop.example.com/done"),
          Deadline.within("100 millis"),
          Effect.flip,
          Effect.forkChild
        )
        yield* TestClock.adjust("2 seconds")
        const error = yield* Fiber.join(pending)
        assert(Expect.isExpectationFailed(error), String(error))
        yield* trace.exportTrace(out)
      })).pipe(Effect.provide(Browser.layerTest("")))
      const files = yield* unzip(out)
      const failures = files.get("trace.trace")!.trim().split("\n").map((line) => JSON.parse(line))
        .filter((event) => event.type === "after" && event.error).map((event) => event.error)
      // The page's URL expectation is a step of the page's trace, as its locator expectations are
      const failure = failures.find((error) => error.name === "ExpectationFailed")
      assert.isDefined(failure, JSON.stringify(failures))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("redacts observed URLs in an exported expectation message under the strict preset", () =>
    Effect.gen(function*() {
      const folder = directory()
      const actual =
        "https://observed-user:observed-password@shop.example.com/account?token=secret-token#observed-fragment"
      const expected =
        "https://expected-user:expected-password@shop.example.com/done?token=expected-token#expected-fragment"
      const earlier = Operation.observed("https://shop.example.com/start?token=earlier-token#earlier-fragment")
      const url = Operation.observed(actual)
      const error = new Expect.ExpectationFailed({
        subject: "page N1",
        condition: `to have the URL ${JSON.stringify(expected)}`,
        last: Option.some(url),
        history: [earlier, url],
        elapsed: Duration.millis(100),
        checks: { count: 2, triggeredBy: ["initial", "change"] },
        nearest: Option.none(),
        suggestions: [],
        diagnostics: Operation.diagnostics("OP-test" as Diagnostics.OperationId)
      })
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page)
        const original = yield* Recorders.observe(
          "Expect.toHaveURL",
          { "browser.page.id": page.id },
          false,
          Effect.fail(error)
        ).pipe(Effect.flip)
        assert.strictEqual(original, error)
        for (const [index, preset] of (["strict", "local", "strict"] as const).entries()) {
          const out = path.join(folder, `${index}.zip`)
          yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
          const files = yield* unzip(out)
          const content = files.get("trace.trace")!
          const failure = content.trim().split("\n").map((line) => JSON.parse(line))
            .find((event) => event.type === "after" && event.error)?.error
          if (preset === "local") {
            assert.include(failure.message, actual)
            assert.include(failure.message, expected)
            assert.include(failure.message, "earlier-token#earlier-fragment")
          } else {
            assert.include(failure.message, "https://shop.example.com/account?token=REDACTED")
            assert.include(failure.message, "https://shop.example.com/done?token=REDACTED")
            assert.include(failure.message, "https://shop.example.com/start?token=REDACTED")
            for (
              const secret of [
                "secret-token",
                "expected-token",
                "earlier-token",
                "observed-user",
                "observed-password",
                "expected-user",
                "expected-password",
                "observed-fragment",
                "expected-fragment",
                "earlier-fragment"
              ]
            ) assert.notInclude(content, secret)
          }
        }
        assert.deepStrictEqual(error.last, Option.some(url))
        assert.strictEqual(error.condition, `to have the URL ${JSON.stringify(expected)}`)
      })).pipe(Effect.provide(Browser.layerTest("")))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("records a trace whose steps nest in the caller's spans", () =>
    Effect.gen(function*() {
      const out = path.join(directory(), "test-results", "trace.zip")
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

describe("BrowserToolkit", () => {
  it("defines its tools, each returning failures as data", () => {
    const names = Object.keys(BrowserToolkit.toolkit.tools).sort()
    assert.deepStrictEqual(names, [
      "await",
      "back",
      "click",
      "control",
      "dialog",
      "expect",
      "fill",
      "find",
      "goto",
      "history",
      "newPage",
      "next",
      "pages",
      "press",
      "release",
      "route",
      "screenshot",
      "scroll",
      "select",
      "snapshot",
      "tabs"
    ])
    for (const tool of Object.values(BrowserToolkit.toolkit.tools)) assert.strictEqual(tool.failureMode, "return")
  })

  it.effect("puts in a secret for its own name alone, and sends any other text between % signs as written", () =>
    Effect.scoped(Effect.gen(function*() {
      const first = yield* Browser.newPage()
      const tools = yield* BrowserToolkit.make({
        context: first.context,
        secrets: { token: Redacted.make("abc") },
        capture: CapturePolicy.local
      })
      const call = (name: BrowserToolkit.ToolName, params: Record<string, unknown>) =>
        Effect.flatMap(tools.handle(name, params as never), Stream.runLast).pipe(
          Effect.map((last) => Option.getOrThrow(last).result as any)
        )
      // A URL's percent-escapes are its own, not secrets
      const opened = yield* call("newPage", { name: "shop", url: "https://example.test/caf%C3%A9" })
      assert.deepStrictEqual(opened.outcome, { page: "shop", url: "https://example.test/caf%C3%A9" })
      // A mistyped name is sent as written too; the result shows the secret's value as its name again
      const url = "https://example.test/caf%C3%A9?token=%token%&typo=%tokn%"
      const went = yield* call("goto", { page: "shop", url })
      assert.deepStrictEqual(went.outcome, { url })
      const shop = (yield* first.context.pages).find((page) => page.id !== first.id)!
      assert.strictEqual(yield* shop.url, "https://example.test/caf%C3%A9?token=abc&typo=%tokn%")
    })).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("tells of each page it comes to know that no tool opened: one listed in the context, and each popup", () =>
    Effect.scoped(Effect.gen(function*() {
      const first = yield* Browser.newPage()
      const seen: Array<ToolkitImpl.Seen> = []
      const session = yield* ToolkitImpl.makeSession({
        context: first.context,
        secrets: {},
        capture: CapturePolicy.local,
        seen: (each) => void seen.push(each)
      })
      // What it told, once it has told `count`: a popup is told as its opener's events are drained
      const told = Effect.fnUntraced(function*(count: number) {
        for (let turn = 0; turn < 100 && seen.length < count; turn++) yield* Effect.yieldNow
        return seen.map((each) =>
          each._tag === "Listed" ? [each._tag, each.name, each.index] : [each._tag, each.name, each.openerName]
        )
      })
      // The page opened before the toolkit is found among the context's pages, at its place there
      assert.deepStrictEqual(yield* told(1), [["Listed", "p1", 0]])
      assert.strictEqual(seen[0]!.page, first)
      // The timeline's popups, the second after its opener is renamed
      yield* TestClock.adjust("10 millis")
      assert.deepStrictEqual((yield* told(2))[1], ["Popup", "p2", "p1"])
      assert.strictEqual(Option.getOrThrow(session.named("p2")), seen[1]!.page)
      yield* session.rename("p1", "shop")
      yield* TestClock.adjust("10 millis")
      assert.deepStrictEqual((yield* told(3))[2], ["Popup", "p3", "shop"])
    })).pipe(Effect.provide(Browser.layerTest("-popup-popup"))))
})

describe("strider", () => {
  it("reads the session and the command without parsing the rest", () => {
    assert.deepStrictEqual(CliSession.scan(["-s", "shop", "-p", "home", "click", "e1"]), {
      session: "shop",
      command: "click"
    })
    assert.deepStrictEqual(CliSession.scan(["--session=shop", "--json", "pages"]), {
      session: "shop",
      command: "pages"
    })
    assert.deepStrictEqual(CliSession.scan(["start", "--name", "x"]), { session: undefined, command: "start" })
    assert.isTrue(CliSession.nameRule.test("checkout-2"))
    assert.isFalse(CliSession.nameRule.test("Checkout"))
  })

  it("exports a target as the locator it means", () => {
    assert.strictEqual(
      ExportTest.locatorOf("shop", `role=button[name="Pay"]`, undefined),
      `shop.getByRole("button", { name: "Pay", exact: true })`
    )
    assert.strictEqual(ExportTest.locatorOf("shop", `text="Add"`, undefined), `shop.getByText("Add", { exact: true })`)
    assert.strictEqual(ExportTest.locatorOf("shop", "label=Email", undefined), `shop.getByLabel("Email")`)
    assert.strictEqual(ExportTest.locatorOf("shop", "testid=cart", undefined), `shop.getByTestId("cart")`)
    assert.strictEqual(ExportTest.locatorOf("shop", "css=#out", undefined), `shop.locator("#out")`)
  })
})
