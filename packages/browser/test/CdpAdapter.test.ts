/** Deterministic CDP event ordering regressions, without launching a browser. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Capability, Deadline, NetworkRequest, Reason, VideoWriter } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scheduler from "effect/Scheduler"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { TestClock } from "effect/testing"
import * as Tracer from "effect/Tracer"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as CdpAdapter from "../src/internal/cdpAdapter.ts"
import * as Cleanup from "../src/internal/declarationCleanup.ts"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import * as Har from "../src/internal/har.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Readable from "../src/internal/readable.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import captured from "./fixtures/redirect-extra-info.ts"
import { makeBrowser, type Sent } from "./utils/FakeBrowser.ts"

// Share one dispatcher across the protocol fibers so a checkpoint drains all runnable work,
// stopping only at an actual protocol reply or permit wait, without counting scheduler turns.
const withProtocolScheduler = Effect.fnUntraced(function*<A, E, R>(
  run: (drain: Effect.Effect<void>) => Effect.Effect<A, E, R>
) {
  const parent = yield* Scheduler.Scheduler
  const dispatcher = parent.makeDispatcher()
  const checkpoint = parent.makeDispatcher()
  const drain = Effect.callback<void>((resume) => {
    checkpoint.scheduleTask(() => {
      dispatcher.flush()
      resume(Effect.void)
    }, 0)
  })
  return yield* run(drain).pipe(
    Effect.forkChild,
    Effect.flatMap(Fiber.join),
    Effect.provideService(Scheduler.Scheduler, {
      executionMode: parent.executionMode,
      shouldYield: (fiber) => parent.shouldYield(fiber),
      makeDispatcher: () => dispatcher
    })
  )
})

describe("CDP paused page initialization", () => {
  for (const rejected of [false, true]) {
    it.effect(`writes declarations before resume and handles the first request before renderer replies${rejected ? " when a declaration fails" : ""}`, () =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const ready = yield* Deferred.make<void>()
        const paused = yield* Deferred.make<void>()
        const facts: Array<Adapter.Fact> = []
        const commands: Array<Sent> = []
        const held: Array<Sent> = []
        let resumed = false
        const reply = (command: Sent) =>
          browser.receive({
            id: command.id,
            sessionId: command.sessionId,
            ...(rejected && command.method === "Page.addScriptToEvaluateOnNewDocument" &&
                command.params?.worldName === "isolated"
              ? { error: { code: -32000, message: "script installation rejected" } }
              : {
                result: command.method === "Browser.getVersion"
                  ? {
                    protocolVersion: "1.3",
                    product: "Chrome/155.0.8059.79",
                    revision: "test",
                    userAgent: "HeadlessChrome",
                    jsVersion: "test"
                  }
                  : command.method === "Target.getBrowserContexts" ?
                  { browserContextIds: [] }
                  : command.method === "Page.getFrameTree" ?
                  {
                    frameTree: {
                      frame: {
                        id: "T1",
                        loaderId: "initial",
                        url: "about:blank",
                        securityOrigin: "://",
                        mimeType: "text/html"
                      }
                    }
                  }
                  : command.method === "Page.addScriptToEvaluateOnNewDocument" ?
                  { identifier: `script-${command.id}` }
                  : command.method === "Page.getLayoutMetrics"
                  ? metrics
                  : {}
              })
          })
        yield* Effect.gen(function*() {
          while (true) {
            const command = yield* browser.next
            commands.push(command)
            if (!resumed && command.sessionId === "S1" && command.method !== "Runtime.runIfWaitingForDebugger") {
              held.push(command)
              continue
            }
            if (command.method === "Runtime.runIfWaitingForDebugger") {
              yield* browser.receive({
                sessionId: "S1",
                method: "Fetch.requestPaused",
                params: {
                  requestId: "fetch-1",
                  frameId: "T1",
                  resourceType: "Document",
                  request: {
                    url: "https://target.test/",
                    method: "GET",
                    headers: {},
                    initialPriority: "High",
                    referrerPolicy: "strict-origin-when-cross-origin"
                  }
                }
              })
              // The browser cannot create the renderer to answer these commands until its route can run.
              yield* Deferred.await(paused)
              resumed = true
              for (const pending of held.splice(0).reverse()) yield* reply(pending)
            }
            yield* reply(command)
          }
        }).pipe(Effect.forkScoped)
        const adapter = yield* CdpAdapter.connect(browser.transport, {
          ownership: "launched",
          sink: Effect.fnUntraced(function*(fact) {
            facts.push(fact)
            if (fact._tag === "ObligationOpened") yield* Deferred.succeed(paused, undefined)
            if (fact._tag === "PageReady" || fact._tag === "PageInitializationFailed") {
              yield* Deferred.succeed(ready, undefined)
            }
          })
        })
        const context = { _tag: "UserContext", context: adapter.defaultContext } as const
        const scripts = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scripts, Exit.void))
        for (const world of [{ _tag: "Main" }, { _tag: "Isolated", name: "isolated" }] as const) {
          yield* adapter.declare(context, {
            _tag: "InitScript",
            source: "self.initialized = true",
            world,
            phase: "user",
            workers: false,
            timing: "beforeAuthorScript",
            after: []
          }).pipe(Scope.provide(scripts))
        }
        yield* adapter.declare(context, {
          _tag: "Intercept",
          patterns: ["https://target.test/**"],
          phases: ["request"]
        })
        yield* adapter.declare(context, { _tag: "Override", override: { _tag: "Locale", locale: "fr-FR" } })
        yield* adapter.declare(context, {
          _tag: "Override",
          override: {
            _tag: "Viewport",
            width: 400,
            height: 300,
            deviceScaleFactor: 1,
            mobile: false
          }
        })
        yield* browser.receive({
          method: "Target.attachedToTarget",
          params: {
            sessionId: "S1",
            targetInfo: { targetId: "T1", type: "page", title: "", url: "", attached: true },
            waitingForDebugger: true
          }
        })
        yield* Deferred.await(ready)
        const sent = commands.filter((command) => command.sessionId === "S1").map((command) => command.method)
        assert.strictEqual(sent.at(-1), "Runtime.runIfWaitingForDebugger")
        assert.strictEqual(sent.filter((method) => method === "Runtime.runIfWaitingForDebugger").length, 1)
        for (
          const method of [
            "Page.addScriptToEvaluateOnNewDocument",
            "Fetch.enable",
            "Emulation.setLocaleOverride",
            "Emulation.setUserAgentOverride",
            "Emulation.setDeviceMetricsOverride"
          ]
        ) {
          assert.include(sent, method)
        }
        assert.isBelow(sent.indexOf("Page.getFrameTree"), sent.indexOf("Runtime.enable"))
        assert.isBelow(sent.indexOf("Page.getLayoutMetrics"), sent.indexOf("Emulation.setDeviceMetricsOverride"))
        assert.include(facts.map((fact) => fact._tag), rejected ? "PageInitializationFailed" : "PageReady")
        const firstScript = commands.find((command) => command.method === "Page.addScriptToEvaluateOnNewDocument")!
        yield* Scope.close(scripts, Exit.void).pipe(Effect.provideService(Cleanup.Confirm, true))
        assert.isTrue(commands.some((command) =>
          command.method === "Page.removeScriptToEvaluateOnNewDocument" &&
          command.params?.identifier === `script-${firstScript.id}`
        ))
        // Tear down the connection before declarations release, so no renderer replies are needed by cleanup.
        yield* browser.lose("test complete")
      }).pipe(Effect.scoped))
  }
})

describe("CDP combined locale and user-agent declarations", () => {
  for (const order of ["Locale first", "UserAgent first"] as const) {
    for (const timing of ["existing target", "new targets"] as const) {
      it.effect(`preserves both fields across precedence, replacement and release (${order}, ${timing})`, () =>
        Effect.gen(function*() {
          const browser = yield* makeBrowser
          const ready = yield* Queue.unbounded<Extract<Adapter.Fact, { _tag: "PageReady" }>>()
          const commands: Array<Sent> = []
          yield* Effect.gen(function*() {
            while (true) {
              const command = yield* browser.next
              commands.push(command)
              const result = command.method === "Browser.getVersion"
                ? {
                  protocolVersion: "1.3",
                  product: "Chrome/155.0.8059.79",
                  revision: "test",
                  userAgent: "HeadlessChrome",
                  jsVersion: "test"
                }
                : command.method === "Target.getBrowserContexts"
                ? { browserContextIds: [] }
                : command.method === "Page.getFrameTree"
                ? {
                  frameTree: {
                    frame: {
                      id: command.sessionId!.replace("S", "T"),
                      loaderId: "initial",
                      url: "about:blank",
                      securityOrigin: "://",
                      mimeType: "text/html"
                    }
                  }
                }
                : {}
              yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
            }
          }).pipe(Effect.forkScoped)
          const adapter = yield* CdpAdapter.connect(browser.transport, {
            ownership: "attached",
            sink: (fact) => fact._tag === "PageReady" ? Queue.offer(ready, fact).pipe(Effect.asVoid) : Effect.void
          })
          let target = 0
          const attach = Effect.gen(function*() {
            const id = ++target
            yield* browser.receive({
              method: "Target.attachedToTarget",
              params: {
                sessionId: `S${id}`,
                targetInfo: { targetId: `T${id}`, type: "page", title: "", url: "about:blank", attached: true },
                waitingForDebugger: false
              }
            })
            return (yield* Queue.take(ready)).page
          })
          const page = timing === "existing target" ? yield* attach : undefined
          const observed: Array<object> = []
          const expected: Array<object> = []
          const snapshot = Effect.fnUntraced(
            function*(step: string, userAgent: string, locale?: string, platform?: string) {
              if (timing === "new targets") yield* attach
              const sessionId = timing === "new targets" ? `S${target}` : "S1"
              observed.push({
                step,
                params: commands.filter((command) =>
                  command.sessionId === sessionId && command.method === "Emulation.setUserAgentOverride"
                ).at(-1)?.params
              })
              expected.push({
                step,
                params: {
                  userAgent,
                  ...(locale === undefined ? {} : { acceptLanguage: locale }),
                  ...(platform === undefined ? {} : { platform })
                }
              })
            }
          )
          const install = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, override: Adapter.Override) {
            const lifetime = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(lifetime, Exit.void))
            yield* adapter.declare(scope, { _tag: "Override", override }).pipe(Scope.provide(lifetime))
            return Scope.close(lifetime, Exit.void).pipe(Effect.provideService(Cleanup.Confirm, true))
          })
          const locale = (value: string): Adapter.Override => ({ _tag: "Locale", locale: value })
          const ua = (value: string): Adapter.Override => ({
            _tag: "UserAgent",
            userAgent: `${value} UA`,
            platform: Option.some(`${value} platform`)
          })
          const browserScope: Adapter.DeclarationScope = { _tag: "Browser" }
          const contextScope: Adapter.DeclarationScope = { _tag: "UserContext", context: adapter.defaultContext }
          const first = order === "Locale first" ? locale("en-GB") : ua("Browser")
          const second = order === "Locale first" ? ua("Browser") : locale("en-GB")
          const releaseFirst = yield* install(browserScope, first)
          yield* snapshot(
            "first kind",
            order === "Locale first" ? "HeadlessChrome" : "Browser UA",
            order === "Locale first" ? "en-GB" : undefined,
            order === "Locale first" ? undefined : "Browser platform"
          )
          const releaseSecond = yield* install(browserScope, second)
          yield* snapshot("both browser kinds", "Browser UA", "en-GB", "Browser platform")
          const releaseContextLocale = yield* install(contextScope, locale("fr-FR"))
          yield* snapshot("context locale over browser UA", "Browser UA", "fr-FR", "Browser platform")
          const releaseContextUa = yield* install(contextScope, ua("Context"))
          yield* snapshot("both context kinds", "Context UA", "fr-FR", "Context platform")
          // Later browser declarations must not beat the more specific context fields.
          const releaseBrowserLocale = yield* install(browserScope, locale("de-DE"))
          const releaseBrowserUa = yield* install(browserScope, ua("Later browser"))
          yield* snapshot("later browser under context", "Context UA", "fr-FR", "Context platform")
          if (page !== undefined) {
            const pageScope: Adapter.DeclarationScope = { _tag: "Page", page }
            const releasePageLocale = yield* install(pageScope, locale("ja-JP"))
            yield* snapshot("page locale over context UA", "Context UA", "ja-JP", "Context platform")
            const releasePageUa = yield* install(pageScope, ua("Page"))
            yield* snapshot("both page kinds", "Page UA", "ja-JP", "Page platform")
            yield* releasePageLocale
            yield* snapshot("release page locale", "Page UA", "fr-FR", "Page platform")
            yield* releasePageUa
            yield* snapshot("release page UA", "Context UA", "fr-FR", "Context platform")
          }
          const releaseReplacementLocale = yield* install(contextScope, locale("it-IT"))
          yield* snapshot("replace context locale", "Context UA", "it-IT", "Context platform")
          const releaseReplacementUa = yield* install(contextScope, ua("Replacement"))
          yield* snapshot("replace context UA", "Replacement UA", "it-IT", "Replacement platform")
          yield* releaseReplacementLocale
          yield* snapshot("release replacement locale", "Replacement UA", "fr-FR", "Replacement platform")
          yield* releaseReplacementUa
          yield* snapshot("release replacement UA", "Context UA", "fr-FR", "Context platform")
          yield* releaseContextLocale
          yield* snapshot("release context locale", "Context UA", "de-DE", "Context platform")
          yield* releaseContextUa
          yield* snapshot("release context UA", "Later browser UA", "de-DE", "Later browser platform")
          yield* releaseBrowserLocale
          yield* releaseBrowserUa
          yield* snapshot("release browser replacements", "Browser UA", "en-GB", "Browser platform")
          yield* releaseSecond
          yield* snapshot(
            "release second kind",
            order === "Locale first" ? "HeadlessChrome" : "Browser UA",
            order === "Locale first" ? "en-GB" : undefined,
            order === "Locale first" ? undefined : "Browser platform"
          )
          // A fresh target with no declarations needs no command; restoration is checked on the existing target.
          yield* releaseFirst
          if (timing === "existing target") yield* snapshot("release last kind", "HeadlessChrome")
          assert.deepStrictEqual(observed, expected)
        }))
    }
  }
})

describe("CDP complete intermediate locale and user-agent payloads", () => {
  for (const order of ["Locale first", "UserAgent first"] as const) {
    for (const timing of ["existing target", "new targets"] as const) {
      it.effect(`omits a replaced platform and preserves every intermediate payload (${order}, ${timing})`, () =>
        Effect.gen(function*() {
          const browser = yield* makeBrowser
          const ready = yield* Queue.unbounded<Extract<Adapter.Fact, { _tag: "PageReady" }>>()
          const commands: Array<Sent> = []
          yield* Effect.gen(function*() {
            while (true) {
              const command = yield* browser.next
              commands.push(command)
              const result = command.method === "Browser.getVersion"
                ? {
                  protocolVersion: "1.3",
                  product: "Chrome/155.0.8059.79",
                  revision: "test",
                  userAgent: "HeadlessChrome",
                  jsVersion: "test"
                }
                : command.method === "Target.getBrowserContexts"
                ? { browserContextIds: [] }
                : command.method === "Page.getFrameTree"
                ? {
                  frameTree: {
                    frame: {
                      id: command.sessionId!.replace("S", "T"),
                      loaderId: "initial",
                      url: "about:blank",
                      securityOrigin: "://",
                      mimeType: "text/html"
                    }
                  }
                }
                : {}
              yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
            }
          }).pipe(Effect.forkScoped)
          const adapter = yield* CdpAdapter.connect(browser.transport, {
            ownership: "attached",
            sink: (fact) => fact._tag === "PageReady" ? Queue.offer(ready, fact).pipe(Effect.asVoid) : Effect.void
          })
          let target = 0
          const attach = Effect.gen(function*() {
            const id = ++target
            yield* browser.receive({
              method: "Target.attachedToTarget",
              params: {
                sessionId: `S${id}`,
                targetInfo: { targetId: `T${id}`, type: "page", title: "", url: "about:blank", attached: true },
                waitingForDebugger: false
              }
            })
            return (yield* Queue.take(ready)).page
          })
          if (timing === "existing target") yield* attach
          let cursor = 0
          const observed: Array<object> = []
          const expected: Array<object> = []
          const snapshot = Effect.fnUntraced(
            function*(step: string, userAgent: string, locale?: string, platform?: string) {
              if (timing === "new targets") yield* attach
              const sessionId = timing === "new targets" ? `S${target}` : "S1"
              const payloads = commands.slice(cursor).filter((command) =>
                command.sessionId === sessionId && command.method === "Emulation.setUserAgentOverride"
              )
              assert.isAbove(payloads.length, 0)
              cursor = commands.length
              observed.push({ step, params: payloads.map((command) => command.params) })
              expected.push({
                step,
                params: payloads.map(() => ({
                  userAgent,
                  ...(locale === undefined ? {} : { acceptLanguage: locale }),
                  ...(platform === undefined ? {} : { platform })
                }))
              })
            }
          )
          const install = Effect.fnUntraced(function*(scope: Adapter.DeclarationScope, override: Adapter.Override) {
            const lifetime = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(lifetime, Exit.void))
            yield* adapter.declare(scope, { _tag: "Override", override }).pipe(Scope.provide(lifetime))
            return Scope.close(lifetime, Exit.void).pipe(Effect.provideService(Cleanup.Confirm, true))
          })
          const locale = (value: string): Adapter.Override => ({ _tag: "Locale", locale: value })
          const ua = (value: string): Adapter.Override => ({
            _tag: "UserAgent",
            userAgent: `${value} UA`,
            platform: Option.some(`${value} platform`)
          })
          const browserScope: Adapter.DeclarationScope = { _tag: "Browser" }
          const first = order === "Locale first" ? locale("en-GB") : ua("Browser")
          const second = order === "Locale first" ? ua("Browser") : locale("en-GB")
          const releaseFirst = yield* install(browserScope, first)
          yield* snapshot(
            "first kind",
            order === "Locale first" ? "HeadlessChrome" : "Browser UA",
            order === "Locale first" ? "en-GB" : undefined,
            order === "Locale first" ? undefined : "Browser platform"
          )
          const releaseSecond = yield* install(browserScope, second)
          yield* snapshot("both browser kinds", "Browser UA", "en-GB", "Browser platform")
          const releaseReplacement = yield* install(browserScope, {
            _tag: "UserAgent",
            userAgent: "Replacement UA",
            platform: Option.none()
          })
          yield* snapshot("replace without platform", "Replacement UA", "en-GB")
          const releaseLocale = yield* install(browserScope, locale("fr-FR"))
          yield* snapshot("locale with platform absent", "Replacement UA", "fr-FR")
          yield* releaseLocale
          yield* snapshot("release locale replacement", "Replacement UA", "en-GB")
          yield* releaseReplacement
          yield* snapshot("restore platform", "Browser UA", "en-GB", "Browser platform")
          yield* releaseSecond
          yield* snapshot(
            "release second kind",
            order === "Locale first" ? "HeadlessChrome" : "Browser UA",
            order === "Locale first" ? "en-GB" : undefined,
            order === "Locale first" ? undefined : "Browser platform"
          )
          yield* releaseFirst
          assert.deepStrictEqual(observed, expected)
        }))
    }
  }
})

describe("CDP locale declaration release", () => {
  for (const holdLanguageReply of [false, true]) {
    for (const mode of ["reset", "remaining", "replacement"] as const) {
      it.effect(`does not reapply a released locale from an in-flight target configuration (${mode}, ${holdLanguageReply ? "held release language reply" : "overtaking replies"})`, () =>
        withProtocolScheduler((drain) =>
          Effect.gen(function*() {
            const remaining = mode === "reset" ? undefined : "de-DE"
            const browser = yield* makeBrowser
            const heldLocale = yield* Deferred.make<Sent>()
            const resumeReplies = yield* Deferred.make<void>()
            const ready = yield* Deferred.make<void>()
            const commands: Array<Sent> = []
            const reply = (command: Sent, result: object = {}) =>
              browser.receive({ id: command.id, sessionId: command.sessionId, result })
            yield* Effect.gen(function*() {
              while (true) {
                const command = yield* browser.next
                commands.push(command)
                // Hold configuration at its locale command. Holding reset's language reply too
                // reproduces the observed FIFO overlap. With a remaining/replacement locale,
                // its locale reply overtakes this one before its language reply is held.
                if (command.method === "Emulation.setLocaleOverride" && command.params?.locale === "fr-FR") {
                  yield* Deferred.succeed(heldLocale, command)
                  continue
                }
                if (
                  holdLanguageReply && command.method === "Emulation.setUserAgentOverride" &&
                  command.params?.acceptLanguage !== "fr-FR"
                ) {
                  yield* Deferred.await(resumeReplies)
                }
                const result = command.method === "Browser.getVersion"
                  ? {
                    protocolVersion: "1.3",
                    product: "Chrome/155.0.8059.79",
                    revision: "test",
                    userAgent: "HeadlessChrome",
                    jsVersion: "test"
                  }
                  : command.method === "Target.getBrowserContexts"
                  ? { browserContextIds: [] }
                  : command.method === "Page.getFrameTree"
                  ? {
                    frameTree: {
                      frame: {
                        id: "T1",
                        loaderId: "initial",
                        url: "about:blank",
                        securityOrigin: "://",
                        mimeType: "text/html"
                      }
                    }
                  }
                  : {}
                yield* reply(command, result)
              }
            }).pipe(Effect.forkScoped)
            const adapter = yield* CdpAdapter.connect(browser.transport, {
              ownership: "attached",
              sink: (fact) =>
                fact._tag === "PageReady" ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid) : Effect.void
            })
            if (mode === "remaining") {
              yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
                _tag: "Override",
                override: { _tag: "Locale", locale: "de-DE" }
              })
            }
            const declarationScope = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(declarationScope, Exit.void))
            // Installing before attachment makes configureTarget the sole source of fr-FR application.
            yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
              _tag: "Override",
              override: { _tag: "Locale", locale: "fr-FR" }
            }).pipe(Scope.provide(declarationScope))
            yield* browser.receive({
              method: "Target.attachedToTarget",
              params: {
                sessionId: "S1",
                targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
                waitingForDebugger: false
              }
            })
            const held = yield* Deferred.await(heldLocale)
            const replacement = mode === "replacement"
              ? yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
                _tag: "Override",
                override: { _tag: "Locale", locale: "de-DE" }
              }).pipe(Effect.forkScoped)
              : undefined
            // Start release while configuration is awaiting its locale reply. Let runnable fibers drain:
            // the unfixed adapter sends reset-UA here, matching the retained Chromium FIFO overlap.
            const closing = yield* Scope.close(declarationScope, Exit.void).pipe(
              Effect.provideService(Cleanup.Confirm, true),
              Effect.forkChild
            )
            yield* drain
            yield* reply(held)
            yield* Deferred.succeed(resumeReplies, undefined)
            yield* Fiber.join(closing)
            if (replacement !== undefined) yield* Fiber.join(replacement)
            yield* Deferred.await(ready)
            const localeCommands = commands.filter((command) => command.method === "Emulation.setLocaleOverride")
            assert.deepStrictEqual(localeCommands.at(-1)?.params, remaining === undefined ? {} : { locale: remaining })
            const languageCommands = commands.filter((command) => command.method === "Emulation.setUserAgentOverride")
            assert.deepStrictEqual(languageCommands.at(-1)?.params, {
              userAgent: "HeadlessChrome",
              ...(remaining === undefined ? {} : { acceptLanguage: remaining })
            })
            assert.strictEqual(languageCommands.at(-1)?.sessionId, "S1")
          })
        ))
    }
  }
  it.effect("reads current declarations when queued target configuration acquires the permit", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const heldLocale = yield* Deferred.make<Sent>()
        const heldGate = yield* Deferred.make<Sent>()
        const ready = yield* Deferred.make<void>()
        const commands: Array<Sent> = []
        let holdingLocale = true
        const reply = (command: Sent, result: object = {}) =>
          browser.receive({ id: command.id, sessionId: command.sessionId, result })
        yield* Effect.gen(function*() {
          while (true) {
            const command = yield* browser.next
            commands.push(command)
            // Hold installation's first locale reply; any stale configuration command must
            // still receive its reply so the regression reports an assertion, not a deadlock.
            if (
              command.method === "Emulation.setLocaleOverride" && command.params?.locale === "fr-FR" && holdingLocale
            ) {
              holdingLocale = false
              yield* Deferred.succeed(heldLocale, command)
              continue
            }
            if (command.method === "Target.setAutoAttach" && command.sessionId === "S1") {
              yield* Deferred.succeed(heldGate, command)
              continue
            }
            const result = command.method === "Browser.getVersion"
              ? {
                protocolVersion: "1.3",
                product: "Chrome/155.0.8059.79",
                revision: "test",
                userAgent: "HeadlessChrome",
                jsVersion: "test"
              }
              : command.method === "Target.getBrowserContexts"
              ? { browserContextIds: [] }
              : command.method === "Page.getFrameTree"
              ? {
                frameTree: {
                  frame: {
                    id: "T1",
                    loaderId: "initial",
                    url: "about:blank",
                    securityOrigin: "://",
                    mimeType: "text/html"
                  }
                }
              }
              : {}
            yield* reply(command, result)
          }
        }).pipe(Effect.forkScoped)
        const adapter = yield* CdpAdapter.connect(browser.transport, {
          ownership: "attached",
          sink: (fact) =>
            fact._tag === "PageReady" ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid) : Effect.void
        })
        yield* browser.receive({
          method: "Target.attachedToTarget",
          params: {
            sessionId: "S1",
            targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
            waitingForDebugger: false
          }
        })
        // Attachment has registered the target, but its gate has not reached configureTarget yet.
        const gate = yield* Deferred.await(heldGate)
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const installing = yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
          _tag: "Override",
          override: { _tag: "Locale", locale: "fr-FR" }
        }).pipe(Scope.provide(scope), Effect.forkChild)
        const locale = yield* Deferred.await(heldLocale)
        // Installation holds the override permit. Configuration now queues behind it.
        yield* reply(gate)
        yield* drain
        // Remove the declaration before configuration can acquire the permit.
        const closing = yield* Scope.close(scope, Exit.void).pipe(
          Effect.provideService(Cleanup.Confirm, true),
          Effect.forkChild
        )
        yield* drain
        yield* reply(locale)
        yield* Fiber.join(installing)
        yield* Fiber.join(closing)
        yield* Deferred.await(ready)
        // Only installation may write fr-FR; a pre-permit snapshot makes configuration write it again.
        assert.strictEqual(
          commands.filter((command) =>
            command.method === "Emulation.setLocaleOverride" && command.params?.locale === "fr-FR"
          ).length,
          1
        )
        assert.deepStrictEqual(
          commands.filter((command) => command.method === "Emulation.setUserAgentOverride").at(-1)?.params,
          { userAgent: "HeadlessChrome" }
        )
      })
    ))
})

describe("CDP viewport restoration", () => {
  it.effect("leaves other overrides free to apply while it waits for the renderer", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const ready = yield* Deferred.make<void>()
        const commands: Array<Sent> = []
        // The renderer stays at another width after the override clears, so restoration keeps waiting for a resize.
        let width = 800
        yield* Effect.gen(function*() {
          while (true) {
            const command = yield* browser.next
            commands.push(command)
            if (command.method === "Emulation.clearDeviceMetricsOverride") width = 999
            const result = command.method === "Browser.getVersion"
              ? {
                protocolVersion: "1.3",
                product: "Chrome/155.0.8059.79",
                revision: "test",
                userAgent: "HeadlessChrome",
                jsVersion: "test"
              }
              : command.method === "Target.getBrowserContexts"
              ? { browserContextIds: [] }
              : command.method === "Page.getFrameTree"
              ? {
                frameTree: {
                  frame: {
                    id: "T1",
                    loaderId: "initial",
                    url: "about:blank",
                    securityOrigin: "://",
                    mimeType: "text/html"
                  }
                }
              }
              : command.method === "Page.createIsolatedWorld"
              ? { executionContextId: 7 }
              : command.method === "Runtime.evaluate"
              ? { result: { type: "object", value: [width, 600] } }
              : {}
            yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
          }
        }).pipe(Effect.forkScoped)
        const adapter = yield* CdpAdapter.connect(browser.transport, {
          ownership: "attached",
          sink: (fact) =>
            fact._tag === "PageReady" ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid) : Effect.void
        })
        yield* browser.receive({
          method: "Target.attachedToTarget",
          params: {
            sessionId: "S1",
            targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
            waitingForDebugger: false
          }
        })
        yield* Deferred.await(ready)
        const context = { _tag: "UserContext", context: adapter.defaultContext } as const
        const viewportScope = yield* Scope.make()
        yield* adapter.declare(context, {
          _tag: "Override",
          override: { _tag: "Viewport", width: 400, height: 300, deviceScaleFactor: 1, mobile: false }
        }).pipe(Scope.provide(viewportScope))
        const restoring = yield* Scope.close(viewportScope, Exit.void).pipe(Effect.forkChild)
        yield* drain
        const locale = yield* adapter.declare(context, {
          _tag: "Override",
          override: { _tag: "Locale", locale: "fr-FR" }
        }).pipe(Effect.forkScoped)
        yield* drain
        const sentWhileRestoring = commands.some((command) => command.method === "Emulation.setLocaleOverride")
        // Let restoration finish, so a failure reports the assertion rather than a hung teardown.
        width = 800
        yield* browser.receive({ method: "Page.frameResized", params: {}, sessionId: "S1" })
        yield* Fiber.join(restoring)
        yield* Fiber.join(locale)
        assert.isTrue(sentWhileRestoring)
      })
    ))
  it.effect("leaves other overrides free to apply while target configuration waits for viewport measurement", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const ready = yield* Deferred.make<void>()
        const commands: Array<Sent> = []
        const measurement = yield* Deferred.make<Sent>()
        let holdMeasurement = true
        yield* Effect.gen(function*() {
          while (true) {
            const command = yield* browser.next
            commands.push(command)
            if (command.method === "Page.createIsolatedWorld" && holdMeasurement) {
              holdMeasurement = false
              yield* Deferred.succeed(measurement, command)
              continue
            }
            const result = command.method === "Browser.getVersion"
              ? {
                protocolVersion: "1.3",
                product: "Chrome/155.0.8059.79",
                revision: "test",
                userAgent: "HeadlessChrome",
                jsVersion: "test"
              }
              : command.method === "Target.getBrowserContexts"
              ? { browserContextIds: [] }
              : command.method === "Page.getFrameTree"
              ? {
                frameTree: {
                  frame: {
                    id: "T1",
                    loaderId: "initial",
                    url: "about:blank",
                    securityOrigin: "://",
                    mimeType: "text/html"
                  }
                }
              }
              : command.method === "Page.createIsolatedWorld"
              ? { executionContextId: 7 }
              : command.method === "Runtime.evaluate"
              ? { result: { type: "object", value: [800, 600] } }
              : {}
            yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
          }
        }).pipe(Effect.forkScoped)
        const adapter = yield* CdpAdapter.connect(browser.transport, {
          ownership: "attached",
          sink: (fact) =>
            fact._tag === "PageReady" ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid) : Effect.void
        })
        const context = { _tag: "UserContext", context: adapter.defaultContext } as const
        // Installation before attachment means the blocked viewport operation belongs to configuration.
        yield* adapter.declare(context, {
          _tag: "Override",
          override: { _tag: "Viewport", width: 400, height: 300, deviceScaleFactor: 1, mobile: false }
        })
        yield* browser.receive({
          method: "Target.attachedToTarget",
          params: {
            sessionId: "S1",
            targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
            waitingForDebugger: false
          }
        })
        const held = yield* Deferred.await(measurement)
        const locale = yield* adapter.declare(context, {
          _tag: "Override",
          override: { _tag: "Locale", locale: "fr-FR" }
        }).pipe(Effect.forkScoped)
        yield* drain
        const sentWhileConfiguring = commands.some((command) => command.method === "Emulation.setLocaleOverride")
        yield* browser.receive({ id: held.id, sessionId: held.sessionId, result: { executionContextId: 7 } })
        yield* Deferred.await(ready)
        yield* Fiber.join(locale)
        assert.isTrue(sentWhileConfiguring)
      })
    ))
})

describe("CDP adapter redirect headers", () => {
  for (
    const ordering of [
      "captured",
      "early ExtraInfo",
      "all early",
      "ambiguous prefix",
      "all late",
      "failed last hop",
      "first without ExtraInfo",
      "last without ExtraInfo"
    ] as const
  ) {
    for (const assertion of ["per-hop headers", "JSON HAR body"] as const) {
      it.effect(`attributes redirected request ExtraInfo to its own hop: ${ordering}, ${assertion}`, () =>
        Effect.gen(function*() {
          const browser = yield* makeBrowser
          const ready = yield* Deferred.make<void>()
          const finished = yield* Deferred.make<void>()
          const settled = yield* Deferred.make<void>()
          const facts: Array<Adapter.Fact> = []
          // Answer only the handshake and target configuration; request events below are captured payloads.
          yield* Effect.gen(function*() {
            while (true) {
              const command = yield* browser.next
              const result = command.method === "Browser.getVersion"
                ? {
                  protocolVersion: "1.3",
                  product: "Chrome/155.0.8059.79",
                  revision: "test",
                  userAgent: "HeadlessChrome",
                  jsVersion: "test"
                }
                : command.method === "Target.getBrowserContexts"
                ? { browserContextIds: [] }
                : command.method === "Page.getFrameTree"
                ? {
                  frameTree: {
                    frame: {
                      id: "76F3487A52CF4F79FE4AD28961E44D32",
                      loaderId: "initial",
                      url: "about:blank",
                      securityOrigin: "://",
                      mimeType: "text/html"
                    }
                  }
                }
                : {}
              yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
            }
          }).pipe(Effect.forkScoped)
          const adapter = yield* CdpAdapter.connect(browser.transport, {
            ownership: "attached",
            sink: Effect.fnUntraced(function*(fact) {
              facts.push(fact)
              if (fact._tag === "ConnectionOpened") yield* Deferred.succeed(settled, undefined)
              if (fact._tag === "PageReady") {
                yield* Deferred.succeed(ready, undefined)
              }
              if (
                (fact._tag === "RequestFinished" || fact._tag === "RequestFailed") &&
                facts.filter((fact) => fact._tag === "RequestFinished" || fact._tag === "RequestFailed").length === 2
              ) {
                yield* Deferred.succeed(finished, undefined)
              }
            })
          })
          yield* browser.receive({
            method: "Target.attachedToTarget",
            params: {
              sessionId: "S1",
              targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
              waitingForDebugger: false
            }
          })
          yield* Deferred.await(ready)
          yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
            _tag: "BodyCollection",
            bodies: ["request"],
            maxBytes: 1024
          })
          // Chromium 155 capture lines 63, 65–70, 72, 80, unchanged payloads.
          // The vendored CDP requestWillBeSentExtraInfo contract permits either event to arrive first.
          // Synthetic variants preserve each ExtraInfo stream's hop order and exercise the absence flags.
          const events = structuredClone(captured)
          // Give response headers distinct values so attribution cannot pass by matching identical headers.
          Object.assign(events[2]!.params.headers!, { "x-hop": "first" })
          Object.assign(events[5]!.params.headers!, { "x-hop": "last" })
          let reordered = [...events]
          if (ordering === "early ExtraInfo") {
            reordered = [events[0]!, events[1]!, events[2]!, events[4]!, events[3]!, ...events.slice(5)]
          }
          if (ordering === "all early") {
            reordered = [events[1]!, events[2]!, events[4]!, events[5]!, events[0]!, events[3]!, ...events.slice(6)]
          }
          if (ordering === "all late") {
            reordered = [
              events[0]!,
              events[3]!,
              events[6]!,
              events[1]!,
              events[2]!,
              events[4]!,
              events[5]!,
              ...events.slice(7)
            ]
          }
          if (ordering === "first without ExtraInfo") {
            Object.assign(events[3]!.params, { redirectHasExtraInfo: false })
            reordered = [events[0]!, events[4]!, events[5]!, events[3]!, ...events.slice(6)]
          }
          if (ordering === "last without ExtraInfo") {
            Object.assign(events[6]!.params, { hasExtraInfo: false })
            Object.assign(events[3]!.params.request!.headers, { "content-type": "application/json" })
            reordered = [events[0]!, events[3]!, events[1]!, events[2]!, ...events.slice(6)]
          }
          if (ordering === "failed last hop") {
            reordered = events.slice(0, 6)
          }
          if (ordering === "ambiguous prefix") {
            // Exactly the prefix used by the outstanding-response test below. Only later events reveal
            // that this ExtraInfo belongs to the next hop, rather than the visible request.
            for (const event of captured.slice(0, 2)) {
              yield* browser.receive({ method: event.method, params: event.params, sessionId: "S1" })
            }
            yield* browser.receive({
              method: "Network.webSocketCreated",
              sessionId: "S1",
              params: { requestId: "sentinel", url: "ws://127.0.0.1/" }
            })
            yield* Deferred.await(settled)
            assert.deepStrictEqual(facts.filter((fact) => fact._tag === "HopHeaders"), [])
            Object.assign(events[3]!.params, { redirectHasExtraInfo: false })
            Object.assign(events[3]!.params.redirectResponse!, { fromDiskCache: true, timing: undefined })
            reordered = [events[3]!, events[5]!, ...events.slice(6)]
          }

          for (const event of reordered) {
            yield* browser.receive({ method: event.method, params: event.params, sessionId: "S1" })
          }
          if (ordering === "failed last hop") {
            yield* browser.receive({
              method: "Network.loadingFailed",
              sessionId: "S1",
              params: {
                requestId: events[0]!.params.requestId,
                timestamp: 772297,
                type: "Fetch",
                errorText: "net::ERR_FAILED"
              }
            })
          }
          yield* Deferred.await(finished)
          const requests = facts.filter((fact) => fact._tag === "RequestSent")
          const headers = facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
            fact._tag === "HopHeaders" && fact.phase === "request"
          )
          assert.strictEqual(requests.length, 2)
          if (ordering === "ambiguous prefix") {
            assert.deepStrictEqual(headers.map((fact) => ({ hop: fact.hop, cookie: fact.headers.cookie })), [
              { hop: requests[0]!.request.hop, cookie: undefined },
              { hop: requests[1]!.request.hop, cookie: "flavor=oat" }
            ])
          }
          if (assertion === "per-hop headers") {
            const received = facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
              fact._tag === "HopHeaders" && fact.phase === "response"
            )
            assert.deepStrictEqual(
              received.map((fact) => ({ hop: fact.hop, value: fact.headers["x-hop"] })),
              (ordering === "first without ExtraInfo" || ordering === "ambiguous prefix") ?
                [{ hop: requests[1]!.request.hop, value: "last" }]
                : ordering === "last without ExtraInfo" ?
                [{ hop: requests[0]!.request.hop, value: "first" }]
                : [{ hop: requests[0]!.request.hop, value: "first" }, { hop: requests[1]!.request.hop, value: "last" }]
            )
            assert.deepStrictEqual(
              headers.map((fact) => ({ hop: fact.hop, contentType: fact.headers["content-type"] })),
              [
                { hop: requests[0]!.request.hop, contentType: "application/json" },
                { hop: requests[1]!.request.hop, contentType: "application/json" }
              ]
            )
          } else {for (const { request } of requests) {
              const body = yield* adapter.requestBody(request.hop)
              assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(body)), "{\"q\":\"hats\"}")
              // Apply HopHeaders by hop as the model does; pass the adapter's actual body to the HAR exporter.
              const { entry } = Har.entryOf(
                {
                  request,
                  hop: Option.some({
                    request,
                    state: Readable.of(
                      yield* SubscriptionRef.make({
                        response: Option.none(),
                        received: Option.none(),
                        sent: Option.fromUndefinedOr(headers.findLast((fact) => fact.hop === request.hop)?.headers)
                      })
                    ),
                    sentKnown: Deferred.makeUnsafe(),
                    end: Deferred.makeUnsafe(),
                    page: Option.none(),
                    context: Option.none()
                  }),
                  end: Option.none(),
                  body: Option.none(),
                  requestBody: body,
                  frames: [],
                  done: Deferred.makeUnsafe()
                },
                { wall: 0, monotonic: request.at },
                {
                  detail: "full",
                  include: new Set(["requestBodies"]),
                  bodies: { _tag: "Embed" }
                }
              )
              assert.deepStrictEqual((entry.request as Record<string, unknown>).postData, {
                mimeType: "application/json",
                text: "{\"q\":\"hats\"}"
              })
            }}
        }))
    }
  }
})

const metrics = {
  cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 },
  cssVisualViewport: {
    offsetX: 0,
    offsetY: 0,
    pageX: 10,
    pageY: 20,
    clientWidth: 800,
    clientHeight: 600,
    scale: 1
  },
  cssContentSize: { x: 0, y: 0, width: 900, height: 1800 }
}
const replyMetrics = (browser: Effect.Success<typeof makeBrowser>, command: Sent) =>
  browser.receive({ id: command.id, sessionId: command.sessionId, result: metrics })

/** A synthetic CDP connection folded into the real public Browser layer. */
const sentHeaders = Effect.fnUntraced(
  function*(holdMetrics = false, holdStart = false, holdStop = false, blockStop = false, blockStart = false) {
    const browser = yield* makeBrowser
    const ready = yield* Deferred.make<void>()
    const settled = yield* Queue.unbounded<void>()
    const facts: Array<Adapter.Fact> = []
    const commands: Array<Sent> = []
    const screenshotWork = yield* Queue.unbounded<Sent>()
    const stops = yield* Queue.unbounded<Sent>()
    const stopDeadlines: Array<Option.Option<number>> = []
    const ackDeadlines: Array<Option.Option<number>> = []
    const stopWrites = yield* Queue.unbounded<void>()
    const stopWriteGate = yield* Deferred.make<void>()
    const startWrites = yield* Queue.unbounded<void>()
    const startWriteGate = yield* Deferred.make<void>()
    const captures = yield* Queue.unbounded<Sent>()
    const preparation = yield* Queue.unbounded<Sent>()
    yield* Effect.gen(function*() {
      while (true) {
        const command = yield* browser.next
        commands.push(command)
        if (
          command.method === "Page.getLayoutMetrics" || command.method === "Page.captureScreenshot" ||
          command.method === "Page.startScreencast"
        ) {
          yield* Queue.offer(screenshotWork, command)
        }
        if (command.method === "Page.getLayoutMetrics" && !holdMetrics) {
          yield* replyMetrics(browser, command)
          continue
        }
        if (command.method === "Page.captureScreenshot") {
          yield* Queue.offer(captures, command)
          continue
        }
        if (
          command.method === "Page.getLayoutMetrics" || command.method === "Page.createIsolatedWorld" ||
          (command.method === "Emulation.setDefaultBackgroundColorOverride" && command.params?.color === undefined)
        ) {
          yield* Queue.offer(preparation, command)
          continue
        }
        if (command.method === "Page.stopScreencast") {
          yield* Queue.offer(stops, command)
          if (holdStop) continue
        }
        if (holdStart && command.method === "Page.startScreencast") continue
        const result = command.method === "Runtime.evaluate"
          ? { result: { type: "number", value: 2 } }
          : command.method === "Browser.getVersion"
          ? {
            protocolVersion: "1.3",
            product: "Chrome/155.0.8059.79",
            revision: "test",
            userAgent: "HeadlessChrome",
            jsVersion: "test"
          }
          : command.method === "Target.getBrowserContexts"
          ? { browserContextIds: [] }
          : command.method === "Page.getFrameTree"
          ? {
            frameTree: {
              frame: {
                id: "76F3487A52CF4F79FE4AD28961E44D32",
                loaderId: "initial",
                url: "about:blank",
                securityOrigin: "://",
                mimeType: "text/html"
              }
            }
          }
          : {}
        yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
      }
    }).pipe(Effect.forkScoped)
    let connection!: Adapter.AdapterConnection
    const services = yield* Layer.build(BrowserImpl.layer((sink) =>
      CdpAdapter.connect({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          if (JSON.parse(message).method === "Page.startScreencast" && blockStart) {
            yield* Queue.offer(startWrites, undefined)
            yield* Deferred.await(startWriteGate)
          }
          if (JSON.parse(message).method === "Page.screencastFrameAck") {
            ackDeadlines.push(yield* ProtocolClient.CommandDeadline)
          }
          if (JSON.parse(message).method === "Page.stopScreencast") {
            stopDeadlines.push(yield* ProtocolClient.CommandDeadline)
            yield* Queue.offer(stopWrites, undefined)
            if (blockStop) yield* Deferred.await(stopWriteGate)
          }
          yield* browser.transport.send(message)
        })
      }, {
        ownership: "attached",
        sink: Effect.fnUntraced(function*(fact) {
          yield* sink(fact)
          facts.push(fact)
          if (fact._tag === "PageReady") yield* Deferred.succeed(ready, undefined)
          if (fact._tag === "ConnectionOpened") yield* Queue.offer(settled, undefined)
        })
      }).pipe(Effect.tap((adapter) =>
        Effect.sync(() => {
          connection = adapter
        })
      ))
    ))
    yield* browser.receive({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "S1",
        targetInfo: {
          targetId: "76F3487A52CF4F79FE4AD28961E44D32",
          type: "page",
          title: "",
          url: "about:blank",
          attached: true
        },
        waitingForDebugger: false
      }
    })
    yield* Deferred.await(ready)
    const service = Context.get(services, Browser.Browser)
    const page = (yield* service.pages.waitFor((pages) => pages.length > 0))[0]!
    const next = yield* NetworkRequest.next(page, { url: "**" })
    const send = (event: (typeof captured)[number]) => browser.receive({ ...event, sessionId: "S1" })
    const barrier = Effect.gen(function*() {
      yield* browser.receive({
        method: "Network.webSocketCreated",
        sessionId: "S1",
        params: {
          requestId: `sentinel-${facts.length}`,
          url: "ws://127.0.0.1/"
        }
      })
      yield* Queue.take(settled)
    })
    yield* send(captured[0]!)
    yield* barrier
    const request = yield* next
    return {
      browser,
      connection,
      page,
      request,
      send,
      barrier,
      captures,
      stops,
      stopDeadlines,
      ackDeadlines,
      stopWrites,
      stopWriteGate,
      startWrites,
      startWriteGate,
      commands,
      screenshotWork,
      preparation,
      facts
    }
  }
)

/** Advance deadlines without delays, retaining the live epoch used by the real protocol client's command deadline. */
const onTestClock = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Clock.clockWith((clock) =>
    Effect.suspend(() => {
      const test = BrowserClock.fromClock(clock)
      const origin = BrowserClock.live.now() - test.now()
      return Effect.provideService(self, BrowserClock.CurrentClock, {
        now: () => (origin + test.now()) as ReturnType<typeof test.now>,
        sleep: test.sleep
      })
    })
  )

describe("Chromium public sent-header waiting", () => {
  it.effect("returns the snapshot for a new lookup after eviction while releasing an existing waiter", () =>
    Effect.gen(function*() {
      const { browser, page, request, barrier } = yield* sentHeaders()
      const waiting = yield* Effect.forkScoped(NetworkRequest.headersSent(page, request))
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(waiting.pollUnsafe())
      for (let i = 0; i < Fold.maxHops; i++) {
        yield* browser.receive({
          ...captured[0]!,
          sessionId: "S1",
          params: { ...captured[0]!.params, requestId: `evict-${i}` }
        })
      }
      yield* barrier
      assert.deepStrictEqual(yield* NetworkRequest.headersSent(page, request), request.headers)
      yield* TestClock.adjust("0 millis")
      assert.isDefined(waiting.pollUnsafe(), "existing waiter must settle as well as the new snapshot lookup")
      assert.deepStrictEqual(yield* Fiber.join(waiting), request.headers)
    }).pipe(onTestClock))

  it.effect("publishes late request ExtraInfo after loadingFailed without reopening settled waits", () =>
    Effect.gen(function*() {
      const { browser, page, request, send, barrier, facts } = yield* sentHeaders()
      const waiting = yield* Effect.forkScoped(NetworkRequest.headersSent(page, request))
      yield* TestClock.adjust("0 millis")
      yield* browser.receive({
        method: "Network.loadingFailed",
        sessionId: "S1",
        params: {
          requestId: captured[0]!.params.requestId,
          timestamp: 772297,
          type: "Fetch",
          errorText: "net::ERR_FAILED"
        }
      })
      yield* barrier
      yield* TestClock.adjust("0 millis")
      assert.deepStrictEqual(yield* Fiber.join(waiting), request.headers)
      yield* send(captured[1]!)
      yield* barrier
      // HopHeaders is the adapter feed shared by the model and recording consumers.
      const late = facts.filter((fact) =>
        fact._tag === "HopHeaders" && fact.phase === "request" && fact.hop === request.hop
      )
      const hop = Handles.target(page).behind.runtime.model.hop(request.hop)
      const { entry } = Har.entryOf(
        {
          request,
          hop,
          end: Option.none(),
          body: Option.none(),
          requestBody: Option.none(),
          frames: [],
          done: Deferred.makeUnsafe()
        },
        { wall: 0, monotonic: request.at },
        { detail: "full", include: new Set(), bodies: { _tag: "Embed" } }
      )
      const retained = Option.getOrThrow(hop)
      assert.strictEqual(Option.getOrThrow(retained.state.getUnsafe().sent).cookie, "flavor=oat")
      assert.deepStrictEqual(yield* Fiber.join(waiting), request.headers)
      const recorded = entry.request
      assert.deepStrictEqual({
        published: late.length,
        recordedCookie: recorded.headers.find((header) => header.name.toLowerCase() === "cookie")?.value
      }, { published: 1, recordedCookie: "flavor=REDACTED" })
    }).pipe(onTestClock))

  it.effect("gives late failure headers to earlier redirect obligations first", () =>
    Effect.gen(function*() {
      const { browser, request, send, barrier, facts } = yield* sentHeaders()
      yield* send(captured[3]!)
      yield* barrier
      const requests = facts.filter((fact) => fact._tag === "RequestSent")
      const last = requests[requests.length - 1]!.request
      yield* browser.receive({
        method: "Network.loadingFailed",
        sessionId: "S1",
        params: {
          requestId: captured[0]!.params.requestId,
          timestamp: 772297,
          type: "Fetch",
          errorText: "net::ERR_FAILED"
        }
      })
      yield* send(captured[1]!)
      yield* barrier
      const headers = () =>
        facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
          fact._tag === "HopHeaders" && fact.phase === "request"
        )
      assert.deepStrictEqual(headers().map((fact) => fact.hop), [request.hop])
      yield* send(captured[4]!)
      yield* barrier
      assert.deepStrictEqual(headers().map((fact) => fact.hop), [request.hop, last.hop])
    }).pipe(onTestClock))

  it.effect("waits for attribution, then returns the network headers", () =>
    Effect.gen(function*() {
      const { page, request, send, barrier } = yield* sentHeaders()
      const waiting = yield* Effect.forkScoped(
        NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"))
      )
      yield* send(captured[1]!)
      yield* barrier
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(waiting.pollUnsafe())
      yield* send(captured[2]!)
      yield* send(captured[3]!)
      yield* barrier
      yield* TestClock.adjust("0 millis")
      assert.isDefined(waiting.pollUnsafe())
      assert.strictEqual((yield* Fiber.join(waiting)).cookie, "flavor=oat")
    }).pipe(onTestClock))

  it.effect("times out at its public deadline while attribution is unavailable", () =>
    Effect.gen(function*() {
      const { page, request, send, barrier } = yield* sentHeaders()
      yield* send(captured[1]!)
      yield* barrier
      const waiting = yield* Effect.forkScoped(
        NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"), Effect.flip)
      )
      yield* TestClock.adjust("999 millis")
      assert.isUndefined(waiting.pollUnsafe())
      yield* TestClock.adjust("1 millis")
      const timeout = yield* Fiber.join(waiting)
      assert(Deadline.isTimeout(timeout))
      assert.strictEqual(timeout.operation, "NetworkRequest.headersSent")
      assert.strictEqual(timeout.phase, "waitingForEvent")
    }).pipe(onTestClock))

  for (const terminal of ["fails", "is canceled", "loses its page", "disconnects"] as const) {
    it.effect(`settles without advancing the deadline when a request ${terminal}`, () =>
      Effect.gen(function*() {
        const { browser, page, request, send, barrier } = yield* sentHeaders()
        // Failure attributes queued headers to the last hop; page removal cannot safely do that.
        if (terminal !== "is canceled") yield* send(captured[1]!)
        yield* barrier
        const waiting = yield* Effect.forkScoped(
          NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"))
        )
        yield* TestClock.adjust("0 millis")
        assert.isUndefined(waiting.pollUnsafe())
        if (terminal === "disconnects") {
          yield* browser.lose("test disconnect")
          yield* page.closed
        } else if (terminal === "loses its page") {
          yield* browser.receive({
            method: "Target.detachedFromTarget",
            params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
          })
          yield* page.closed
        } else {
          yield* browser.receive({
            method: "Network.loadingFailed",
            sessionId: "S1",
            params: {
              requestId: captured[0]!.params.requestId,
              timestamp: 772297,
              type: "Fetch",
              errorText: terminal === "fails" ? "net::ERR_FAILED" : "net::ERR_ABORTED",
              canceled: terminal === "is canceled"
            }
          })
          yield* barrier
        }
        yield* TestClock.adjust("0 millis")
        assert.isDefined(waiting.pollUnsafe(), "the terminal event must settle headers without advancing the clock")
        const headers = yield* Fiber.join(waiting)
        if (terminal === "fails") assert.strictEqual(headers.cookie, "flavor=oat")
        else assert.deepStrictEqual(headers, request.headers)
      }).pipe(onTestClock))
  }
})

const replacementEvent = (loaderId = "replacement") => ({
  sessionId: "S1",
  method: "Page.frameNavigated",
  params: {
    frame: {
      id: "76F3487A52CF4F79FE4AD28961E44D32",
      loaderId,
      url: "https://example.com/replacement",
      securityOrigin: "https://example.com",
      mimeType: "text/html"
    }
  }
})

for (const mode of ["live", "absent", "ended", "effect-disabled", "browser-disabled"] as const) {
  it.effect(`records malformed URL diagnostics on live, completed spans (setup: ${mode})`, () => {
    const warnings: Array<Record<string, unknown>> = []
    const logger = Logger.make((entry) => {
      if (entry.logLevel === "Warn") warnings.push(Logger.formatStructured.log(entry).annotations)
    })
    const spans: Array<Tracer.NativeSpan> = []
    const late: Array<string> = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        const event = span.event.bind(span)
        span.event = (name, time, attributes) => {
          if (span.status._tag === "Ended") late.push(name)
          event(name, time, attributes)
        }
        spans.push(span)
        return span
      }
    })
    const enabled = mode !== "effect-disabled" && mode !== "browser-disabled"
    const test = withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        // The worker inherits connection-time services, including a setup span which may end before an event.
        const h = yield* (mode === "absent" || mode === "live" || mode === "browser-disabled"
          ? sentHeaders()
          : (mode === "effect-disabled" ? sentHeaders().pipe(Effect.withTracerEnabled(false)) : sentHeaders()).pipe(
            Effect.withSpan("connecting")
          ))
        const page = yield* h.page.control
        const event = replacementEvent()
        yield* h.browser.receive({ ...event, params: { frame: { ...event.params.frame, url: "nope" } } })
        yield* drain
        yield* page.activate
        assert.strictEqual(h.commands.at(-1)?.method, "Page.bringToFront")
        assert.strictEqual(h.facts.filter((fact) => fact._tag === "DocumentCommitted").at(-1)?.url, "about:blank")
        const malformedWarnings = warnings.filter((entry) => entry["browser.url.reported"] === "nope")
        assert.strictEqual(malformedWarnings.length, 2)
        for (const warning of malformedWarnings) assert.strictEqual(warning["test.ingestion"], "captured")
        assert.deepStrictEqual(late, [])
        const diagnostics = spans.filter((span) => span.name === "diagnostic:browser.url.malformed")
        assert.strictEqual(diagnostics.length, enabled ? 2 : 0)
        for (const span of diagnostics) {
          assert.strictEqual(span.status._tag, "Ended")
          assert.strictEqual(span.attributes.get("browser.url.reported"), "nope")
          assert.strictEqual(span.events.length, 1)
          assert.strictEqual(span.events[0]?.[0], "browser.url.malformed")
          assert.strictEqual(span.events[0]?.[2]?.["browser.url.reported"], "nope")
        }
        // Suppression must never redirect an event to the setup span (live or ended).
        for (const span of spans.filter((span) => !diagnostics.includes(span))) {
          assert.isFalse(span.events.some(([name]) => name === "browser.url.malformed"))
        }
      })
    )
    let program = mode === "live" || mode === "browser-disabled" ? test.pipe(Effect.withSpan("connecting")) : test
    if (mode === "browser-disabled") {
      program = program.pipe(
        Effect.provideService(Browser.TracerDisabledWhen, (operation) => operation.name === "browser.url.malformed")
      )
    }
    return program.pipe(
      Effect.withTracer(tracer),
      Effect.provideService(
        Browser.SpanNameGenerator,
        (operation) => operation.name === "browser.url.malformed" ? `diagnostic:${operation.name}` : operation.name
      ),
      Effect.annotateLogs({ "test.ingestion": "captured" }),
      Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
      onTestClock
    )
  })
}

const replyCapture = (browser: Effect.Success<typeof makeBrowser>, command: Sent) =>
  browser.receive({ id: command.id, sessionId: command.sessionId, result: { data: "AA==" } })

describe("Chromium capture document replacement", () => {
  for (const preparation of ["native", "layout", "element"] as const) {
    it.effect(`fails promptly during ${preparation} capture preparation or dispatch`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(preparation === "layout")
        const reader = yield* h.page.control
        const pending = yield* Effect.forkScoped(
          reader.screenshot(
            preparation === "layout"
              ? { area: "fullPage" }
              : preparation === "element"
              ? { area: { element: reader.locator("main") } }
              : undefined
          ).pipe(Effect.flip)
        )
        yield* Queue.take(preparation !== "native" ? h.preparation : h.captures)
        yield* h.browser.receive(replacementEvent())
        yield* h.barrier
        yield* TestClock.adjust("0 millis")
        assert.isDefined(pending.pollUnsafe(), "capture must fail on commit without advancing its deadline")
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "PageError")
        if (error._tag === "PageError") {
          assert.strictEqual(error.reason._tag, "CaptureInvalidated")
          if (error.reason._tag === "CaptureInvalidated") {
            const documents = h.facts.filter((fact) => fact._tag === "DocumentCommitted")
            assert.deepStrictEqual([error.reason.document, error.reason.replacement], [
              documents.at(-2)?.document,
              documents.at(-1)?.document
            ])
          }
        }
        if (preparation !== "native") assert.strictEqual(yield* Queue.size(h.captures), 0)
      }).pipe(onTestClock))
  }

  it.effect("keeps a native reply received before replacement terminal", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot())
      const command = yield* Queue.take(h.captures)
      yield* replyCapture(h.browser, command)
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
    }).pipe(onTestClock))

  for (const errorReply of [false, true]) {
    it.effect(`keeps an earlier native ${errorReply ? "error" : "success"} receipt while background cleanup is pending`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(Effect.exit(page.screenshot({ omitBackground: true })))
        const command = yield* Queue.take(h.captures)
        yield* h.browser.receive({
          id: command.id,
          sessionId: command.sessionId,
          ...(errorReply ? { error: { code: -32000, message: "capture failed" } } : { result: { data: "AA==" } })
        })
        const cleanup = yield* Queue.take(h.preparation)
        yield* h.browser.receive(replacementEvent())
        yield* h.barrier
        yield* h.browser.receive({ id: cleanup.id, sessionId: cleanup.sessionId, result: {} })
        const exit = yield* Fiber.join(pending)
        if (errorReply) {
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          assert.strictEqual(error.value._tag, "PageError")
          if (error.value._tag === "PageError") assert.strictEqual(error.value.reason._tag, "BackendFailure")
        } else {
          assert(Exit.isSuccess(exit))
          assert.deepStrictEqual(Array.from(exit.value), [0])
        }
      }).pipe(onTestClock))
  }

  it.effect("keeps a native error reply received before replacement terminal", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive({
        id: command.id,
        sessionId: command.sessionId,
        error: { code: -32000, message: "capture failed" }
      })
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "BackendFailure")
    }).pipe(onTestClock))

  it.effect("invalidates when replacement was received before a native error reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive(replacementEvent())
      yield* h.browser.receive({
        id: command.id,
        sessionId: command.sessionId,
        error: { code: -32000, message: "capture failed" }
      })
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  it.effect("keeps a page crash as TargetGone instead of capture invalidation", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      yield* h.browser.receive({ method: "Inspector.targetCrashed", sessionId: "S1", params: {} })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "TargetGone")
      if (error._tag === "TargetGone") assert.strictEqual(error.reason._tag, "PageCrashed")
    }).pipe(onTestClock))

  it.effect("invalidates when commit was received before the native reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive(replacementEvent())
      yield* replyCapture(h.browser, command)
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
      // A late reply and the old guard cannot affect a subsequent caller.
      const next = yield* Effect.forkScoped(page.screenshot())
      yield* replyCapture(h.browser, yield* Queue.take(h.captures))
      assert.deepStrictEqual(Array.from(yield* Fiber.join(next)), [0])
    }).pipe(onTestClock))

  for (const method of ["Page.navigatedWithinDocument", "Page.frameStartedLoading", "Page.frameStoppedLoading"]) {
    it.effect(`does not invalidate for ${method}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot())
        const command = yield* Queue.take(h.captures)
        yield* h.browser.receive({
          sessionId: "S1",
          method,
          params: {
            frameId: "76F3487A52CF4F79FE4AD28961E44D32",
            url: "about:blank#hash",
            navigationType: "fragment"
          }
        })
        yield* h.barrier
        assert.isUndefined(pending.pollUnsafe())
        yield* replyCapture(h.browser, command)
        assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
      }).pipe(onTestClock))
  }

  it.effect("does not invalidate for a committed child-frame replacement", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot())
      const command = yield* Queue.take(h.captures)
      const event = replacementEvent()
      yield* h.browser.receive({
        ...event,
        params: { frame: { ...event.params.frame, id: "child", parentId: event.params.frame.id } }
      })
      yield* h.barrier
      assert.isUndefined(pending.pollUnsafe())
      yield* replyCapture(h.browser, command)
      assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
    }).pipe(onTestClock))

  it.effect("invalidates a same-URL reload with a new document identity", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      const event = replacementEvent()
      yield* h.browser.receive({ ...event, params: { frame: { ...event.params.frame, url: "about:blank" } } })
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  it.effect("retains the native session-ended error instead of reporting document invalidation", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "BackendFailure")
    }).pipe(onTestClock))

  it.effect("retains an already expired deadline across later replacement", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Deadline.within("1 second"), Effect.flip))
      yield* Queue.take(h.captures)
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "Timeout")
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      const next = yield* Effect.forkScoped(page.screenshot())
      yield* replyCapture(h.browser, yield* Queue.take(h.captures))
      assert.deepStrictEqual(Array.from(yield* Fiber.join(next)), [0])
    }).pipe(onTestClock))
})

describe("Chromium empty screenshot errors", () => {
  for (
    const variant of ["empty", "otherCode", "otherMessage", "metrics", "replacementBefore", "replacementAfter"] as const
  ) {
    it.effect(`preserves native cause and ordering for ${variant}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(variant === "metrics")
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
        const command = yield* Queue.take(variant === "metrics" ? h.preparation : h.captures)
        const code = variant === "otherCode" ? -32001 : -32000
        const description = variant === "otherMessage" ? "capture failed" : "Unable to capture screenshot"
        if (variant === "replacementBefore") yield* h.browser.receive(replacementEvent())
        yield* h.browser.receive({
          id: command.id,
          sessionId: command.sessionId,
          error: { code, message: description }
        })
        if (variant === "replacementAfter") yield* h.browser.receive(replacementEvent())
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "PageError")
        if (error._tag !== "PageError") return
        if (variant === "replacementBefore") {
          assert.strictEqual(error.reason._tag, "CaptureInvalidated")
          return
        }
        assert.strictEqual(error.reason._tag, "BackendFailure")
        if (error.reason._tag !== "BackendFailure") return
        assert.strictEqual(error.operation, "Page.screenshot")
        assert.strictEqual(error.reason.kind, "Rejected")
        assert.strictEqual(error.reason.method, command.method)
        const nativeMessage = `${command.method} rejected: Unrecognized (${description})`
        const expected = variant === "empty" || variant === "replacementAfter"
          ? "Chromium returned an empty image"
          : nativeMessage
        assert.strictEqual(error.reason.hint, expected)
        assert.include(error.message, expected)
        assert.instanceOf(error.reason.cause, Protocol.ProtocolError)
        if (error.reason.cause instanceof Protocol.ProtocolError) {
          assert.deepStrictEqual(
            error.reason.cause.reason,
            new Protocol.Rejected({
              method: command.method,
              reason: "Unrecognized",
              code,
              description
            })
          )
        }
      }).pipe(onTestClock))
  }
})

describe("Chromium screenshot viewport containment", () => {
  for (
    const [name, clip, beyond] of [
      ["scrolled viewport edges", { x: 10, y: 20, width: 800, height: 600 }, false],
      ["fractional inset", { x: 10.25, y: 20.25, width: 799.5, height: 599.5 }, false],
      ["fractional left overflow", { x: 9.75, y: 20, width: 100, height: 100 }, true],
      ["fractional top overflow", { x: 10, y: 19.75, width: 100, height: 100 }, true],
      ["fractional right overflow", { x: 10.25, y: 20, width: 800, height: 100 }, true],
      ["fractional bottom overflow", { x: 10, y: 20.25, width: 100, height: 600 }, true]
    ] as const
  ) {
    it.effect(name, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const ready = h.facts.find((fact) => fact._tag === "PageReady")!
        assert(ready._tag === "PageReady")
        const pending = yield* Effect.forkScoped(h.connection.screenshot(ready.page, {
          format: "png",
          quality: Option.none(),
          fullPage: false,
          scale: "device",
          omitBackground: false,
          clip: Option.some(clip)
        }))
        const capture = yield* Queue.take(h.captures)
        assert.strictEqual(capture.params?.captureBeyondViewport, beyond)
        yield* replyCapture(h.browser, capture)
        yield* Fiber.join(pending)
      }).pipe(onTestClock))
  }

  for (
    const [name, fullPage, scale, clip, beyond] of [
      ["generated full-page clip", true, "device", { x: 0, y: 0, width: 900, height: 1800, scale: 1 }, true],
      ["generated CSS-scale viewport clip", false, "css", { x: 10, y: 20, width: 800, height: 600, scale: 0.5 }, false]
    ] as const
  ) {
    it.effect(name, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const ready = h.facts.find((fact) => fact._tag === "PageReady")!
        assert(ready._tag === "PageReady")
        const pending = yield* Effect.forkScoped(h.connection.screenshot(ready.page, {
          format: "png",
          quality: Option.none(),
          fullPage,
          scale,
          omitBackground: false,
          clip: Option.none()
        }))
        const capture = yield* Queue.take(h.captures)
        assert.deepStrictEqual(capture.params?.clip, clip)
        assert.strictEqual(capture.params?.captureBeyondViewport, beyond)
        yield* replyCapture(h.browser, capture)
        yield* Fiber.join(pending)
      }).pipe(onTestClock))
  }
})

describe("Chromium screenshot renderer readiness", () => {
  it.effect("invalidates when replacement was received before a metrics error reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const readiness = yield* Queue.take(h.preparation)
      yield* h.browser.receive(replacementEvent())
      yield* h.browser.receive({
        id: readiness.id,
        sessionId: readiness.sessionId,
        error: { code: -32000, message: "renderer metrics failed" }
      })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  for (const replace of [false, true]) {
    it.effect(`handles a malformed metrics reply ${replace ? "after replacement" : "without replacement"}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
        const readiness = yield* Queue.take(h.preparation)
        if (replace) yield* h.browser.receive(replacementEvent())
        yield* h.browser.receive({ id: readiness.id, sessionId: readiness.sessionId, result: {} })
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "PageError")
        if (error._tag === "PageError") {
          assert.strictEqual(error.reason._tag, replace ? "CaptureInvalidated" : "BackendFailure")
          if (error.reason._tag === "BackendFailure") {
            assert.strictEqual(error.reason.kind, "IncompatibleResponse")
            assert.strictEqual(error.reason.method, "Page.getLayoutMetrics")
          }
        }
        assert.strictEqual(yield* Queue.size(h.captures), 0)
      }).pipe(onTestClock))
  }

  for (const sizing of ["viewport", "fullPage", "css", "fullPageCss"] as const) {
    it.effect(`reads metrics once before ${sizing} capture and reuses sizing`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot({
          ...(sizing === "fullPage" || sizing === "fullPageCss" ? { area: "fullPage" as const } : {}),
          scale: sizing === "css" || sizing === "fullPageCss" ? "css" : "device"
        }))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics", "renderer metrics must precede capture")
        assert.strictEqual(yield* Queue.size(h.captures), 0)
        const readiness = yield* Queue.take(h.preparation)
        assert.strictEqual(readiness.method, "Page.getLayoutMetrics")
        yield* replyMetrics(h.browser, readiness)
        const capture = yield* Queue.take(h.captures)
        const clip = sizing === "viewport" ? undefined : sizing === "css"
          ? { x: 10, y: 20, width: 800, height: 600, scale: 0.5 }
          : { x: 0, y: 0, width: 900, height: 1800, scale: sizing === "fullPageCss" ? 0.5 : 1 }
        assert.deepStrictEqual(capture.params?.clip, clip)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.getLayoutMetrics").length, 1)
        yield* replyCapture(h.browser, capture)
        assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
      }).pipe(onTestClock))
  }

  for (const terminal of ["timeout", "interrupt", "close", "replace", "reject"] as const) {
    it.effect(`prevents dispatch after readiness ${terminal}, including a late metrics reply`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(Effect.exit(page.screenshot().pipe(Deadline.within("1 second"))))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics", "viewport capture must await renderer readiness")
        const readiness = yield* Queue.take(h.preparation)
        if (terminal === "timeout") yield* TestClock.adjust("1 second")
        if (terminal === "interrupt") yield* Fiber.interrupt(pending)
        if (terminal === "close") {
          yield* h.browser.receive({
            method: "Target.detachedFromTarget",
            params: {
              sessionId: "S1",
              targetId: "76F3487A52CF4F79FE4AD28961E44D32"
            }
          })
        }
        if (terminal === "replace") {
          yield* h.browser.receive(replacementEvent())
          // Queue the reply immediately behind the commit: dispatch must drain observed events.
          yield* replyMetrics(h.browser, readiness)
        }
        if (terminal === "reject") {
          yield* h.browser.receive({
            id: readiness.id,
            sessionId: readiness.sessionId,
            error: { code: -32000, message: "renderer metrics failed" }
          })
        }
        if (terminal !== "interrupt") {
          const exit = yield* Fiber.join(pending)
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          if (terminal === "timeout") {
            assert(Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.operation, "Page.screenshot")
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          } else {
            assert.strictEqual(error.value._tag, "PageError")
            if (error.value._tag === "PageError") {
              assert.strictEqual(
                error.value.reason._tag,
                terminal === "replace" ? "CaptureInvalidated" : "BackendFailure"
              )
              if (terminal === "reject" && error.value.reason._tag === "BackendFailure") {
                assert.strictEqual(error.value.reason.kind, "Rejected")
                assert.strictEqual(error.value.reason.method, "Page.getLayoutMetrics")
                assert.include(error.value.reason.hint, "renderer metrics failed")
              }
            }
          }
        }
        yield* replyMetrics(h.browser, readiness)
        yield* h.browser.delivered
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(yield* Queue.size(h.captures), 0, "late readiness must never resume capture")
      }).pipe(onTestClock))
  }
})

describe("Chromium video writer lifetime", () => {
  const frame = (
    h: { readonly browser: { readonly receive: (message: object) => Effect.Effect<unknown> } },
    sessionId: number,
    timestamp?: number
  ) =>
    h.browser.receive({
      method: "Page.screencastFrame",
      sessionId: "S1",
      params: {
        data: "/9j/2Q==",
        sessionId,
        metadata: {
          ...(timestamp === undefined ? {} : { timestamp }),
          offsetTop: 0,
          pageScaleFactor: 1,
          deviceWidth: 800,
          deviceHeight: 600,
          scrollOffsetX: 0,
          scrollOffsetY: 0
        }
      }
    })

  it.effect("does not retain the acquisition protocol deadline in recording work", () =>
    Effect.gen(function*() {
      const deadline = yield* Deferred.make<Option.Option<number>>()
      const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
        write: Effect.fnUntraced(function*(_frames: Stream.Stream<VideoWriter.Frame>, target: VideoWriter.Destination) {
          yield* Deferred.succeed(deadline, yield* ProtocolClient.CommandDeadline)
          return target.path
        })
      }))
      yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
        _tag: "Downloads",
        behavior: { _tag: "Allow", directory: "/tmp" }
      })
      const page = yield* h.page.control
      const video = yield* page.capability(Capability.Video).pipe(Deadline.within("1 second"))
      yield* frame(h, 70)
      const recordedDeadline = yield* Deferred.await(deadline)
      yield* video.file
      assert.isTrue(Option.isNone(recordedDeadline), "recording and preparation outlive the acquisition deadline")
      assert.strictEqual(h.ackDeadlines.length, 1)
      assert.isTrue(
        h.ackDeadlines.every(Option.isNone),
        "releasing a pending frame must also clear the acquisition deadline"
      )
    }).pipe(onTestClock))

  it.effect("keeps idle images until the recording scope closes", () =>
    Effect.gen(function*() {
      const written = yield* Queue.unbounded<VideoWriter.Frame>()
      const destination = yield* Deferred.make<VideoWriter.Destination>()
      const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
        write: Effect.fnUntraced(function*(frames: Stream.Stream<VideoWriter.Frame>, target: VideoWriter.Destination) {
          yield* Deferred.succeed(destination, target)
          yield* frames.pipe(Stream.runForEach((image) => Queue.offer(written, image)))
          return target.path
        })
      }))
      yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
        _tag: "Downloads",
        behavior: { _tag: "Allow", directory: "/tmp" }
      })
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
      yield* frame(h, 51, 1000)
      assert.match((yield* Deferred.await(destination)).path, /^\/tmp\/strider-.*\.webm$/)
      const first = yield* Queue.take(written)
      yield* TestClock.adjust("120 millis")
      assert.strictEqual(yield* Queue.size(written), 0, "idle periods do not generate copies")
      yield* TestClock.adjust("380 millis")
      // The paint happened at 237ms; receiving it at 500ms must not change its timestamp.
      yield* frame(h, 52, 1000.237)
      const painted = yield* Queue.take(written)
      assert.closeTo(painted.at, 237e6, 1000)
      yield* TestClock.adjust("100 millis")
      yield* Scope.close(scope, Exit.void)
      const tail = yield* Queue.take(written)
      assert.strictEqual(tail.at, 600e6)
      assert.deepStrictEqual(tail.data, first.data)
      assert.match(yield* video.file, /\.webm$/)
    }).pipe(onTestClock))

  it.effect("keeps the stop-time tail local after a forward browser clock jump", () =>
    Effect.gen(function*() {
      const written = yield* Queue.unbounded<VideoWriter.Frame>()
      const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
        write: (frames, target) =>
          frames.pipe(
            Stream.runForEach((image) => Queue.offer(written, image)),
            Effect.as(target.path)
          )
      }))
      yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
        _tag: "Downloads",
        behavior: { _tag: "Allow", directory: "/tmp" }
      })
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
      yield* frame(h, 81, 1000)
      assert.strictEqual((yield* Queue.take(written)).at, 0)
      yield* TestClock.adjust("40 millis")
      yield* frame(h, 82, 4600)
      const jumped = yield* Queue.take(written)
      yield* TestClock.adjust("60 millis")
      yield* Scope.close(scope, Exit.void)
      const tail = yield* Queue.take(written)
      assert.strictEqual(tail.at, 100e6, "the wall-clock jump must not extend the recording past stop")
      assert.strictEqual(jumped.at, 40e6)
      yield* video.file
    }).pipe(onTestClock))

  for (const epoch of [1000, 4000000000, "local"] as const) {
    for (const missing of [false, true]) {
      it.effect(`maps browser epoch ${epoch} with ${missing ? "missing timestamp transitions" : "backward source times"}`, () =>
        Effect.gen(function*() {
          const written = yield* Queue.unbounded<VideoWriter.Frame>()
          const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
            write: (frames, target) =>
              frames.pipe(
                Stream.runForEach((image) => Queue.offer(written, image)),
                Effect.as(target.path)
              )
          }))
          yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
            _tag: "Downloads",
            behavior: { _tag: "Allow", directory: "/tmp" }
          })
          const page = yield* h.page.control
          // Reusing the page after a complete stop must establish a new clock mapping.
          for (const shift of [0, 3600]) {
            const scope = yield* Scope.make()
            const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
            const clock = yield* BrowserClock.CurrentClock
            const base = typeof epoch === "number"
              ? epoch + shift
              : (performance.timeOrigin + clock.now() / 1e6) / 1000
            const samples = missing
              ? epoch === "local"
                ? [[0, base, 0], [100, undefined, 100], [110, base + 0.005, 100], [4100, base + 4, 4000]] as const
                : [
                  [0, undefined, 0],
                  [10, base, 10],
                  [20, base + 0.005, 15],
                  [30, undefined, 30],
                  [40, base + 0.020, 30],
                  [4100, base + 4, 4010]
                ] as const
              : [[0, base, 0], [10, base + 0.005, 5], [20, base + 0.003, 5], [4100, base + 4, 4000]] as const
            let previous = 0
            for (const [receipt, timestamp, expected] of samples) {
              yield* TestClock.adjust(receipt - previous)
              previous = receipt
              yield* frame(h, receipt + 1, timestamp)
              assert.closeTo((yield* Queue.take(written)).at, expected * 1e6, 1000)
            }
            yield* Scope.close(scope, Exit.void)
            assert.closeTo((yield* Queue.take(written)).at, 4100e6, 1000)
            yield* video.file
          }
        }).pipe(onTestClock))
    }
  }

  it.effect("propagates a writer failure before the recording scope closes", () =>
    Effect.gen(function*() {
      const failed = new VideoWriter.VideoWriterError({
        reason: new Reason.BackendFailure({ kind: "Rejected", method: "fake writer", hint: "encoder failed" })
      })
      const h = yield* sentHeaders().pipe(
        Effect.provideService(VideoWriter.VideoWriter, { write: () => Effect.fail(failed) })
      )
      yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
        _tag: "Downloads",
        behavior: { _tag: "Allow", directory: "/tmp" }
      })
      const page = yield* h.page.control
      const video = yield* page.capability(Capability.Video)
      yield* frame(h, 52)
      const error = yield* Effect.flip(video.file)
      assert(Capability.isCapabilityError(error))
      assert.strictEqual(error.reason._tag, "BackendFailure")
    }).pipe(onTestClock))

  it.effect("shares video ownership and holds acknowledgements behind a blocked writer", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        const started = yield* Deferred.make<void>()
        const unblock = yield* Deferred.make<void>()
        const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
          write: Effect.fnUntraced(
            function*(frames: Stream.Stream<VideoWriter.Frame>, target: VideoWriter.Destination) {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(unblock)
              yield* Stream.runDrain(frames)
              return target.path
            }
          )
        }))
        yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
          _tag: "Downloads",
          behavior: { _tag: "Allow", directory: "/tmp" }
        })
        const page = yield* h.page.control
        const castScope = yield* Scope.make()
        const cast = yield* page.capability(Capability.Screencast).pipe(Scope.provide(castScope))
        yield* cast.frames.pipe(Stream.runDrain, Effect.forkIn(castScope))
        const videoScope = yield* Scope.make()
        const video = yield* page.capability(Capability.Video).pipe(Scope.provide(videoScope))
        yield* frame(h, 61)
        yield* Deferred.await(started)
        yield* drain
        yield* frame(h, 62)
        yield* drain
        yield* frame(h, 63)
        yield* TestClock.adjust("80 millis")
        yield* drain
        const acks = () =>
          h.commands.filter((c) => c.method === "Page.screencastFrameAck").map((c) => c.params?.sessionId)
        assert.deepStrictEqual(acks(), [], "the fast screencast cannot acknowledge the writer's waiting frame")
        yield* Deferred.succeed(unblock, undefined)
        yield* TestClock.adjust("120 millis")
        yield* drain
        assert.deepStrictEqual(acks(), [61, 62, 63])
        yield* Scope.close(castScope, Exit.void)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
        yield* Scope.close(videoScope, Exit.void)
        yield* video.file
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      })
    ).pipe(onTestClock))

  it.effect("closes a recording that never received a frame without waiting for the finish budget", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        let writes = 0
        const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
          write: (_frames, target) => Effect.sync(() => writes++).pipe(Effect.as(target.path))
        }))
        yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
          _tag: "Downloads",
          behavior: { _tag: "Allow", directory: "/tmp" }
        })
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
        yield* drain
        // No Page.screencastFrame arrives before the scope closes, as when the page never paints.
        const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
        yield* drain
        yield* TestClock.adjust("1 second")
        yield* drain
        const closedPromptly = closing.pollUnsafe() !== undefined
        yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(closing)
        assert(closedPromptly, "closing a frameless recording must not wait out the five-second finish budget")
        assert.strictEqual(writes, 0)
        const error = yield* Effect.flip(video.file)
        assert(Capability.isCapabilityError(error))
        assert.notMatch(error.message, /did not finish within 5 seconds/)
      })
    ).pipe(onTestClock))

  for (const mode of ["empty", "started", "blocked", "failure", "blockedFailure", "connection"] as const) {
    it.effect(`settles video on ${mode.endsWith("Failure") || mode === "failure" ? `source failure (${mode})` : `session end (${mode})`} while its scope stays open`, () =>
      withProtocolScheduler((drain) =>
        Effect.gen(function*() {
          const started = yield* Deferred.make<void>()
          let writes = 0
          let released = false
          const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
            write: Effect.fnUntraced(
              function*(frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) {
                writes++
                yield* Deferred.succeed(started, undefined)
                return yield* (mode === "blocked"
                  ? Effect.never
                  : Stream.runDrain(frames).pipe(Effect.as(destination.path)))
                  .pipe(Effect.ensuring(Effect.sync(() => {
                    released = true
                  })))
              }
            )
          }))
          yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
            _tag: "Downloads",
            behavior: { _tag: "Allow", directory: "/tmp" }
          })
          const page = yield* h.page.control
          const recordingScope = yield* Scope.make()
          const video = yield* page.capability(Capability.Video).pipe(Scope.provide(recordingScope))
          const file = yield* Effect.forkScoped(Effect.exit(video.file))
          if (mode !== "empty") {
            yield* frame(h, 71)
            yield* Deferred.await(started)
          }
          if (mode === "failure" || mode === "blockedFailure") {
            yield* h.browser.receive({
              method: "Page.screencastFrame",
              sessionId: "S1",
              params: {
                data: "!",
                sessionId: 72,
                metadata: {
                  offsetTop: 0,
                  pageScaleFactor: 1,
                  deviceWidth: 800,
                  deviceHeight: 600,
                  scrollOffsetX: 0,
                  scrollOffsetY: 0
                }
              }
            })
          } else if (mode === "connection") {
            yield* h.browser.lose("video transport lost")
          } else {
            yield* h.browser.receive({
              method: "Target.detachedFromTarget",
              params: {
                sessionId: "S1",
                targetId: "76F3487A52CF4F79FE4AD28961E44D32"
              }
            })
          }
          yield* drain
          if (mode === "blocked") {
            yield* TestClock.adjust("5 seconds")
            yield* drain
          }
          const settled = file.pollUnsafe() !== undefined
          if (!settled) {
            // Ensure even the pre-fix regression releases its fibers before asserting.
            yield* Fiber.interrupt(file)
          }
          const releasedAtFile = released
          const closing = yield* Effect.forkScoped(Scope.close(recordingScope, Exit.void))
          yield* drain
          yield* TestClock.adjust("5 seconds")
          yield* Fiber.join(closing)
          assert.isTrue(settled, "source termination must settle file without closing the caller scope")
          const outcome = yield* Fiber.join(file)
          if (mode === "started") {
            assert.isTrue(Exit.isSuccess(outcome))
          } else {
            const error = yield* Effect.flip(outcome)
            assert(Capability.isCapabilityError(error))
            assert.strictEqual(error.reason._tag, "BackendFailure")
            if ((mode === "failure" || mode === "blockedFailure") && error.reason._tag === "BackendFailure") {
              assert.strictEqual(error.reason.method, "Page.screencastFrame")
            }
            if (mode === "connection" && error.reason._tag === "BackendFailure") {
              assert.notStrictEqual(error.reason.method, "VideoWriter.write")
            }
            if (mode === "empty") {
              assert.strictEqual(writes, 0)
              assert.match(error.message, /no frame|before.*frame/i)
            }
          }
          if (mode !== "empty") {
            assert.isTrue(releasedAtFile, "the writer must release before file settles")
          }
        })
      ).pipe(onTestClock))
  }

  it.effect("bounds an unresponsive writer finish by five seconds on the browser clock", () =>
    withProtocolScheduler((drain) =>
      Effect.gen(function*() {
        const started = yield* Deferred.make<void>()
        const h = yield* sentHeaders().pipe(Effect.provideService(VideoWriter.VideoWriter, {
          write: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
        }))
        yield* h.connection.declare({ _tag: "UserContext", context: h.connection.defaultContext }, {
          _tag: "Downloads",
          behavior: { _tag: "Allow", directory: "/tmp" }
        })
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
        yield* frame(h, 53)
        yield* Deferred.await(started)
        const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
        yield* drain
        yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(closing)
        const error = yield* Effect.flip(video.file)
        assert(Capability.isCapabilityError(error))
        assert.strictEqual(error.reason._tag, "BackendFailure")
      })
    ).pipe(onTestClock))
})

describe("Chromium screencast renderer readiness", () => {
  it.effect("acknowledges each shared frame once after every consumer takes it and replays it to an idle join", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const fast = yield* page.capability(Capability.Screencast)
      const slow = yield* page.capability(Capability.Screencast)
      const reading = yield* Effect.forkScoped(fast.frames.pipe(Stream.take(1), Stream.runCollect))
      yield* h.browser.receive({
        method: "Page.screencastFrame",
        sessionId: "S1",
        params: {
          data: "/9j/2Q==",
          sessionId: 37,
          metadata: {
            offsetTop: 0,
            pageScaleFactor: 1,
            deviceWidth: 800,
            deviceHeight: 600,
            scrollOffsetX: 0,
            scrollOffsetY: 0
          }
        }
      })
      yield* Fiber.join(reading)
      yield* h.barrier
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.screencastFrameAck").length,
        0,
        "a fast consumer must not acknowledge the slow consumer's frame"
      )
      yield* slow.frames.pipe(Stream.take(1), Stream.runDrain)
      yield* h.barrier
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.screencastFrameAck").length, 1)
      const idle = yield* page.capability(Capability.Screencast)
      const cached = yield* idle.frames.pipe(Stream.take(1), Stream.runCollect)
      assert.strictEqual(cached.length, 1, "joining an idle session delivers its last image without a repaint")
      yield* h.barrier
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.screencastFrameAck").length,
        1,
        "replaying a cached frame must not acknowledge it twice"
      )
    }).pipe(onTestClock))

  it.effect("holds start until one valid metrics reply, then acknowledges frames and stops normally", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const closedFrames = yield* Effect.scoped(Effect.gen(function*() {
        const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics")
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
        yield* replyMetrics(h.browser, first)
        const acquired = yield* Fiber.join(pending)
        const collecting = yield* Effect.forkScoped(acquired.frames.pipe(Stream.take(1), Stream.runCollect))
        yield* h.browser.receive({
          method: "Page.screencastFrame",
          sessionId: "S1",
          params: {
            data: "/9j/2Q==",
            sessionId: 7,
            metadata: {
              offsetTop: 0,
              pageScaleFactor: 1,
              deviceWidth: 800,
              deviceHeight: 600,
              scrollOffsetX: 0,
              scrollOffsetY: 0
            }
          }
        })
        assert.strictEqual((yield* Fiber.join(collecting)).length, 1)
        return acquired.frames
      }))
      assert.deepStrictEqual(yield* Stream.runCollect(closedFrames), [], "caller scope closes the frame subscription")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.getLayoutMetrics").length, 1)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      assert.deepStrictEqual(h.commands.find((c) => c.method === "Page.screencastFrameAck")?.params, { sessionId: 7 })
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("spends the same acquisition deadline on metrics and start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(Effect.exit(
        page.capability(Capability.Screencast).pipe(
          Deadline.within("1 second")
        )
      ))
      const first = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(first.method, "Page.getLayoutMetrics")
      yield* TestClock.adjust("750 millis")
      yield* replyMetrics(h.browser, first)
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.startScreencast")
      yield* TestClock.adjust("250 millis")
      const exit = yield* Fiber.join(pending)
      assert(Exit.isFailure(exit))
      const error = Exit.findErrorOption(exit)
      assert(Option.isSome(error) && Deadline.isTimeout(error.value))
      assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
    }).pipe(onTestClock))

  for (const terminal of ["interrupt", "timeout"] as const) {
    for (const replyAt of ["before scope close", "after scope close"] as const) {
      it.effect(`releases a late successful start after ${terminal}, reply ${replyAt}`, () =>
        Effect.gen(function*() {
          const h = yield* sentHeaders(false, true)
          const page = yield* h.page.control
          const scope = yield* Scope.make()
          const pending = yield* Effect.forkScoped(Effect.exit(
            page.capability(Capability.Screencast).pipe(
              Deadline.within("1 second"),
              Effect.provideService(Scope.Scope, scope)
            )
          ))
          assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
          const start = yield* Queue.take(h.screenshotWork)
          assert.strictEqual(start.method, "Page.startScreencast")
          if (terminal === "interrupt") yield* Fiber.interrupt(pending)
          else {
            yield* TestClock.adjust("1 second")
            const exit = yield* Fiber.join(pending)
            const error = Exit.findErrorOption(exit)
            assert(Option.isSome(error) && Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          }
          if (replyAt === "after scope close") yield* Scope.close(scope, Exit.void)
          yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
          yield* h.browser.delivered
          yield* TestClock.adjust("0 millis")
          if (replyAt === "before scope close") yield* Scope.close(scope, Exit.void)
          yield* TestClock.adjust("0 millis")
          assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 2)
        }).pipe(onTestClock))
    }
  }

  it.effect("waits for stop confirmation when the acquisition deadline expired before scope closure", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(
        Deadline.within("1 second"),
        Effect.provideService(Scope.Scope, scope)
      )
      yield* TestClock.adjust("2 seconds")
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
      const stop = yield* Queue.take(h.stops)
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(closing.pollUnsafe(), "cleanup must wait for the held stop reply")
      const deadline = h.stopDeadlines[0]!
      const now = (yield* BrowserClock.CurrentClock).now()
      assert(Option.isNone(deadline) || deadline.value > now, "cleanup command deadline must still be usable")
      yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      yield* Fiber.join(closing)
    }).pipe(onTestClock))

  it.effect("stops exactly once when interruption follows start reply delivery", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, scope)
        )
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* Fiber.interrupt(pending)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("does not add cleanup when an abandoned start is later rejected", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, scope)
        )
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      yield* h.browser.receive({
        id: start.id,
        sessionId: start.sessionId,
        error: { code: -32000, message: "start rejected" }
      })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("bounds unresponsive stop confirmation independently of acquisition", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(
        Deadline.within("1 second"),
        Effect.provideService(Scope.Scope, scope)
      )
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
      yield* Queue.take(h.stops)
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(closing.pollUnsafe())
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(closing)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("closing the acquisition scope interrupts a pending metrics read before any start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      const metrics = yield* Queue.take(h.screenshotWork)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      const closedExit = acquiring.pollUnsafe()
      yield* replyMetrics(h.browser, metrics)
      yield* Fiber.await(acquiring)
      yield* TestClock.adjust("1 second")
      assert.isDefined(closedExit, "scope closure must interrupt acquisition without waiting for a metrics reply")
      assert(Exit.hasInterrupts(closedExit!))
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  it.effect("closing the acquisition scope cancels a blocked start write before cleanup can be overtaken", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.startWrites)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      const closedExit = acquiring.pollUnsafe()
      yield* TestClock.adjust("1 second")
      yield* Deferred.succeed(h.startWriteGate, undefined)
      yield* Fiber.await(acquiring)
      yield* TestClock.adjust("0 millis")
      assert.isDefined(closedExit, "scope closure must interrupt acquisition without waiting for the blocked write")
      assert(Exit.hasInterrupts(closedExit!))
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.startScreencast").length,
        0,
        "a canceled write must not dispatch start after its cleanup"
      )
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("bounds a blocked stop write and lets a new acquisition proceed afterward", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      yield* Queue.take(h.stopWrites)
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, second)
        )
      )
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      yield* TestClock.adjust("0 millis")
      const startsBeforeBudget = h.commands.filter((c) => c.method === "Page.startScreencast").length
      const earlyClose = closing.pollUnsafe()
      yield* TestClock.adjust("1 second")
      const boundedClose = closing.pollUnsafe()
      // Release the gate before asserting, so a regression cannot strand the test's closing fiber.
      yield* Deferred.succeed(h.stopWriteGate, undefined)
      yield* TestClock.adjust("0 millis")
      yield* Fiber.join(closing)
      yield* Fiber.join(acquiring)
      const stopsBeforeLastRelease = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* Scope.close(second, Exit.void)
      assert.isDefined(boundedClose, "the whole stop exchange, including its write, must be bounded")
      assert.strictEqual(startsBeforeBudget, 1, "a new start must wait for the previous stop exchange")
      assert.isUndefined(earlyClose)
      assert.strictEqual(stopsBeforeLastRelease, 0, "releasing the write gate cannot resurrect the canceled stop")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("interrupts acquisition promptly while a stop write is blocked without retaining ownership", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      yield* Queue.take(h.stopWrites)
      const acquiring = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      // This must finish before advancing time or releasing the blocked write.
      yield* Fiber.interrupt(acquiring)
      yield* TestClock.adjust("1 second")
      const boundedClose = closing.pollUnsafe()
      yield* Deferred.succeed(h.stopWriteGate, undefined)
      yield* Fiber.join(closing)
      yield* TestClock.adjust("1 second")
      assert.isDefined(boundedClose)
      assert.strictEqual(h.stopDeadlines.length, 1, "a canceled waiter never dispatched start and needs no later stop")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("waits for an in-flight stop confirmation before dispatching a newer start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      const stop = yield* Queue.take(h.stops)
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, second)
        )
      )
      yield* Queue.take(h.screenshotWork)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      yield* Fiber.join(closing)
      yield* Fiber.join(acquiring)
      const closingSecond = yield* Effect.forkScoped(Scope.close(second, Exit.void))
      const finalStop = yield* Queue.take(h.stops)
      yield* h.browser.receive({ id: finalStop.id, sessionId: finalStop.sessionId, result: {} })
      yield* Fiber.join(closingSecond)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 2)
    }).pipe(onTestClock))

  it.effect("releases an abandoned start with no reply without retaining a consumer count", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("cleans a late successful start observed during an earlier unconfirmed cleanup exchange", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      const uncertainStop = yield* Queue.take(h.stops)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* h.browser.receive({ id: uncertainStop.id, sessionId: uncertainStop.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      const stops = h.commands.filter((c) => c.method === "Page.stopScreencast")
      // Settle all held commands before asserting, including when this regresses to just one stop.
      for (const stop of stops.slice(1)) {
        yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      }
      yield* h.browser.delivered
      assert.strictEqual(stops.length, 2, "new success evidence during cleanup needs release after that exchange")
    }).pipe(onTestClock))

  it.effect("does not repeat cleanup of an unconfirmed start already covered by the last consumer's stop", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const scope = yield* Scope.make()
      const b = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* Fiber.join(b)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("drops an abandoned start on detach without scheduling further cleanup", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  for (const interruptAt of ["receipt", "consumed"] as const) {
    it.effect(`owns stop before interruption at start reply ${interruptAt}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(false, true)
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        let replies = 0
        let interrupt: () => void = () => {}
        const pending = yield* Effect.forkScoped(Effect.withFiber((fiber) => {
          interrupt = () => fiber.interruptUnsafe()
          return page.capability(Capability.Screencast).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.provideService(ProtocolClient.ReplyReceived, () => {
              if (++replies === 2 && interruptAt === "receipt") interrupt()
            }),
            Effect.tap(() => interruptAt === "consumed" ? Effect.sync(interrupt) : Effect.void)
          )
        }))
        yield* Queue.take(h.screenshotWork)
        const start = yield* Queue.take(h.screenshotWork)
        yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
        yield* Fiber.await(pending)
        yield* Scope.close(scope, Exit.void)
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(
          h.commands.filter((c) => c.method === "Page.stopScreencast").length,
          interruptAt === "receipt" ? 2 : 1
        )
      }).pipe(onTestClock))
  }

  it.effect("retains the stream during another consumer's metrics read and releases it if that read fails", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const a = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      )
      yield* replyMetrics(h.browser, yield* Queue.take(h.screenshotWork))
      yield* Queue.take(h.screenshotWork)
      yield* Fiber.join(a)
      const b = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second)))
      )
      const read = yield* Queue.take(h.screenshotWork)
      yield* Scope.close(first, Exit.void)
      const prematureStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* h.browser.receive({
        id: read.id,
        sessionId: read.sessionId,
        error: { code: -32000, message: "metrics rejected" }
      })
      assert(Exit.isFailure(yield* Fiber.join(b)))
      yield* Scope.close(second, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(prematureStops, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("preserves a live consumer when an overlapping pending start is rejected", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const a = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      )
      yield* Queue.take(h.screenshotWork)
      const startA = yield* Queue.take(h.screenshotWork)
      const b = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second)))
      )
      yield* Queue.take(h.screenshotWork)
      const startB = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({ id: startA.id, sessionId: startA.sessionId, result: {} })
      yield* Fiber.join(a)
      yield* h.browser.receive({
        id: startB.id,
        sessionId: startB.sessionId,
        error: { code: -32000, message: "rejected" }
      })
      assert(Exit.isFailure(yield* Fiber.join(b)))
      yield* Scope.close(second, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
      yield* Scope.close(first, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("requires a native start outcome before joining an abandoned start whose reply never arrived", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* replyMetrics(h.browser, yield* Queue.take(h.screenshotWork))
      yield* Queue.take(h.screenshotWork)
      const scope = yield* Scope.make()
      const b = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      const metrics = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      yield* replyMetrics(h.browser, metrics)
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      const starts = h.commands.filter((c) => c.method === "Page.startScreencast")
      if (starts.length > 1) {
        const start = starts[1]!
        yield* h.browser.receive({
          id: start.id,
          sessionId: start.sessionId,
          error: { code: -32000, message: "Screencast is already active" }
        })
      }
      yield* Fiber.join(b)
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(starts.length, 2, "an unconfirmed stream cannot be reused without native evidence")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("requires a fresh start when an abandoned success predates an already dispatched stop", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* replyMetrics(h.browser, yield* Queue.take(h.screenshotWork))
      const oldStart = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      const scope = yield* Scope.make()
      const b = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      const metrics = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({ id: oldStart.id, sessionId: oldStart.sessionId, result: {} })
      yield* h.browser.delivered
      yield* replyMetrics(h.browser, metrics)
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      const starts = h.commands.filter((c) => c.method === "Page.startScreencast")
      if (starts.length > 1) {
        const fresh = starts[1]!
        yield* h.browser.receive({ id: fresh.id, sessionId: fresh.sessionId, result: {} })
      }
      yield* Fiber.join(b)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(starts.length, 2, "a stop after the old start invalidates sharing its late success")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 2)
    }).pipe(onTestClock))

  it.effect("joins a confirmed session stream without sending another native start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
      yield* Scope.close(first, Exit.void)
      const earlyStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* Scope.close(second, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      assert.strictEqual(earlyStops, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  for (const previous of ["pending", "abandoned"] as const) {
    it.effect(`joins the native already-active stream of an earlier ${previous} start`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(false, true)
        const page = yield* h.page.control
        const first = yield* Scope.make()
        const second = yield* Scope.make()
        const a = yield* Effect.forkScoped(
          page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
        )
        yield* Queue.take(h.screenshotWork)
        const startA = yield* Queue.take(h.screenshotWork)
        const b = yield* Effect.forkScoped(
          page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
        )
        yield* Queue.take(h.screenshotWork)
        const startB = yield* Queue.take(h.screenshotWork)
        if (previous === "abandoned") yield* Fiber.interrupt(a)
        yield* h.browser.receive({
          id: startB.id,
          sessionId: startB.sessionId,
          error: { code: -32000, message: "Screencast is already active" }
        })
        yield* Fiber.join(b)
        yield* h.browser.receive({ id: startA.id, sessionId: startA.sessionId, result: {} })
        if (previous === "pending") yield* Fiber.join(a)
        yield* Scope.close(first, Exit.void)
        yield* TestClock.adjust("0 millis")
        const earlyStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
        yield* Scope.close(second, Exit.void)
        assert.strictEqual(earlyStops, 0)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      }).pipe(onTestClock))
  }

  it.effect("preserves already-active rejection when this session has no earlier owned start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope)))
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({
        id: start.id,
        sessionId: start.sessionId,
        error: { code: -32000, message: "Screencast is already active" }
      })
      const error = Exit.findErrorOption(yield* Fiber.join(acquiring))
      assert(Option.isSome(error) && Capability.isCapabilityError(error.value))
      assert.strictEqual(error.value.reason._tag, "BackendFailure")
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("1 second")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  // Page.stopScreencast is parameterless and session-wide, so a stop for one acquisition also ends another's frames.
  it.effect("keeps a newer acquisition streaming when an abandoned start succeeds late", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const abandoned = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      const first = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(first.method, "Page.startScreencast")
      yield* Fiber.interrupt(abandoned)
      yield* TestClock.adjust("0 millis")
      const beforeRetry = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      assert.strictEqual(beforeRetry, 1, "abandonment cleans uncertainty before a future consumer exists")

      const scope = yield* Scope.make()
      const retry = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      const second = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(second.method, "Page.startScreencast")

      // Chromium replies in order: the abandoned start first, once the retry's start is already sent
      yield* h.browser.receive({ id: first.id, sessionId: first.sessionId, result: {} })
      yield* h.browser.receive({ id: second.id, sessionId: second.sessionId, result: {} })
      yield* h.browser.delivered
      yield* Fiber.join(retry)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.stopScreencast").length,
        beforeRetry,
        "the retry's scope is open, so nothing may stop the session's screencast"
      )

      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, beforeRetry + 1)
    }).pipe(onTestClock))

  it.effect("keeps a second acquisition streaming when the first one's scope closes", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
      yield* Scope.close(first, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.stopScreencast").length,
        0,
        "the second scope is open, so nothing may stop the session's screencast"
      )
      yield* Scope.close(second, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("settles a dispatched start on session loss and closes its scope", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(Effect.exit(
        page.capability(Capability.Screencast).pipe(
          Deadline.within("1 second"),
          Effect.provideService(Scope.Scope, scope)
        )
      ))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(start.method, "Page.startScreencast")
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      const error = Exit.findErrorOption(yield* Fiber.join(pending))
      assert(Option.isSome(error) && Capability.isCapabilityError(error.value))
      assert.strictEqual(error.value.reason._tag, "BackendFailure")
      yield* Scope.close(scope, Exit.void)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  for (const terminal of ["reject", "malformed", "detach", "deadline", "interrupt"] as const) {
    it.effect(`prevents start after metrics ${terminal} and a late reply, closing the caller scope`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        const pending = yield* Effect.forkScoped(Effect.exit(
          page.capability(Capability.Screencast).pipe(
            Deadline.within("1 second"),
            Effect.provideService(Scope.Scope, scope)
          )
        ))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics")
        if (terminal === "deadline") yield* TestClock.adjust("1 second")
        if (terminal === "interrupt") yield* Fiber.interrupt(pending)
        if (terminal === "detach") {
          yield* h.browser.receive({
            method: "Target.detachedFromTarget",
            params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
          })
        }
        if (terminal === "reject") {
          yield* h.browser.receive({
            id: first.id,
            sessionId: first.sessionId,
            error: { code: -32000, message: "renderer metrics failed" }
          })
        }
        if (terminal === "malformed") yield* h.browser.receive({ id: first.id, sessionId: first.sessionId, result: {} })
        if (terminal !== "interrupt") {
          const exit = yield* Fiber.join(pending)
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          if (terminal === "deadline") {
            assert(Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          } else {
            assert(Capability.isCapabilityError(error.value))
            assert.strictEqual(error.value.reason._tag, "BackendFailure")
            if (error.value.reason._tag === "BackendFailure") {
              assert.strictEqual(error.value.reason.method, terminal === "detach" ? "unknown" : "Page.getLayoutMetrics")
              assert.strictEqual(
                error.value.reason.kind,
                terminal === "malformed" ? "IncompatibleResponse" : "Rejected"
              )
            }
          }
        }
        yield* Scope.close(scope, Exit.void)
        yield* replyMetrics(h.browser, first)
        yield* h.browser.delivered
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
      }).pipe(onTestClock))
  }
})
