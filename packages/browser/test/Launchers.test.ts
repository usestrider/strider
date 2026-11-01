/**
 * The launchers, without a browser: the executable each accepts (an absolute path, and nothing looked up), the
 * arguments and profiles it passes, and how it fails. The integration tests launch the real browsers.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Schedule from "effect/Schedule"
import * as Sink from "effect/Sink"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import { readFile } from "node:fs/promises"
import * as ChromiumLauncher from "../src/internal/chromiumLauncher.ts"
import * as FirefoxLauncher from "../src/internal/firefoxLauncher.ts"
import * as Launch from "../src/internal/launch.ts"
import * as WebKitAutomation from "../src/internal/webkitAutomation.ts"
import * as SocketConnector from "../src/protocol/SocketConnector.ts"

describe("Chromium launcher", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("fails with ExecutableNotFound for a path where nothing is, pointing to strider browsers", () =>
      Effect.gen(function*() {
        const error = yield* ChromiumLauncher.launch({ executablePath: "/nowhere/chrome" }).pipe(Effect.flip)
        assert(error.reason._tag === "ExecutableNotFound")
        assert.deepStrictEqual(error.reason.searched, ["/nowhere/chrome"])
        assert.include(error.reason.hint, "strider browsers")
      }))

    it.effect("fails with InvalidInput, looking nowhere, for a relative path, a command name or no path", () =>
      Effect.gen(function*() {
        const untyped = [
          { executablePath: "chromium" },
          { executablePath: "./browsers/chrome" },
          {}
        ] as unknown as ReadonlyArray<ChromiumLauncher.Options>
        for (const options of untyped) {
          const error = yield* ChromiumLauncher.launch(options).pipe(Effect.flip)
          assert(error.reason._tag === "InvalidInput")
          assert.strictEqual(error.reason.input, "executablePath")
          assert.include(error.reason.hint, "strider browsers")
        }
      }))

    it.effect("takes a path as absolute on POSIX and on Windows", () =>
      Effect.sync(() => {
        for (
          const path of ["/usr/bin/chromium", "C:\\Chrome\\chrome.exe", "c:/chrome.exe", "\\\\host\\share\\chrome.exe"]
        ) {
          assert.isTrue(Launch.isAbsolute(path), path)
        }
        for (const path of ["chromium", "./chrome", "bin/chrome", "C:chrome.exe", ""]) {
          assert.isFalse(Launch.isAbsolute(path), path)
        }
      }))

    it.effect("passes the profile's arguments, then the caller's, then its own", () =>
      Effect.sync(() => {
        const args = ChromiumLauncher.argsFor({ profile: "concurrent", args: ["--lang=de"] }, "/profile", "pipe")
        assert.include(args, "--disable-renderer-backgrounding")
        assert.isBelow(args.indexOf("--no-first-run"), args.indexOf("--lang=de"))
        assert.deepStrictEqual(args.slice(-3), ["--remote-debugging-pipe", "--user-data-dir=/profile", "about:blank"])
        assert.notInclude(
          ChromiumLauncher.argsFor({ profile: "stock", headless: false }, "/p", "pipe"),
          "--no-first-run"
        )
      }))

    it.effect("reports a browser that exits before it is ready, with its exit code and stderr", () =>
      Effect.gen(function*() {
        const failing = "/bin/sh"
        const launched = yield* Launch.spawn(failing, ["-c", "echo broken profile >&2; exit 3"], "/tmp", {})
        yield* launched.handle.exitCode.pipe(Effect.ignore)
        const error = yield* Launch.notReady(launched, "connecting").pipe(Effect.flip)
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(3))
        assert.include(error.reason.stderrTail, "broken profile")
      }))

    it.effect("finds a stderr line written before it looked, and none once stderr ends without one", () =>
      Effect.gen(function*() {
        const launched = yield* Launch.spawn(
          "/bin/sh",
          ["-c", "printf 'starting\\nlistening on ws://127.0.0.1:9/session\\npartial' >&2"],
          "/tmp",
          {}
        )
        yield* launched.handle.exitCode.pipe(Effect.ignore)
        const listening = yield* launched.stderrLine(/listening on (ws:\/\/\S+)/)
        assert.strictEqual(Option.getOrThrow(listening)[1], "ws://127.0.0.1:9/session")
        // The lines before the first call were kept for it alone
        assert(Option.isNone(yield* launched.stderrLine(/starting/)))
        assert.strictEqual(yield* launched.stderrTail, "starting\nlistening on ws://127.0.0.1:9/session\npartial")
      }))
  })
})

describe("Firefox launcher", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("fails with ExecutableNotFound for a browser that isn't there, naming what it searched", () =>
        Effect.gen(function*() {
          const error = yield* FirefoxLauncher.launch({ executablePath: "/nowhere/firefox" }).pipe(Effect.flip)
          assert(error.reason._tag === "ExecutableNotFound")
          assert.deepStrictEqual(error.reason.searched, ["/nowhere/firefox"])
        }))

      it.effect("writes the profile's preferences", () =>
        Effect.sync(() => {
          assert.include(
            FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.automation),
            `user_pref("app.update.disabledForTesting", true);`
          )
          assert.strictEqual(FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.stock), "")
          assert.include(FirefoxLauncher.argsFor({}, "/p"), "--headless")
        }))

      it.effect("keeps the preferences a profile of the caller's already sets, and replaces its own", () =>
        Effect.sync(() => {
          const prefs = { "browser.startup.page": 0 }
          const mine = `user_pref("browser.startup.homepage", "https://example.com");\n`
          const once = FirefoxLauncher.profileUserJs(mine, prefs)
          assert.isTrue(once.startsWith(mine))
          assert.include(once, `user_pref("browser.startup.page", 0);`)
          // A second launch replaces the block instead of adding another
          assert.strictEqual(FirefoxLauncher.profileUserJs(once, prefs), once)
          // A profile with no preferences of Strider's gives back the caller's lines alone
          assert.strictEqual(FirefoxLauncher.profileUserJs(once, {}), mine)
          assert.strictEqual(FirefoxLauncher.profileUserJs("", {}), "")
        }))
    }
  )
})

describe("WebKit launcher", () => {
  // Nothing here reaches a socket: a launch fails before it would open one
  const services = Layer.merge(
    NodeServices.layer,
    SocketConnector.layer(() => Effect.die(new Error("no socket in these tests")))
  )
  layer(services, { excludeTestServices: true })((it) => {
    it.effect("does not start a session on an occupied inspector port before its child reports the collision", () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
        const executablePath = `${directory}/MiniBrowser`
        yield* fs.writeFileString(executablePath, "")
        yield* fs.chmod(executablePath, 0o755)
        const connections = new Map<number, Deferred.Deferred<void>>()
        let writes = 0
        const spawner = ChildProcessSpawner.make((command) =>
          Effect.gen(function*() {
            assert(command._tag === "StandardCommand")
            const endpoint = command.options.env?.["WEBKIT_INSPECTOR_SERVER"]
            assert.isString(endpoint)
            const connected = yield* Deferred.make<void>()
            connections.set(Number(endpoint!.split(":")[1]), connected)
            // ROOK-140: the existing server accepts before the new child reports EADDRINUSE.
            const stderr = Stream.fromEffect(Deferred.await(connected)).pipe(
              Stream.map(() => new TextEncoder().encode(`Failed to start remote inspector server on ${endpoint}\n`)),
              Stream.concat(Stream.never)
            )
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr,
              all: stderr,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void)
            })
          })
        )
        const write = () =>
          Effect.andThen(
            Effect.sync(() => writes++),
            Effect.fail(
              new Socket.SocketError({
                reason: new Socket.SocketWriteError({ cause: "The occupied server is not this child's inspector" })
              })
            )
          )
        const connector: SocketConnector.SocketConnector = {
          connect: ({ port }) =>
            Effect.sync(() => {
              const connected = connections.get(port)
              assert.isDefined(connected)
              Deferred.doneUnsafe(connected!, Effect.void)
              return { pull: Effect.never, upgrade: () => Effect.void, write, writeAll: write, close: Effect.void }
            })
        }
        yield* WebKitAutomation.start({ executablePath }).pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(SocketConnector.SocketConnector, connector),
          Effect.flip
        )
        assert.strictEqual(writes, 0, "must not send StartAutomationSession to another browser's inspector")
      }))

    it.effect("launches the MiniBrowser in automation mode, and nothing else", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          WebKitAutomation.automationArguments("/usr/libexec/webkitgtk-6.0/MiniBrowser"),
          Option.some(["--automation"])
        )
        assert.isTrue(Option.isNone(WebKitAutomation.automationArguments("/usr/bin/epiphany")))
      }))

    it.effect("fails with ExecutableNotFound for a path that doesn't exist", () =>
      Effect.gen(function*() {
        const error = yield* Effect.scoped(WebKitAutomation.start({ executablePath: "/nowhere/MiniBrowser" })).pipe(
          Effect.flip
        )
        assert(error.reason._tag === "ExecutableNotFound")
        assert.deepStrictEqual(error.reason.searched, ["/nowhere/MiniBrowser"])
      }))

    it.effect("fails with InvalidInput for another executable, and for headless", () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
        yield* fs.writeFileString(`${directory}/epiphany`, "#!/bin/sh\nexit 1\n")
        yield* fs.chmod(`${directory}/epiphany`, 0o755)
        const other = yield* Effect.scoped(WebKitAutomation.start({ executablePath: `${directory}/epiphany` })).pipe(
          Effect.flip
        )
        assert.deepInclude(other.reason, { _tag: "InvalidInput", input: "executablePath" })
        const headless = yield* Effect.scoped(
          WebKitAutomation.start({ executablePath: `${directory}/MiniBrowser`, headless: true })
        ).pipe(Effect.flip)
        assert.deepInclude(headless.reason, { _tag: "InvalidInput", input: "headless" })
      }))
  })

  // A browser that never starts its inspector server: each connection is refused
  const refusing = Layer.merge(
    NodeServices.layer,
    SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))
  )
  layer(refusing, { excludeTestServices: true })((it) => {
    it.effect.skipIf(process.platform === "win32")(
      "gives up on a browser that never answers at its timeout",
      () =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
          yield* fs.writeFileString(`${directory}/MiniBrowser`, "#!/bin/sh\nexec sleep 30\n")
          yield* fs.chmod(`${directory}/MiniBrowser`, 0o755)
          const started = performance.now()
          const error = yield* Effect.scoped(
            WebKitAutomation.start({ executablePath: `${directory}/MiniBrowser`, timeout: "500 millis" })
          ).pipe(Effect.flip)
          assert.include(JSON.stringify(error.reason), "never answered")
          assert.isBelow(performance.now() - started, 5000)
        })
    )
  })
})

describe("Core dumps", () => {
  it("starts a browser through sh, with the executable and its arguments as parameters, unless dumps are on", () => {
    assert.deepStrictEqual(Launch.command("/opt/b rowser", ["--a", "$(x)"], true), ["/opt/b rowser", ["--a", "$(x)"]])
    assert.deepStrictEqual(Launch.command("/opt/browser", ["--a", "; rm -rf /"], false, "linux"), [
      "/bin/sh",
      ["-c", "ulimit -c 0; exec \"$@\"", "sh", "/opt/browser", "--a", "; rm -rf /"]
    ])
    // Windows has no limit to lower and no sh
    assert.deepStrictEqual(Launch.command("C:\\chrome.exe", ["--a"], false, "win32"), ["C:\\chrome.exe", ["--a"]])
  })

  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    const limitOf = (pid: string, name: string) =>
      Effect.promise(() => readFile(`/proc/${pid}/limits`, "utf8")).pipe(
        Effect.map((text) =>
          text.split("\n").find((line) => line.startsWith(name))?.slice(name.length).trim().replace(/\s+/g, " ")
        )
      )

    // The process that is exec'd last is a node that waits, in place of a browser
    const waiting = Effect.fnUntraced(function*(coreDumps: boolean | undefined) {
      const launched = yield* Launch.spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], "/tmp", {
        coreDumps
      })
      const pid = String(launched.handle.pid)
      // Until the shell has exec'd, the process is the shell: its command line says so
      yield* Effect.promise(() => readFile(`/proc/${pid}/cmdline`, "utf8")).pipe(
        Effect.filterOrFail((line) => !line.startsWith("/bin/sh")),
        Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 500 })
      )
      return { launched, pid }
    })

    it.effect.skipIf(process.platform !== "linux")(
      "has no core dump limit by default, in the process that was started",
      () =>
        Effect.gen(function*() {
          for (const coreDumps of [undefined, false]) {
            const { launched, pid } = yield* waiting(coreDumps)
            assert.strictEqual(pid, String(launched.handle.pid))
            assert.strictEqual(yield* limitOf(pid, "Max core file size"), "0 0 bytes")
            assert.isTrue(yield* launched.handle.isRunning)
          }
        })
    )

    it.effect.skipIf(process.platform !== "linux")(
      "leaves the limit as it was with coreDumps",
      () =>
        Effect.gen(function*() {
          const { pid } = yield* waiting(true)
          assert.strictEqual(yield* limitOf(pid, "Max core file size"), yield* limitOf("self", "Max core file size"))
        })
    )
  })
})
