/**
 * A port file: one upstream test file, whose tests run on each selected browser, named and found by their upstream
 * keys. The port's path names its original: `ports/playwright/page/page-click.test.ts` ports
 * `tests/page/page-click.spec.ts`, and `ports/puppeteer/oopif.test.ts` ports `test/src/oopif.test.ts`.
 *
 * ```ts
 * upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
 *   test("OO-001", ({ page, server }) =>
 *     Effect.gen(function*() {
 *       yield* page.goto(server.PREFIX + "/dynamic-oopif.html")
 *       // …
 *     }))
 * })
 * ```
 *
 * Each browser gets one launch for the file, through `@usestrider/vitest` as a user's suite would, and each test a
 * fresh context and 1280×720 page, Playwright's default. A failed test leaves its trace in
 * `.data/compat/traces/<run>/<browser>/`.
 */
import { layer } from "@effect/vitest"
import { Browser, Deadline, type Page } from "@usestrider/browser"
import { VitestBrowser } from "@usestrider/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as path from "node:path"
import { describe, it } from "vitest"
import { outputDirectory, upstreamFileOf } from "../../src/ledger.ts"
import { readIndex } from "../../src/upstream.ts"
import { backend, type BrowserName, checkPinned, type Launch, selected } from "./browsers.ts"
import { layer as serverLayer, Server, type ServerShape } from "./server.ts"

declare module "vitest" {
  interface TaskMeta {
    compat?: {
      readonly source: string
      readonly key: string
      readonly variant?: string
      readonly browser: BrowserName
      readonly file: string
    }
  }
}

export interface Fixtures {
  /** A fresh page in a fresh context, 1280×720; absent when the test asked for `page: false`. */
  readonly page: Page.Page
  readonly server: ServerShape
  readonly browserName: BrowserName
}

export type Body = (fixtures: Fixtures) => Effect.Effect<void, unknown, Scope.Scope | Browser.Browser | Server>

export interface TestOptions {
  /** One expansion of an upstream test whose title is computed, as in a loop: `test("FI-003", { variant: "color" }, …)`. */
  readonly variant?: string | undefined
  /** Open no page: the test makes its own contexts. @default true */
  readonly page?: boolean | undefined
  /**
   * The browsers this one test runs on, within the file's: a test the original runs on one browser only (`it.skip`
   * for the others) says `["webkit"]`. Its ledger file marks the others, so the report doesn't count them as not run.
   * @default the file's browsers
   */
  readonly browsers?: ReadonlyArray<BrowserName> | undefined
}

export interface Test {
  (key: string, body: Body): void
  (key: string, options: TestOptions, body: Body): void
}

export interface Options {
  /** The browsers the original runs on: a Chromium-only file says `["chromium"]`. @default every browser */
  readonly browsers?: ReadonlyArray<BrowserName> | undefined
  /** Launch settings beyond the defaults: Playwright's `it.use({ launchOptions })`. */
  readonly launch?: Launch | undefined
}

/** Playwright's test timeout: a test's whole body, its page included, runs within it. */
const budget = "30 seconds"

/**
 * `Deadline.within` bounds Strider's operations only. A wait of the port's own, such as one on the fixture server,
 * isn't one, so the body also ends a second after the budget, which lets an operation's own `Timeout` come first.
 */
const outsideOperations = "31 seconds"

export const upstream = (portFile: string, options: Options, define: (test: Test) => void) => {
  const { source, file } = upstreamFileOf(portFile)
  const tests = new Map(readIndex(source).tests.filter((test) => test.file === file).map((test) => [test.key, test]))
  if (tests.size === 0) throw new Error(`${source}'s index has no tests in ${file}`)
  const run = process.env["STRIDER_COMPAT_RUN"] ?? "latest"
  const fileBrowsers = selected.filter((name) => options.browsers === undefined || options.browsers.includes(name))
  // A browser none of the file's tests runs on gets no suite: Vitest fails a suite with no tests in it
  const runsOn = new Set<BrowserName>()
  define(
    ((_key: string, second: TestOptions | Body, third?: Body) => {
      const testOptions = third === undefined ? {} : second as TestOptions
      for (const name of fileBrowsers) {
        if (testOptions.browsers === undefined || testOptions.browsers.includes(name)) runsOn.add(name)
      }
    }) as Test
  )
  const browsers = fileBrowsers.filter((name) => runsOn.has(name))

  // A file none of whose tests runs on the selected browsers is one skipped placeholder, which the report ignores:
  // Vitest fails a file, or a suite, with no tests in it
  if (browsers.length === 0) {
    it.skip(`${source} ${file}: no test runs on ${selected.join(", ")}`, () => {})
    return
  }
  describe(`${source} ${file}`, () => {
    for (const browserName of browsers) {
      const services = Layer.mergeAll(
        VitestBrowser.layer(backend(browserName, options.launch), {
          trace: { directory: path.join(outputDirectory(), "traces", run, browserName) }
        }),
        serverLayer(source)
      )
      describe(browserName, () => {
        layer(services, { excludeTestServices: true, timeout: 120_000 })((it) => {
          const test: Test = (key: string, second: TestOptions | Body, third?: Body) => {
            const [testOptions, body] = third === undefined ? [{}, second as Body] : [second as TestOptions, third]
            const fullKey = source === "puppeteer" ? `[${path.basename(file).replace(/\.ts$/, "")}] ${key}` : key
            const original = tests.get(fullKey)
            if (original === undefined) throw new Error(`${fullKey} isn't a test of ${file}`)
            if (testOptions.browsers !== undefined && !testOptions.browsers.includes(browserName)) return
            const name = (source === "puppeteer" ? fullKey : `${fullKey} ${original.title}`) +
              (testOptions.variant === undefined ? "" : ` [${testOptions.variant}]`)
            it.effect(name, (context) => {
              context.task.meta.compat = {
                source,
                key: fullKey,
                ...(testOptions.variant === undefined ? {} : { variant: testOptions.variant }),
                browser: browserName,
                file
              }
              return Effect.gen(function*() {
                checkPinned(browserName, (yield* Browser.Browser).info)
                const server = yield* Server
                yield* server.reset
                const page = testOptions.page === false
                  ? undefined
                  : yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
                yield* body({
                  get page() {
                    if (page === undefined) throw new Error(`${fullKey} asked for no page`)
                    return page
                  },
                  server,
                  browserName
                })
              }).pipe(
                Deadline.within(budget),
                Effect.timeoutOrElse({
                  duration: outsideOperations,
                  orElse: () =>
                    Effect.die(
                      new Error(
                        `${fullKey} ran past its ${budget} in a wait that isn't a Strider operation (one of the port's own, such as a fixture server request, or an operation's release)`
                      )
                    )
                }),
                VitestBrowser.withTest(context)
              )
            }, 60_000)
          }
          define(test)
        })
      })
    }
  })
}
