/**
 * The Vitest adapter: a browser layer for `@effect/vitest`, with `TestRun` for the test that's running.
 *
 * Browser sharing is preserved with optional failure tracing per bound callback. The peer dependency is `vitest` 5.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Browser from "@usestrider/browser/Browser"
import type * as FilePath from "@usestrider/browser/FilePath"
import { TestRun } from "@usestrider/browser/test"
import * as Trace from "@usestrider/browser/Trace"
import type * as UserContext from "@usestrider/browser/UserContext"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { recordArtifact, type TestContext, TestRunner } from "vitest"

declare module "vitest" {
  interface TestArtifactRegistry {
    "@usestrider/browser": {
      readonly type: "@usestrider/browser"
      readonly artifact: ArtifactKind
      readonly attachments: Array<{ readonly path: string; readonly contentType: string }>
    }
  }
}

type RunnerTest = NonNullable<ReturnType<typeof TestRunner.getCurrentTest>>

/** The test's path: its file, then each suite, then the test. */
const pathOf = (test: RunnerTest): string => {
  const names: Array<string> = [test.name]
  for (let suite = test.suite; suite !== undefined; suite = suite.suite) {
    if (suite.name !== "") names.unshift(suite.name)
  }
  return [test.file.name, ...names].join(" > ")
}

const env = (name: string): string =>
  (globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }).process?.env?.[name] ??
    ""

const infoOf = (test: RunnerTest | undefined): TestRun.TestInfo =>
  new TestRun.TestInfo({
    project: test?.file.projectName ?? "",
    file: test?.file.filepath ?? "",
    id: test === undefined ? "" : pathOf(test),
    attempt: test?.result?.retryCount ?? 0,
    repeat: test?.result?.repeatCount ?? 0,
    worker: env("VITEST_POOL_ID"),
    shard: env("VITEST_SHARD")
  })

/** What reporters see an attachment as. */
type ArtifactKind = "Trace" | "Har" | "Screenshot"

const kindOf = (artifact: TestRun.TestArtifact): readonly [ArtifactKind, string] =>
  "trace" in artifact
    ? ["Trace", artifact.trace]
    : "har" in artifact
    ? ["Har", artifact.har]
    : ["Screenshot", artifact.screenshot]

const contentType: Record<ArtifactKind, string> = {
  Trace: "application/zip",
  Har: "application/json",
  Screenshot: "image/png"
}

/** `TestRun` for Vitest: the current test, read each time, and its artifacts. */
const makeTestRun = (current: () => RunnerTest | undefined, snapshot?: TestRun.TestInfo): TestRun.TestRun => ({
  get info() {
    return snapshot ?? infoOf(current())
  },
  attach: (artifact) =>
    Effect.suspend(() => {
      const [kind, path] = kindOf(artifact)
      const test = current()
      if (test === undefined) {
        return Effect.logWarning(`TestRun.attach: no test is running, so ${path} wasn't attached`)
      }
      const type = kind === "Screenshot" && /\.jpe?g$/i.test(path) ? "image/jpeg" : contentType[kind]
      return Effect.tryPromise(() =>
        recordArtifact(test, {
          type: "@usestrider/browser",
          artifact: kind,
          attachments: [{ path, contentType: type }]
        })
      ).pipe(
        Effect.asVoid,
        Effect.catch((error) => Effect.logWarning(`TestRun.attach: Vitest didn't attach ${path}: ${error.message}`))
      )
    })
})

const testRun = makeTestRun(() => TestRunner.getCurrentTest())

/**
 * Failure trace settings for contexts created by a bound test callback.
 *
 * **Details**
 *
 * Screenshots default to `"perAction"`, DOM snapshots and network to `true`, and screencast to `"off"`.
 * Disabling network requires explicitly disabling DOM snapshots too.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TraceOptions =
  & {
    /** Screenshots after actions and expectations. @default "perAction" */
    readonly screenshots?: Trace.CaptureOptions["screenshots"]
    /** Frames rendered by the browser, or polled screenshots. @default "off" */
    readonly screencast?: Trace.CaptureOptions["screencast"]
    /** Directory for failed attempts; created recursively when an archive is exported. */
    readonly directory: string
  }
  & (
    | {
      /** DOM snapshots rendered with recorded network resources. @default true */
      readonly domSnapshots?: true | undefined
      /** Requests and response bodies. @default true */
      readonly network?: true | undefined
    }
    | {
      /** Disables DOM snapshots, allowing network capture to be disabled too. */
      readonly domSnapshots: false
      /** Requests and response bodies. @default true */
      readonly network?: boolean | undefined
    }
  )

interface RecordingEntry {
  readonly recording: Trace.Recording
  readonly finish: (failed: boolean) => Effect.Effect<void>
}

class CallbackRecordings extends Context.Service<CallbackRecordings, {
  readonly add: (target: UserContext.UserContext, options: TraceOptions) => Effect.Effect<void, never, Scope.Scope>
}>()("@usestrider/vitest/CallbackRecordings") {}

const warn = (effect: Effect.Effect<unknown, unknown>): Effect.Effect<void> =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logWarning("VitestBrowser: failure tracing failed", cause))
  )

/**
 * Binds an effect's test identity and attachments to this Vitest callback.
 *
 * **Details**
 *
 * Call inside every test callback, including each retry and repeat. Captures identity, retry attempt, and repeat
 * immediately; attachments use the captured task. Works with a browser layer shared by a block, without rebuilding the browser, and
 * with a per-effect browser layer in either composition order. Complete attachments before the callback ends;
 * Vitest does not guarantee that artifacts attached later reach reporters.
 *
 * **Example** (Binding a callback over a shared browser)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { layer } from "@effect/vitest"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { TestRun } from "@usestrider/browser/test"
 * import { VitestBrowser } from "@usestrider/vitest"
 * import { Effect, Layer } from "effect"
 *
 * layer(VitestBrowser.layer(
 *   Chromium.layer({ executablePath: "/usr/bin/chromium" }).pipe(
 *     Layer.provide(NodeServices.layer)
 *   )
 * ))(
 *   "browser",
 *   (it) => {
 *     it.effect("identity", (context) =>
 *       Effect.gen(function*() {
 *         const run = yield* TestRun.TestRun
 *         yield* Effect.log(run.info.id)
 *       }).pipe(VitestBrowser.withTest(context)))
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category context
 * @since 0.1.0
 */
export const withTest = (
  context: Pick<TestContext, "task">
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, TestRun.TestRun>> => {
  const task = context.task
  const run = makeTestRun(() => task, infoOf(task))
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, TestRun.TestRun>> =>
    Effect.suspend(() => {
      const entries: Array<RecordingEntry> = []
      let active = true
      const recordings = {
        add: Effect.fnUntraced(function*(target: UserContext.UserContext, options: TraceOptions) {
          if (!active) return
          const capture = {
            screenshots: options.screenshots ?? "perAction",
            screencast: options.screencast ?? "off"
          } as const
          const settings: Trace.Options = options.domSnapshots === false
            ? { ...capture, domSnapshots: false, network: options.network ?? true }
            : { ...capture, domSnapshots: true, network: options.network ?? true }
          const recording = yield* Trace.record(target, settings).pipe(Effect.exit)
          if (Exit.isFailure(recording)) {
            if (Cause.hasInterrupts(recording.cause)) return yield* Effect.interrupt
            yield* Effect.logWarning("VitestBrowser: could not start failure tracing", recording.cause)
            return
          }
          if (!active) {
            yield* warn(recording.value.remove)
            return
          }
          const index = entries.length + 1
          const destination = resolve(options.directory, `context-${index}`, traceFileName(run.info))
          let exported = false
          let staged: FilePath.Local | undefined
          const exportFailure = Effect.suspend(() => {
            if (exported) return Effect.void
            exported = true
            return warn(Effect.gen(function*() {
              const path = yield* recording.value.exportTrace(destination)
              staged = path
            }))
          })
          const finish = Effect.fnUntraced(function*(failed: boolean) {
            if (failed) yield* exportFailure
            if (failed) {
              if (staged !== undefined) yield* warn(run.attach({ trace: staged }))
            } else if (exported) {
              // A failed write can leave a partial archive, too.
              const path = staged ?? destination
              yield* warn(Effect.tryPromise(() => rm(path, { force: true })))
            }
          })
          entries.push({ recording: recording.value, finish })
          // Registered after Trace.record: export while both recording and target are still alive.
          yield* Effect.addFinalizer((exit) => active && Exit.isFailure(exit) ? exportFailure : Effect.void)
        })
      }
      return effect.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function*() {
            active = false
            yield* Effect.forEach(entries, (entry) => entry.finish(Exit.isFailure(exit)), { discard: true })
            yield* Effect.forEach(entries, (entry) => warn(entry.recording.remove), { discard: true })
          })
        ),
        Effect.provideService(CallbackRecordings, recordings)
      )
    }).pipe(Effect.provideService(TestRun.TestRun, run))
}

/**
 * Provides a shared backend and `TestRun`, with optional failure traces for bound callbacks.
 *
 * **Details**
 *
 * Set `trace: { directory }` once to record contexts created through this layer's `Browser.newContext` and
 * `Browser.newPage`, including their pages and popups. Each callback must use `withTest(context)` around its
 * complete test effect. No recordings start without that binding. Existing, default, and reclaimed contexts are
 * outside automatic recording; use `Trace.record` explicitly for those.
 *
 * A failed effect, defect, or interruption exports one ZIP per context and attaches it before the binding
 * returns. Paths are `directory/context-N/traceFileName(info)`, numbered within each callback. Successful
 * callbacks retain no archives. A failing nested scope stages its archive before target cleanup; if the callback
 * recovers, the staged file is deleted. A target scope that succeeds before a later callback failure has already
 * closed, so its retained recording is exported after cleanup. Put `withTest` inside the scope that owns the
 * targets to export before that scope closes. Recording, export, attachment, and deletion failures log warnings
 * and preserve the test result. Abrupt process termination and failures outside the bound effect cannot be traced.
 *
 * Automatic tracing is off unless `trace` is supplied.
 *
 * Without `withTest(context)`, identity and attachments use Vitest’s global current-test lookup. This supports
 * sequential tests only: concurrent callbacks can read another test or attach to it. Bind each callback with
 * `withTest(context)` for concurrent tests or retained identity across retries.
 *
 * When built inside a bound effect, the layer retains that TestRun service. Each build resolves its own
 * binding while the backend keeps its usual layer memoization.
 *
 * The browser starts where the layer is built: given to `@effect/vitest`'s `layer`, once for the block, whose tests
 * share it; provided to one effect, as below, once for that effect.
 *
 * Vitest's default `testTimeout` is five seconds for the whole test, shorter than Strider's thirty-second budget
 * per operation, so a slow step can end with Vitest's generic timeout before Strider reports its failure.
 * Raise `testTimeout` in your Vitest config to allow time for all the test's operations:
 *
 * **Example** (Recording only failed attempts)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { VitestBrowser } from "@usestrider/vitest"
 * import { Layer } from "effect"
 *
 * const BrowserLive = VitestBrowser.layer(
 *   Chromium.layer({ executablePath: "/usr/bin/chromium" }).pipe(
 *     Layer.provide(NodeServices.layer)
 *   ),
 *   { trace: { directory: ".data/traces" } }
 * )
 * ```
 *
 * **Example** (Allowing time for browser operations)
 *
 * ```ts import.meta.vitest
 * import { defineConfig } from "vitest/config"
 *
 * export default defineConfig({
 *   test: { testTimeout: 60_000 }
 * })
 * ```
 *
 * **Example** (Providing a browser to a test)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { VitestBrowser } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const test = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage({ focus: "emulated" })
 *   yield* page.goto("https://shop.example.com")
 * })).pipe(
 *   Effect.provide(
 *     VitestBrowser.layer(Chromium.layer({ executablePath: "/usr/bin/chromium" }))
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = <E, R>(
  backend: Layer.Layer<Browser.Browser, E, R>,
  options?: {
    /** Failure recording for contexts created by bound callbacks. @default undefined */
    readonly trace?: TraceOptions | undefined
  } | undefined
): Layer.Layer<Browser.Browser | TestRun.TestRun, E, R> =>
  // Resolve TestRun on every build: memoize the backend, never a callback's binding.
  Layer.fromBuild((memoMap, scope) =>
    Effect.gen(function*() {
      const existing = yield* Effect.serviceOption(TestRun.TestRun)
      const services = yield* Layer.buildWithMemoMap(backend, memoMap, scope)
      const configured = options?.trace
      if (configured !== undefined) {
        const browser = Context.get(services, Browser.Browser)
        const enroll = Effect.fnUntraced(function*(target: UserContext.UserContext) {
          const callback = yield* Effect.serviceOption(CallbackRecordings)
          if (Option.isSome(callback)) yield* callback.value.add(target, configured)
        })
        const wrapped: Browser.Browser = Object.assign(Object.create(browser), {
          newContext: (settings?: UserContext.Options) => browser.newContext(settings).pipe(Effect.tap(enroll)),
          newPage: (settings?: UserContext.Options) =>
            browser.newPage(settings).pipe(Effect.tap((page) => enroll(page.context)))
        })
        return Context.add(
          Context.add(services, Browser.Browser, wrapped),
          TestRun.TestRun,
          Option.getOrElse(existing, () => testRun)
        )
      }
      return Context.add(services, TestRun.TestRun, Option.getOrElse(existing, () => testRun))
    })
  )

/**
 * Builds a deterministic trace ZIP filename from a captured test identity.
 *
 * **Details**
 *
 * The basename contains only ASCII letters, digits, hyphens, and underscores, followed by `.zip`. A readable
 * prefix is capped at 48 characters; a full SHA-256 digest of project, file, test ID, attempt, and repeat distinguishes
 * identities whose prefixes match. Repeat zero keeps the original four-field digest and filename; later repeats
 * add a repeat suffix and include the repeat in the digest. Workers and shards do not change the name. Exports
 * for the same identity use the same name, so choose another directory to keep separate runs or recordings.
 * Capture `TestRun.info` beside `Trace.record`, before another test, retry, or repeat starts. No file is written or attached.
 *
 * **Example** (Exporting a trace named for its test)
 *
 * ```ts import.meta.vitest
 * import { Page, Trace } from "@usestrider/browser"
 * import { TestRun } from "@usestrider/browser/test"
 * import { VitestBrowser } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const record = Effect.fn("record")(function*(page: Page.Page) {
 *   const { info } = yield* TestRun.TestRun
 *   const name = VitestBrowser.traceFileName(info)
 *   const trace = yield* Trace.record(page)
 *   yield* page.getByRole("button", { name: "Pay" }).click()
 *   yield* trace.exportTrace(`traces/${name}`)
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const traceFileName = (info: TestRun.TestInfo): string => {
  const repeat = info.repeat ?? 0
  const fields: Array<string | number> = [info.project, info.file, info.id, info.attempt]
  if (repeat !== 0) fields.push(repeat)
  const identity = JSON.stringify(fields)
  const digest = createHash("sha256").update(identity).digest("hex")
  const prefix = info.id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+/, "").slice(0, 48) || "test"
  const repetition = repeat === 0 ? "" : `-repeat-${String(repeat).replace(/[^a-zA-Z0-9_-]/g, "-")}`
  return `${prefix}${repetition}-retry-${String(info.attempt).replace(/[^a-zA-Z0-9_-]/g, "-")}-${digest}.zip`
}
