/**
 * Stock WebKit launched in automation mode, through the public layer: `WebKit.layer`
 * with WebKitGTK's MiniBrowser (`browsers.ts`), a browser process per context, on an X server this process's
 * environment names (`stockWebKit.ts`), with Node's sockets (`sockets.ts`).
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Dialog, Expect, FileInput, Route } from "@usestrider/browser"
import { WebKit } from "@usestrider/browser/webkit"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Random from "effect/Random"
import * as Scope from "effect/Scope"
import { createServer, type Server } from "node:net"
import * as Launch from "../../src/internal/launch.ts"
import * as WebKitAutomation from "../../src/internal/webkitAutomation.ts"
import { site } from "./adapter/harness.ts"
import { webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

const timeout = 90_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** The reason a failed effect gave. */
const reasonOf = <A, E>(exit: Exit.Exit<A, E>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  return (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined) as
    | {
      readonly _tag: string
      readonly reason?: {
        readonly _tag: string
        readonly capability?: string
        readonly requested?: { readonly width: number; readonly height: number }
        readonly actual?: { readonly width: number; readonly height: number }
      }
    }
    | undefined
}

/** The MiniBrowser launched for an effect, on an X server of the effect's own. */
const launched = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  yield* useXvfb()
  return yield* effect.pipe(
    Effect.provide(
      WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector))
      )
    )
  )
}, Effect.scoped)

/** Register cleanup before binding, including failed or interrupted binds. */
const listen = Effect.fnUntraced(function*(server: Server, port: number) {
  yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
  yield* Effect.callback<void, Error>((resume) => {
    server.once("error", (error) => resume(Effect.fail(error)))
    server.listen(port, "127.0.0.1", () => resume(Effect.void))
  })
})

/**
 * Other sockets on ports the launcher can choose, as a full run's own connections can be, and a generator whose
 * choices land on them: for each entry of `taken`, one of those ports if true, otherwise the generator's own.
 */
const choosingTakenPorts = Effect.fnUntraced(function*(taken: ReadonlyArray<boolean>) {
  const random = yield* Random.Random
  const ports: Array<number | undefined> = []
  for (const isTaken of taken) {
    if (!isTaken) {
      ports.push(undefined)
      continue
    }
    const server = createServer()
    ports.push(
      yield* Effect.suspend(() => Random.nextIntBetween(49152, 65535)).pipe(
        Effect.tap((port) => listen(server, port)),
        // A port that is taken already is as good, but then this server has no port to name.
        Effect.retry({ times: 8 })
      )
    )
  }
  let choice = 0
  return {
    nextIntUnsafe: () => random.nextIntUnsafe(),
    nextDoubleUnsafe: () => {
      const port = ports[choice++]
      return port === undefined ? random.nextDoubleUnsafe() : (port - 49152 + 0.5) / (65536 - 49152)
    }
  }
})

const silentListenerCases: ReadonlyArray<
  { readonly name: string; readonly collisions: number; readonly taken: ReadonlyArray<boolean> }
> = [
  { name: "sends 1 real silent listeners nothing", collisions: 1, taken: [] },
  { name: "sends 2 real silent listeners nothing", collisions: 2, taken: [] },
  // The launcher moves on from a port another socket has, so the test must too when it chooses one first.
  { name: "sends 1 real silent listeners nothing, its first choice already taken", collisions: 1, taken: [true] },
  // Two listeners and two other sockets are four collisions, which the launcher's five attempts survive.
  {
    name: "sends 2 real silent listeners nothing, with two other ports taken after them",
    collisions: 2,
    taken: [false, false, true, true]
  }
]

describe("Stock WebKit, launched in automation mode", () => {
  layer(NodeServices.layer, { excludeTestServices: true, timeout })((it) => {
    for (const { collisions, name, taken } of silentListenerCases) {
      it.effect(
        `${name}, and starts the real MiniBrowser owned on another port`,
        () =>
          Effect.gen(function*() {
            yield* useXvfb()
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
            const received: Array<number> = []
            let accepted = 0
            const ports: Array<number> = []
            const held = new Set<number>()
            const listenersScope = yield* Scope.Scope
            const random = yield* choosingTakenPorts(taken)
            let first: number | undefined
            let choices = 0
            const observing = ChildProcessSpawner.make(Effect.fnUntraced(function*(command) {
              if (command._tag === "StandardCommand") {
                const endpoint = command.options.env?.["WEBKIT_INSPECTOR_SERVER"]
                if (endpoint !== undefined) {
                  const port = Number(endpoint.split(":")[1])
                  ports.push(port)
                  // Repeated choices hit the existing listener; they are not new collisions.
                  if (held.size < collisions && !held.has(port)) {
                    const sockets = new Set<import("node:net").Socket>()
                    const server = createServer((socket) => {
                      accepted++
                      sockets.add(socket)
                      socket.on("close", () => sockets.delete(socket))
                      socket.on("data", (data) => received.push(data.length))
                      socket.on("error", () => {})
                    })
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        for (const socket of sockets) socket.destroy()
                      })
                    ).pipe(Scope.provide(listenersScope))
                    yield* listen(server, port).pipe(Scope.provide(listenersScope), Effect.orDie)
                    held.add(port)
                  }
                }
              }
              return yield* spawner.spawn(command)
            }))
            yield* WebKitAutomation.start({ executablePath: webkitgtk.executable }).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observing),
              // Exercise a repeated random choice within the launcher's existing five attempts.
              Effect.provideService(Random.Random, {
                nextIntUnsafe: () => random.nextIntUnsafe(),
                nextDoubleUnsafe: () => {
                  choices++
                  if (choices === 2) return first!
                  const value = random.nextDoubleUnsafe()
                  first ??= value
                  return value
                }
              }),
              Effect.provide(socketConnector)
            )
            assert.strictEqual(held.size, collisions, "all deliberate listeners were bound")
            assert.strictEqual(ports[0], ports[1], "the repeated choice hits the same held listener")
            assert.isAtLeast(ports.length, collisions + 2)
            assert.isAtMost(ports.length, 5, "incidental collisions share the launcher's attempt budget")
            assert.isFalse(held.has(ports[ports.length - 1]!), "the successful child uses no held port")
            assert.deepStrictEqual(received, [], "nothing is written to the foreign listener")
            assert.strictEqual(accepted, 0, "nor is it connected to")
          }).pipe(Effect.scoped),
        timeout
      )
    }

    it.effect("fails a listener bind error and closes its scoped listeners", () =>
      Effect.gen(function*() {
        const server = createServer()
        const conflicting = createServer()
        const exit = yield* Effect.gen(function*() {
          yield* listen(server, 0)
          const address = server.address()
          assert.isNotNull(address)
          assert.isNotString(address)
          yield* listen(conflicting, (address as { port: number }).port)
        }).pipe(Effect.scoped, Effect.exit)
        assert.isTrue(Exit.isFailure(exit))
        assert.strictEqual(
          Option.getOrUndefined(Exit.findErrorOption(exit))?.message.includes("EADDRINUSE"),
          true
        )
        assert.isFalse(server.listening)
        assert.isFalse(conflicting.listening)
      }))

    it.effect(
      "refuses a real wrapper that forks the MiniBrowser rather than execing it",
      () =>
        Effect.gen(function*() {
          yield* useXvfb()
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-fork-wrapper-" })
          const executablePath = `${directory}/MiniBrowser`
          // No `exec`: the shell stays the spawned PID, and the browser, its child, holds the listener.
          yield* fs.writeFileString(executablePath, `#!/bin/sh\n"${webkitgtk.executable}" "$@"\nexit $?\n`)
          yield* fs.chmod(executablePath, 0o755)
          const exit = yield* WebKitAutomation.start({ executablePath, timeout: "3 seconds" }).pipe(
            Effect.provide(socketConnector),
            Effect.exit
          )
          const reason = reasonOf(exit)?.reason as { readonly _tag: string; readonly hint: string }
          assert.strictEqual(reason._tag, "ConnectionFailed")
          assert.include(reason.hint, "fork-only wrappers")
          assert.include(reason.hint, "WebKit.layerAttach")
        }).pipe(Effect.scoped),
      timeout
    )

    it.effect(
      "verifies the real Launch.spawn PID holds the pinned MiniBrowser inspector listener",
      () =>
        Effect.gen(function*() {
          yield* useXvfb()
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const children: Array<
            {
              readonly pid: number
              readonly port: number
              readonly executable: string
              readonly args: ReadonlyArray<string>
            }
          > = []
          const observing = ChildProcessSpawner.make(Effect.fnUntraced(function*(command) {
            const handle = yield* spawner.spawn(command)
            if (command._tag === "StandardCommand") {
              const endpoint = command.options.env?.["WEBKIT_INSPECTOR_SERVER"]
              if (endpoint !== undefined) {
                children.push({
                  pid: Number(handle.pid),
                  port: Number(endpoint.split(":")[1]),
                  executable: command.command,
                  args: command.args
                })
              }
            }
            return handle
          }))
          yield* WebKitAutomation.start({ executablePath: webkitgtk.executable }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observing),
            Effect.provide(socketConnector)
          )
          assert.strictEqual(children.length, 1)
          const child = children[0]!
          const [executable, args] = Launch.command(webkitgtk.executable, ["--automation"], false)
          assert.strictEqual(child.executable, executable)
          assert.deepStrictEqual(child.args, args)
          const inode = yield* WebKitAutomation.inspectorListener(child.pid, child.port)
          assert.isDefined(inode, "the exact spawned PID, including the exec wrapper, must hold the listener")
          yield* Effect.logInfo({ webkitOwnership: { ...child, inode, version: webkitgtk.version } })
        }).pipe(Effect.scoped),
      timeout
    )

    it.effect(
      "refuses a screen-constrained initial viewport without leaving a page",
      () =>
        launched(Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const context = yield* browser.newContext({ emulation: { viewport: { width: 1440, height: 1000 } } })
          const before = yield* context.pages
          const result = yield* Effect.exit(context.newPage)
          const error = reasonOf(result)
          // Pinned MiniBrowser has 38 pixels of chrome on the fixed 1280x800 screen.
          assert.deepInclude(error?.reason, {
            _tag: "ViewportMismatch",
            requested: { width: 1440, height: 1000 },
            actual: { width: 1280, height: 762 }
          })
          assert.deepStrictEqual(yield* context.pages, before)
        })),
      timeout
    )

    it.effect(
      "refuses a screen-constrained replacement and restores the previous effective viewport",
      () =>
        launched(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.emulate({ viewport: { width: 640, height: 480 } })
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
          const result = yield* Effect.scoped(page.emulate({ viewport: { width: 1440, height: 1000 } })).pipe(
            Effect.exit
          )
          const error = reasonOf(result)
          // Pinned MiniBrowser has 38 pixels of chrome on the fixed 1280x800 screen.
          assert.deepInclude(error?.reason, {
            _tag: "ViewportMismatch",
            requested: { width: 1440, height: 1000 },
            actual: { width: 1280, height: 762 }
          })
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
        })),
      timeout
    )

    it.effect("confirms an unchanged viewport immediately", () =>
      launched(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.emulate({ viewport: { width: 640, height: 480 } })
        yield* page.emulate({ viewport: { width: 640, height: 480 } })
        assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
      })), timeout)

    it.effect(
      "restores the prior viewport and disposes confirmation when interrupted",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>before</title>"))
          yield* page.emulate({ viewport: { width: 640, height: 480 } })
          yield* page.evaluateInMainWorld(() => {
            Object.defineProperty(globalThis, "innerWidth", {
              configurable: true,
              get: () => {
                document.title = "confirming"
                return document.documentElement.clientWidth
              }
            })
          })
          const fiber = yield* Effect.scoped(page.emulate({ viewport: { width: 1440, height: 1000 } })).pipe(
            Effect.forkChild
          )
          yield* page.pipe(Expect.toHaveTitle("confirming"))
          yield* Fiber.interrupt(fiber)
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() =>
              Object.getOwnPropertyNames(globalThis).filter((name) => name.startsWith("__striderViewport"))
            ),
            []
          )
        })),
      timeout
    )

    it.effect(
      "does not relabel navigation during confirmation as a viewport mismatch",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>before</title>"))
          yield* page.emulate({ viewport: { width: 640, height: 480 } })
          yield* page.evaluateInMainWorld((url) => {
            Object.defineProperty(globalThis, "innerWidth", {
              configurable: true,
              get: () => {
                queueMicrotask(() => {
                  location.href = url
                })
                return 0
              }
            })
          }, fixtureUrl(origin, "<title>after</title>"))
          const result = yield* Effect.scoped(page.emulate({ viewport: { width: 800, height: 600 } })).pipe(Effect.exit)
          assert.deepInclude(reasonOf(result)?.reason, { _tag: "BackendFailure" })
          yield* page.pipe(Expect.toHaveTitle("after"))
        })),
      timeout
    )

    it.effect("keeps a failed restoration visible", () =>
      launched(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.emulate({ viewport: { width: 640, height: 480 } })
        yield* page.evaluateInMainWorld(() => {
          const host = globalThis as unknown as Record<string, unknown>
          host["__originalInnerWidth"] = Object.getOwnPropertyDescriptor(globalThis, "innerWidth")
          Object.defineProperty(globalThis, "innerWidth", { configurable: true, get: () => 0 })
        })
        const result = yield* Effect.scoped(page.emulate({ viewport: { width: 800, height: 600 } })).pipe(Effect.exit)
        assert.isTrue(Exit.isFailure(result))
        if (Exit.isFailure(result)) {
          assert.include(Cause.pretty(result.cause), "WebKit viewport restoration failed")
          assert.isTrue(result.cause.reasons.some((reason) => reason._tag === "Die"))
        }
        // Remove the artificial measurement failure before the prior registration's finalizer.
        yield* page.evaluateInMainWorld(() => {
          const host = globalThis as unknown as Record<string, unknown>
          Object.defineProperty(globalThis, "innerWidth", host["__originalInnerWidth"] as PropertyDescriptor)
          delete host["__originalInnerWidth"]
        })
      })), timeout)

    it.effect(
      "warns without failing ordinary viewport release when restoration cannot be confirmed",
      () =>
        launched(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const registration = yield* page.emulate({ viewport: { width: 640, height: 480 } })
          yield* page.evaluateInMainWorld(() => {
            const host = globalThis as unknown as Record<string, unknown>
            host["__originalInnerWidth"] = Object.getOwnPropertyDescriptor(globalThis, "innerWidth")
            Object.defineProperty(globalThis, "innerWidth", { configurable: true, get: () => 0 })
          })
          const result = yield* registration.remove.pipe(Effect.exit)
          assert.strictEqual(result._tag, "Success")
          yield* page.evaluateInMainWorld(() => {
            const host = globalThis as unknown as Record<string, unknown>
            Object.defineProperty(globalThis, "innerWidth", host["__originalInnerWidth"] as PropertyDescriptor)
            delete host["__originalInnerWidth"]
          })
        })),
      timeout
    )

    it.effect("releases a viewport registration after its page has closed", () =>
      launched(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const registration = yield* page.emulate({ viewport: { width: 640, height: 480 } })
        yield* page.close()
        assert.strictEqual((yield* registration.remove.pipe(Effect.exit))._tag, "Success")
      })), timeout)

    it.effect(
      "restores a natural viewport when the first explicit override fails",
      () =>
        launched(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const natural = yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight])
          const result = yield* Effect.scoped(page.emulate({ viewport: { width: 1440, height: 1000 } })).pipe(
            Effect.exit
          )
          assert.deepInclude(reasonOf(result)?.reason, { _tag: "ViewportMismatch" })
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), natural)
        })),
      timeout
    )

    it.effect("restores every page after a context viewport override fails", () =>
      launched(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.newContext()
        yield* context.emulate({ viewport: { width: 640, height: 480 } })
        const first = yield* context.newPage
        const second = yield* context.newPage
        const result = yield* Effect.scoped(context.emulate({ viewport: { width: 1440, height: 1000 } })).pipe(
          Effect.exit
        )
        assert.deepInclude(reasonOf(result)?.reason, { _tag: "ViewportMismatch" })
        for (const page of [first, second]) {
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
        }
      })), timeout)

    it.effect(
      "names itself, has its first tab, and drives a page with input the page trusts",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          const browser = yield* Browser.Browser
          assert.strictEqual(browser.info.product, "MiniBrowser (stock WebKit)")
          assert.strictEqual(browser.info.version, webkitgtk.version)
          // The browser's own first window, observed, as on every backend (Q141)
          assert.strictEqual((yield* browser.defaultContext.pages).length, 1)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<title>Form</title><h1>Hello</h1><button onclick="document.querySelector('h1').textContent = 'clicked ' + event.isTrusted">Go</button><input id=name>`
            ))
            yield* page.getByRole("button", { name: "Go" }).click()
            yield* page.locator("h1").pipe(Expect.toHaveText("clicked true"))
            yield* page.locator("#name").fill("hé@")
            yield* page.locator("#name").press("A")
            assert.strictEqual(yield* page.locator("#name").readValue, "hé@A")
            const png = yield* page.screenshot()
            assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47])
            assert.strictEqual(yield* page.title, "Form")
          }))
        })),
      timeout
    )

    it.effect(
      "reports a dialog with its message and an unknown kind, and answers it",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<title>Ask</title><button onclick="document.title = String(confirm('sure?'))">Ask</button><button onclick="document.title = String(prompt('name?', 'Ada'))">Name</button>`
            ))
            const seen: Array<Dialog.Dialog> = []
            yield* Dialog.handle(page, (dialog) =>
              Effect.suspend(() => {
                seen.push(dialog)
                return dialog._tag === "Unknown" && dialog.message === "name?"
                  ? dialog.respond("Grace")
                  : dialog._tag === "BeforeUnload"
                  ? dialog.leave
                  : dialog.accept
              }))
            yield* page.getByRole("button", { name: "Ask" }).click()
            yield* page.pipe(Expect.toHaveTitle("true"))
            yield* page.getByRole("button", { name: "Name" }).click()
            yield* page.pipe(Expect.toHaveTitle("Grace"))
            // Stock WebKit says a dialog is open and what it says, not which kind (Q206)
            assert.deepStrictEqual(seen.map((dialog) => [dialog._tag, "message" in dialog ? dialog.message : ""]), [
              ["Unknown", "sure?"],
              ["Unknown", "name?"]
            ])
          }))
        })),
      timeout
    )

    it.effect(
      "makes each context a browser process of its own, with its own cookies and viewport",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const first = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
            const second = yield* Browser.newPage()
            yield* first.goto(fixtureUrl(origin, "<title>first</title>"))
            yield* second.goto(fixtureUrl(origin, "<title>second</title>"))
            yield* first.evaluateInMainWorld(() => {
              document.cookie = "who=first"
            })
            assert.strictEqual(yield* first.evaluateInMainWorld(() => document.cookie), "who=first")
            assert.strictEqual(yield* second.evaluateInMainWorld(() => document.cookie), "")
            // The window is sized so the page's viewport is the one asked for
            assert.deepStrictEqual(yield* first.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
            const cookies = yield* first.context.cookies.list
            assert.isTrue(cookies.some((cookie) => cookie.name === "who"))
          }))
        })),
      timeout
    )

    it.effect("sets a file input's files, and routes a page's requests", () =>
      launched(Effect.gen(function*() {
        const { origin } = yield* site
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-upload-" })
        yield* fs.writeFileString(`${dir}/note.txt`, "abc")
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.route(
            `${origin}/made-up`,
            () =>
              Route.fulfill(
                HttpServerResponse.text("<title>made</title><h1>Made</h1>", { status: 201, contentType: "text/html" })
              )
          )
          const made = yield* page.goto(`${origin}/made-up`)
          assert(made._tag === "Committed" && Option.isSome(made.response))
          assert.strictEqual(made.response.value.status, 201)
          yield* page.goto(fixtureUrl(
            origin,
            `<title>Upload</title><input type=file id=f><p id=out></p><script>f.onchange = () => { out.textContent = [...f.files].map((file) => file.name + ':' + file.size).join(',') }</script>`
          ))
          yield* page.locator("#f").setInputFiles(FileInput.local(`${dir}/note.txt`))
          yield* page.locator("#out").pipe(Expect.toHaveText("note.txt:3"))
        }))
      })), timeout)

    it.effect("refuses what stock WebKit can't do, saying so", () =>
      launched(Effect.gen(function*() {
        const { origin } = yield* site
        const capabilities = yield* (yield* Browser.Browser).capabilities
        const status = (name: string) => capabilities.entries.find((entry) => entry.name === name)?.status
        assert.strictEqual(status("userContexts"), "supported")
        assert.strictEqual(status("input.native"), "supported")
        assert.strictEqual(status("isolatedWorlds"), "unsupported")
        assert.strictEqual(status("navigation.traverse"), "unsupported")
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>one</title>"))
          yield* page.goto(fixtureUrl(origin, "<title>two</title>"))
          // A traversal its inspector misreports (Q215)
          const back = reasonOf(yield* Effect.exit(page.back()))
          assert.strictEqual(back?.reason?.capability, "navigation.traverse")
          // A caller's function never moves to the page's world
          const evaluated = reasonOf(yield* Effect.exit(page.evaluate(() => document.title)))
          assert.strictEqual(evaluated?.reason?.capability, "isolatedWorlds")
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.title), "two")
        }))
      })), timeout)
  })
})
