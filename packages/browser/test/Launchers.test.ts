/**
 * The launchers, without a browser: the executable each accepts (an absolute path, and nothing looked up), the
 * arguments and profiles it passes, and how it fails. The integration tests launch the real browsers.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it, layer } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Random from "effect/Random"
import * as Schedule from "effect/Schedule"
import * as Sink from "effect/Sink"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import { readFile } from "node:fs/promises"
import * as Adapter from "../src/internal/adapter.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as ChromiumLauncher from "../src/internal/chromiumLauncher.ts"
import * as FirefoxLauncher from "../src/internal/firefoxLauncher.ts"
import * as Launch from "../src/internal/launch.ts"
import * as Operation from "../src/internal/operation.ts"
import * as WebKitAutomation from "../src/internal/webkitAutomation.ts"
import * as SocketConnector from "../src/protocol/SocketConnector.ts"
import type * as UserContext from "../src/UserContext.ts"

/** A scoped process-platform stub for fake launchers; no production override or public bypass. */
const onPlatform = (platform: NodeJS.Platform) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!
      Object.defineProperty(process, "platform", { ...descriptor, value: platform })
      return descriptor
    }),
    () => effect,
    (descriptor) =>
      Effect.sync(() => {
        Object.defineProperty(process, "platform", descriptor)
      })
  )

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
            // The existing server accepts before the new child reports EADDRINUSE.
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
        // The new child has not bound any listener. In the unfixed launcher the successful connector still wins.
        const procfs: FileSystem.FileSystem = {
          ...fs,
          readFileString: (path, options) =>
            path === "/proc/1/net/tcp"
              ? Effect.succeed(
                "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n"
              )
              : fs.readFileString(path, options),
          readDirectory: (path, options) => path === "/proc/1/fd" ? Effect.succeed([]) : fs.readDirectory(path, options)
        }
        yield* WebKitAutomation.start({ executablePath, timeout: "50 millis" }).pipe(onPlatform("linux")).pipe(
          Effect.provideService(FileSystem.FileSystem, procfs),
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(SocketConnector.SocketConnector, connector),
          Effect.flip
        )
        assert.strictEqual(writes, 0, "must not send StartAutomationSession to another browser's inspector")
      }))

    interface OwnershipProgress {
      readonly failed: Deferred.Deferred<void>
      readonly connectionClosed: Deferred.Deferred<void>
      readonly events: ReadonlyArray<string>
      readonly reads: () => number
      readonly stops: () => number
    }

    const ownershipAttempt = Effect.fnUntraced(
      function*(
        mode:
          | "owned"
          | "replaced"
          | "unreadable"
          | "foreign"
          | "collision"
          | "unreadable-after"
          | "unreadable-collision",
        around: (
          start: Effect.Effect<Launch.LaunchError, WebKitAutomation.Group>,
          progress: OwnershipProgress
        ) => Effect.Effect<Launch.LaunchError, WebKitAutomation.Group> = (start) => start
      ) {
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
        const executablePath = `${directory}/MiniBrowser`
        yield* fs.writeFileString(executablePath, "")
        const failed = yield* Deferred.make<void>()
        const connectionClosed = yield* Deferred.make<void>()
        const events: Array<string> = []
        let reads = 0
        let port = 0
        let inode = "12345"
        let spawned = 0
        let stopped = 0
        let connected = 0
        let closed = 0
        let writes = 0
        let inspected = yield* Deferred.make<void>()
        const spawner = ChildProcessSpawner.make((command) =>
          Effect.gen(function*() {
            assert(command._tag === "StandardCommand")
            port = Number(command.options.env!["WEBKIT_INSPECTOR_SERVER"]!.split(":")[1])
            spawned++
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                stopped++
              })
            )
            inspected = yield* Deferred.make<void>()
            const stderr = mode === "collision" || mode === "unreadable-collision"
              ? Stream.fromEffect(Deferred.await(mode === "collision" ? inspected : failed)).pipe(
                Stream.map(() =>
                  new TextEncoder().encode(`Failed to start remote inspector server on 127.0.0.1:${port}\n`)
                ),
                Stream.concat(Stream.never)
              )
              : Stream.never
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(9000001),
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
        const procfs: FileSystem.FileSystem = {
          ...fs,
          readFileString: (path, options) =>
            path === "/proc/9000001/net/tcp"
              ? Effect.suspend(() => {
                events.push("read")
                reads++
                if (
                  mode === "unreadable" || mode === "unreadable-collision" ||
                  (mode === "unreadable-after" && connected > 0)
                ) {
                  events.push("access-failed")
                  Deferred.doneUnsafe(failed, Effect.void)
                  return Effect.fail(PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFileString",
                    pathOrDescriptor: path
                  }))
                }
                Deferred.doneUnsafe(inspected, Effect.void)
                return Effect.succeed(
                  `sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n 0: 0100007F:${
                    port.toString(16).toUpperCase().padStart(4, "0")
                  } 00000000:0000 0A 0:0 00:0 0 1000 0 ${inode}\n`
                )
              })
              : fs.readFileString(path, options),
          readDirectory: (path, options) =>
            path === "/proc/9000001/fd" ? Effect.succeed(["7"]) : fs.readDirectory(path, options),
          readLink: (path) =>
            path === "/proc/9000001/fd/7"
              ? Effect.succeed(`socket:[${mode === "foreign" || mode === "collision" ? "99999" : inode}]`)
              : fs.readLink(path)
        }
        const connector: SocketConnector.SocketConnector = {
          connect: Effect.fnUntraced(function*() {
            connected++
            events.push("connect")
            if (mode === "replaced") inode = "54321"
            let isClosed = false
            const close = Effect.sync(() => {
              if (!isClosed) {
                isClosed = true
                closed++
                events.push("closed")
                Deferred.doneUnsafe(connectionClosed, Effect.void)
              }
            })
            yield* Effect.addFinalizer(() => close)
            const write = () =>
              Effect.andThen(
                Effect.sync(() => writes++),
                Effect.fail(
                  new Socket.SocketError({
                    reason: new Socket.SocketWriteError({ cause: "stop after the first safe write" })
                  })
                )
              )
            return { pull: Effect.never, upgrade: () => Effect.void, write, writeAll: write, close }
          })
        }
        const start = WebKitAutomation.start({ executablePath, timeout: "50 millis" }).pipe(onPlatform("linux"))
          .pipe(
            Effect.scoped,
            Effect.provideService(FileSystem.FileSystem, procfs),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(SocketConnector.SocketConnector, connector),
            Effect.flip
          )
        const error = yield* around(start, {
          failed,
          connectionClosed,
          events,
          reads: () => reads,
          stops: () => stopped
        })
        return { error, spawned, stopped, connected, closed, writes }
      }
    )

    for (
      const [mode, stages] of [
        ["unreadable", ["spawned"]],
        ["unreadable-after", ["spawned", "listener verified", "connected"]],
        ["owned", ["spawned", "listener verified", "connected", "inspector established"]]
      ] as const
    ) {
      it.effect(`reports completed startup stages and times for ${mode} without changing cleanup`, () =>
        Effect.gen(function*() {
          const result = yield* ownershipAttempt(mode)
          const message = result.error.message
          assert.include(message, "WebKit startup (port ")
          const reached = Array.from(
            message.matchAll(/(spawned|listener verified|connected|inspector established) at ([0-9.]+)ms/g)
          )
          assert.deepStrictEqual(reached.map((match) => match[1]), [...stages])
          const times = reached.map((match) => Number(match[2]))
          assert(times.every((time, index) => time >= 0 && (index === 0 || time >= times[index - 1]!)))
          assert.strictEqual(result.stopped, 1)
          assert.strictEqual(result.closed, result.connected)
          assert(result.error.reason._tag === "ConnectionFailed")
          assert.include(
            result.error.reason.hint,
            mode === "owned" ? "The connection was lost" : "Cannot read Linux procfs"
          )
        }))
    }

    it.effect("writes only after the same spawned PID holds the listener across connecting", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("owned")
        assert.strictEqual(result.writes, 1)
        assert.strictEqual(result.connected, 1)
        assert.strictEqual(result.closed, 1)
        assert.strictEqual(result.stopped, 1)
      }))

    it.effect("refuses a replacement listener and closes its connection without writing", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("replaced")
        assert.strictEqual(result.writes, 0)
        assert.strictEqual(result.connected, 1)
        assert.strictEqual(result.closed, 1)
        assert.strictEqual(result.stopped, 1)
        assert(result.error.reason._tag === "ConnectionFailed")
        assert.include(result.error.reason.hint, "same inspector listener")
        assert.include(result.error.reason.hint, "WebKit.layerAttach")
      }))

    it.effect("refuses unreadable procfs with attach guidance before connecting", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("unreadable")
        assert.strictEqual(result.connected, 0)
        assert.strictEqual(result.stopped, 1)
        assert(result.error.reason._tag === "ConnectionFailed")
        assert.include(result.error.reason.hint, "Cannot read Linux procfs")
        assert.include(result.error.reason.hint, "WebKit.layerAttach")
      }))

    it.effect("closes a connection when the second procfs check fails", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("unreadable-after")
        assert.strictEqual(result.writes, 0)
        assert.strictEqual(result.connected, 1)
        assert.strictEqual(result.closed, 1)
        assert.strictEqual(result.stopped, 1)
        assert(result.error.reason._tag === "ConnectionFailed")
        assert.include(result.error.reason.hint, "Cannot read Linux procfs")
      }))

    for (const mode of ["unreadable", "unreadable-after", "unreadable-collision"] as const) {
      it.effect(`waits on the original deadline after ${mode} procfs, with cleanup before waiting`, () =>
        Effect.gen(function*() {
          const expire = yield* Deferred.make<void>()
          const armed = yield* Deferred.make<void>()
          const sleeps: Array<number> = []
          const descriptor = Object.getOwnPropertyDescriptor(BrowserClock.live, "sleep")!
          const result = yield* Effect.acquireUseRelease(
            Effect.sync(() =>
              Object.defineProperty(BrowserClock.live, "sleep", {
                ...descriptor,
                value: (millis: number) => {
                  sleeps.push(millis)
                  Deferred.doneUnsafe(armed, Effect.void)
                  return Deferred.await(expire)
                }
              })
            ),
            () =>
              ownershipAttempt(
                mode,
                Effect.fnUntraced(
                  function*(
                    start: Effect.Effect<Launch.LaunchError, WebKitAutomation.Group>,
                    progress: OwnershipProgress
                  ) {
                    const fiber = yield* Effect.forkChild(start)
                    yield* Deferred.await(progress.failed)
                    if (mode === "unreadable-after") yield* Deferred.await(progress.connectionClosed)
                    yield* Deferred.await(armed)
                    // Longer than the 100 ms readiness poll, so a resumed ownership attempt would show in `reads`.
                    const finished = yield* Fiber.await(fiber).pipe(Effect.timeoutOption("250 millis"))
                    assert.isTrue(Option.isNone(finished), "the controlled launch deadline has not expired")
                    assert.strictEqual(
                      progress.stops(),
                      0,
                      "the child remains available for exit observation until the deadline"
                    )
                    assert.strictEqual(sleeps.length, 1, "no timer or budget is restarted after the error")
                    assert.isAbove(sleeps[0]!, 0)
                    assert.isAtMost(sleeps[0]!, 50, "only the configured budget's remaining time is used")
                    assert.strictEqual(progress.reads(), mode === "unreadable-after" ? 2 : 1)
                    assert.deepStrictEqual(
                      progress.events,
                      mode !== "unreadable-after"
                        ? ["read", "access-failed"]
                        : ["read", "connect", "read", "access-failed", "closed"]
                    )
                    yield* Deferred.succeed(expire, undefined)
                    return yield* Fiber.join(fiber)
                  }
                )
              ),
            () =>
              Effect.sync(() => {
                Object.defineProperty(BrowserClock.live, "sleep", descriptor)
              })
          )
          assert(result.error.reason._tag === "ConnectionFailed")
          assert.strictEqual(result.error.reason.stage, "refused")
          assert.include(
            result.error.reason.hint,
            "PermissionDenied: FileSystem.readFileString (/proc/9000001/net/tcp)"
          )
          assert.include(result.error.reason.hint, "WebKit.layerAttach")
          assert.strictEqual(result.spawned, 1)
          assert.strictEqual(result.stopped, 1)
          assert.strictEqual(result.writes, 0)
        }))
    }

    it.effect("refuses a listener not held by the spawned PID without looking for descendants", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("foreign")
        assert.strictEqual(result.connected, 0)
        assert.strictEqual(result.stopped, 1)
        assert(result.error.reason._tag === "ConnectionFailed")
        assert.include(result.error.reason.hint, "fork-only wrappers")
        assert.include(result.error.reason.hint, "WebKit.layerAttach")
      }))

    it.effect("cleans up each of the existing five collision attempts without connecting", () =>
      Effect.gen(function*() {
        const result = yield* ownershipAttempt("collision")
        assert.strictEqual(result.spawned, 5)
        assert.strictEqual(result.stopped, 5)
        assert.strictEqual(result.connected, 0)
        assert.strictEqual(result.writes, 0)
        assert(result.error.reason._tag === "ConnectionFailed")
        assert.include(result.error.reason.hint, "Five ports")
      }))

    /** A fake MiniBrowser whose ownership each spawn's behavior decides, and what the launch did to it. */
    const scriptedLaunch = Effect.fnUntraced(function*(
      behavior: (spawn: number) => {
        readonly held: boolean
        readonly silentSession?: boolean | undefined
        readonly foreign?: boolean | undefined
        readonly collides?: boolean | undefined
        readonly vanishes?: boolean | undefined
        readonly vanishesAfterConnect?: boolean | undefined
        readonly exitsBeforePolling?: boolean | undefined
        /** Procfs already lost the child, but Node hasn't reported its exit yet. */
        readonly vanishesBeforeExitEvent?: boolean | undefined
        /** Its stderr ended, as a child's does when it exits, but Node hasn't reported its exit yet. */
        readonly stderrEndsBeforeExitEvent?: boolean | undefined
        readonly stderrClosesAlive?: boolean | undefined
        /** An exiting child's descriptors are denied before Node reports its exit, as seen on a real child. */
        readonly fdDeniedBeforeExitEvent?: boolean | undefined
        readonly losesListenerAfterConnect?: boolean | undefined
        readonly missingProcfsAlive?: boolean | undefined
        readonly vanishesAfterConnectBeforeExitEvent?: boolean | undefined
      },
      connect: Effect.Effect<void> = Effect.void,
      timeout = "200 millis",
      around: <A, E, R>(start: Effect.Effect<A, E, R>) => Effect.Effect<unknown, E, R> = (start) => start
    ) {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
      const executablePath = `${directory}/MiniBrowser`
      yield* fs.writeFileString(executablePath, "")
      const ports: Array<number> = []
      const stopped: Array<number> = []
      const connected: Array<number> = []
      const closed: Array<number> = []
      const written: Array<number> = []
      const base = 9100000
      const gone = new Set<number>()
      const stderrClosed = yield* Deferred.make<void>()
      const exitEvents = new Map<number, Deferred.Deferred<ChildProcessSpawner.ExitCode>>()
      const reportExitSoon = (spawn: number) => {
        setTimeout(() => {
          gone.add(spawn)
          Deferred.doneUnsafe(exitEvents.get(spawn)!, Effect.succeed(ChildProcessSpawner.ExitCode(1)))
        }, 20)
      }
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.gen(function*() {
          assert(command._tag === "StandardCommand")
          const port = Number(command.options.env!["WEBKIT_INSPECTOR_SERVER"]!.split(":")[1])
          const spawn = ports.push(port) - 1
          yield* Effect.addFinalizer(() => Effect.sync(() => stopped.push(spawn)))
          const line = new TextEncoder().encode(`Failed to start remote inspector server on 127.0.0.1:${port}\n`)
          const exits = behavior(spawn).vanishes === true || behavior(spawn).vanishesAfterConnect === true ||
            behavior(spawn).exitsBeforePolling === true
          if (behavior(spawn).exitsBeforePolling === true) gone.add(spawn)
          const failed = new TextEncoder().encode("MiniBrowser startup failed\n")
          const exitEvent = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
          exitEvents.set(spawn, exitEvent)
          if (behavior(spawn).stderrEndsBeforeExitEvent === true) reportExitSoon(spawn)
          const stderr = behavior(spawn).collides === true
            ? Stream.concat(Stream.make(line), Stream.never)
            : behavior(spawn).stderrClosesAlive === true
            ? Stream.make(new TextEncoder().encode("stderr is closing, but the child is alive\n")).pipe(
              Stream.ensuring(Deferred.succeed(stderrClosed, undefined))
            )
            : behavior(spawn).stderrEndsBeforeExitEvent === true
            ? Stream.make(failed)
            : behavior(spawn).fdDeniedBeforeExitEvent === true || behavior(spawn).vanishesBeforeExitEvent === true ||
                behavior(spawn).vanishesAfterConnectBeforeExitEvent === true
            ? Stream.concat(Stream.make(failed), Stream.never)
            : exits
            ? Stream.concat(Stream.make(new TextEncoder().encode("MiniBrowser startup failed\n")), Stream.never)
            : Stream.never
          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(base + spawn),
            exitCode: exits
              ? Effect.succeed(ChildProcessSpawner.ExitCode(1))
              : Deferred.await(exitEvent),
            isRunning: Effect.sync(() => !gone.has(spawn)),
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
      const row = (port: number, inode: string) =>
        `0: 0100007F:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A 0:0 00:0 0 1000 0 ${inode}\n`
      const spawnOf = (path: string) => {
        const pid = /^\/proc\/(\d+)\//.exec(path)?.[1]
        return pid === undefined ? undefined : Number(pid) - base
      }
      const procfs: FileSystem.FileSystem = {
        ...fs,
        readFileString: (path, options) => {
          const spawn = spawnOf(path)
          if (spawn === undefined) return fs.readFileString(path, options)
          if (behavior(spawn).missingProcfsAlive === true) return fs.readFileString(`${directory}/missing-procfs`)
          if (
            behavior(spawn).vanishes === true ||
            (behavior(spawn).vanishesAfterConnect === true && connected.includes(ports[spawn]!))
          ) {
            gone.add(spawn)
            return fs.readFileString(`${directory}/gone`)
          }
          if (
            behavior(spawn).vanishesBeforeExitEvent === true ||
            (behavior(spawn).vanishesAfterConnectBeforeExitEvent === true && connected.includes(ports[spawn]!))
          ) {
            return fs.readFileString(`${directory}/gone`).pipe(
              Effect.tapError(() => Effect.sync(() => reportExitSoon(spawn)))
            )
          }
          const { foreign, held } = behavior(spawn)
          const table = "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n"
            + (held && !(behavior(spawn).losesListenerAfterConnect === true && connected.includes(ports[spawn]!))
              ? row(ports[spawn]!, `${1000 + spawn}`) :
              foreign === true
              ? row(ports[spawn]!, "777")
              : "")
          return behavior(spawn).stderrClosesAlive === true
            ? Deferred.await(stderrClosed).pipe(Effect.andThen(Effect.yieldNow), Effect.as(table))
            : Effect.succeed(table)
        },
        readDirectory: (path, options) => {
          const spawn = spawnOf(path)
          if (spawn === undefined) return fs.readDirectory(path, options)
          if (behavior(spawn).fdDeniedBeforeExitEvent !== true) return Effect.succeed(["7"])
          reportExitSoon(spawn)
          return Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "readDirectory",
              pathOrDescriptor: path
            })
          )
        },
        readLink: (path) => {
          const spawn = spawnOf(path)
          return spawn === undefined ? fs.readLink(path) : Effect.succeed(`socket:[${1000 + spawn}]`)
        }
      }
      const connector: SocketConnector.SocketConnector = {
        connect: Effect.fnUntraced(function*({ port }) {
          connected.push(port)
          yield* Effect.addFinalizer(() => Effect.sync(() => closed.push(port)))
          yield* connect
          const write = () =>
            Effect.andThen(
              Effect.sync(() => written.push(port)),
              behavior(ports.indexOf(port)).silentSession === true ? Effect.void : Effect.fail(
                new Socket.SocketError({
                  reason: new Socket.SocketWriteError({ cause: "stop after the first write" })
                })
              )
            )
          // A listener that accepts and never answers: it only ever reads what it is sent.
          return { pull: Effect.never, upgrade: () => Effect.void, write, writeAll: write, close: Effect.void }
        })
      }
      const exit = yield* around(WebKitAutomation.start({ executablePath, timeout }).pipe(onPlatform("linux"))).pipe(
        Effect.scoped,
        Effect.provideService(FileSystem.FileSystem, procfs),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(SocketConnector.SocketConnector, connector),
        Effect.exit
      )
      return { exit, ports, stopped, connected, closed, written }
    })

    it.effect("writes nothing to a silent foreign listener, and starts owned on the next port its collision picks", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch((spawn) =>
          spawn === 0 ? { held: false, foreign: true, collides: true } : { held: true }
        )
        assert.strictEqual(result.ports.length, 2)
        assert.notStrictEqual(result.ports[0], result.ports[1])
        assert.deepStrictEqual(result.connected, [result.ports[1]])
        assert.deepStrictEqual(result.written, [result.ports[1]])
        assert.include(result.stopped, 0)
      }).pipe(Random.withSeed("port-in-use")))

    it.effect("reports only the last port attempt after a collision", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch((spawn) =>
          spawn === 0 ? { held: false, foreign: true, collides: true } : { held: false }
        )
        assert.strictEqual(result.ports.length, 2)
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert.include(error.message, `WebKit startup (port ${result.ports[1]}, PID 9100001;`)
        assert.strictEqual(Array.from(error.message.matchAll(/spawned at/g)).length, 1)
        assert.notInclude(error.message, "listener verified at")
        assert.deepStrictEqual(result.connected, [])
        assert.deepStrictEqual(result.stopped, [0, 1])
      }).pipe(Random.withSeed("port-in-use")))

    it.effect("closes the connection and stops the child when the deadline interrupts a connection in progress", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true }), Effect.never, "50 millis")
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.stopped, [0])
        assert.strictEqual(result.written.length, 0)
      }))

    // The historical failure: the page's operation deadline, not the launcher's, interrupted a startup whose listener
    // never appeared. Its Timeout is the only error the caller sees, so it has to name the stage startup reached.
    it.effect("names the reached startup stage when the calling operation's deadline interrupts startup", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(
          () => ({ held: false }),
          Effect.void,
          "10 seconds",
          (start) =>
            Effect.flatMap(Operation.record, (record) => record.bound(start)).pipe(
              Operation.named("Browser.newPage"),
              Deadline.within("100 millis"),
              Effect.exit
            )
        )
        assert(result.exit._tag === "Success")
        const inner = result.exit.value as Exit.Exit<unknown, unknown>
        assert(inner._tag === "Failure")
        const timeout = Option.getOrThrow(Exit.findErrorOption(inner))
        assert(Deadline.isTimeout(timeout), String(timeout))
        assert.deepStrictEqual(result.stopped, [0])
        assert.match(JSON.stringify({ hint: timeout.hint, last: timeout.last, history: timeout.history }), /spawned/)
      }))

    for (
      const [held, pendingConnect, stages] of [
        [false, false, ["spawned"]],
        [true, true, ["spawned", "listener verified"]],
        [true, false, ["spawned", "listener verified", "connected", "inspector established"]]
      ] as const
    ) {
      it.effect(`carries ${stages.at(-1)} through detached bounded creation into the calling timeout`, () =>
        Effect.gen(function*() {
          const result = yield* scriptedLaunch(
            () => ({ held, silentSession: true }),
            pendingConnect ? Effect.never : Effect.void,
            "300 millis",
            (start) =>
              Effect.gen(function*() {
                const finished = yield* Deferred.make<void>()
                let caller: Operation.Record | undefined
                let detached: Operation.Record | undefined
                const adapter = BoundedAdapter.make({
                  createUserContext: Effect.fnUntraced(function*() {
                    detached = Option.getOrUndefined(yield* Operation.current)
                    return yield* start.pipe(Effect.scoped, Effect.as("created" as UserContext.Id))
                  }, Effect.ensuring(Deferred.succeed(finished, undefined))),
                  removeUserContext: () => Effect.die("A failed creation must not release a context that doesn't exist")
                } as unknown as Adapter.AdapterConnection)
                const exit = yield* Effect.gen(function*() {
                  caller = yield* Operation.record
                  return yield* adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
                }).pipe(Operation.named("Browser.newPage"), Deadline.within("100 millis"), Effect.exit)
                // The detached creation keeps its original launch deadline and owns cleanup after the caller leaves.
                const endedWithCaller = yield* Deferred.isDone(finished)
                yield* Deferred.await(finished)
                assert.isFalse(endedWithCaller)
                assert.strictEqual(detached, caller)
                assert(exit._tag === "Failure")
                const timeout = Option.getOrThrow(Exit.findErrorOption(exit))
                assert(Deadline.isTimeout(timeout))
                assert.strictEqual(timeout.phase, "dispatchedUnconfirmed")
                assert.strictEqual(timeout.diagnostics.operationId, caller!.id)
                assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
                const observations = timeout.history.map(({ value }) =>
                  value as {
                    _tag: string
                    stage: string
                    port: number
                    pid: number
                    attempt: number
                    elapsedMillis: number
                  }
                )
                assert.deepStrictEqual(observations.map((value) => value.stage), [...stages])
                for (const [index, value] of observations.entries()) {
                  assert.strictEqual(value._tag, "WebKitStartup")
                  assert.strictEqual(value.pid, 9100000)
                  assert.strictEqual(value.attempt, 1)
                  assert.isTrue(value.port >= 49152 && value.port <= 65535)
                  assert.isTrue(value.elapsedMillis >= 0)
                  if (index > 0) assert.isTrue(value.elapsedMillis >= observations[index - 1]!.elapsedMillis)
                }
                assert.deepStrictEqual(Option.getOrThrow(timeout.last), timeout.history.at(-1))
                return timeout
              })
          )
          yield* result.exit
          assert.deepStrictEqual(result.stopped, [0])
          assert.deepStrictEqual(result.closed, result.connected)
        }))
    }

    it.effect("keeps startup observations attributed to their own port attempt after a collision", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(
          (spawn) => spawn === 0 ? { held: false, foreign: true, collides: true } : { held: false },
          Effect.void,
          "10 seconds",
          (start) =>
            Effect.flatMap(Operation.record, (record) => record.bound(start)).pipe(
              Operation.named("Browser.newPage"),
              Deadline.within("100 millis"),
              Effect.exit
            )
        )
        assert(result.exit._tag === "Success")
        const exit = result.exit.value as Exit.Exit<unknown, unknown>
        assert(exit._tag === "Failure")
        const timeout = Option.getOrThrow(Exit.findErrorOption(exit))
        assert(Deadline.isTimeout(timeout))
        assert.strictEqual(result.ports.length, 2)
        assert.deepStrictEqual(
          timeout.history.map(({ value }) => {
            const stage = value as { stage: string; port: number; pid: number; attempt: number }
            return { stage: stage.stage, port: stage.port, pid: stage.pid, attempt: stage.attempt }
          }),
          result.ports.map((port, index) => ({ stage: "spawned", port, pid: 9100000 + index, attempt: index + 1 }))
        )
        assert.deepStrictEqual(Option.getOrThrow(timeout.last), timeout.history.at(-1))
        assert.deepStrictEqual(result.stopped, [0, 1])
      }).pipe(Random.withSeed("port-in-use")))

    it.effect("reports a child that exits while being polled as its exit, not as unreadable procfs", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, vanishes: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert.strictEqual(error.reason._tag, "ProcessExited", "the child is gone: procfs isn't what's wrong")
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
        assert.include(error.reason.hint, "exec MiniBrowser")
        assert.include(error.reason.hint, "WebKit.layerAttach")
        assert.deepStrictEqual(result.connected, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("preserves exit code and stderr when the child disappears during the second ownership check", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true, vanishesAfterConnect: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
        assert.include(error.reason.hint, "exec MiniBrowser")
        assert.include(error.reason.hint, "WebKit.layerAttach")
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.written, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    // Seen on real children in 150 launches each: stderr ending first 147 times, procfs going first 1 to 2 times.
    it.effect("keeps a child's exit when its stderr ends before Node reports the exit", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, stderrEndsBeforeExitEvent: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert.strictEqual(error.reason._tag, "ProcessExited", "the child exited: it didn't fail to answer")
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
      }))

    it.effect("keeps a child's exit when procfs loses it before Node reports the exit", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, vanishesBeforeExitEvent: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert.strictEqual(error.reason._tag, "ProcessExited", "the child is gone: procfs isn't what's wrong")
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
      }))

    it.effect("keeps the exit and closes the connection when procfs disappears before the post-connect exit event", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true, vanishesAfterConnectBeforeExitEvent: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.written, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("keeps a child's exit when its descriptors are denied before Node reports the exit", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, fdDeniedBeforeExitEvent: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert.strictEqual(error.reason._tag, "ProcessExited", "the child was exiting: procfs isn't what's wrong")
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.strictEqual(error.reason.stderrTail, "MiniBrowser startup failed\n")
        assert.include(error.message, "spawned at")
      }))

    it.effect("closes a connection in progress when the child's exit wins the race", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true, stderrEndsBeforeExitEvent: true }), Effect.never)
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ProcessExited")
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.written, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("closes a connection in progress and stops the child when the launch is interrupted from outside", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(
          () => ({ held: true }),
          Effect.never,
          "5 seconds",
          (start) => Effect.timeoutOption(start, "30 millis")
        )
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.written, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("closes the connection and refuses when a live child loses its listener after connecting", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true, losesListenerAfterConnect: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ConnectionFailed")
        assert.include(error.reason.hint, "no longer holds its inspector listener")
        assert.include(error.reason.hint, "WebKit.layerAttach")
        assert.strictEqual(result.connected.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.written, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("continues successful owned startup when a live child closes stderr first", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: true, stderrClosesAlive: true }))
        assert.deepStrictEqual(result.written, result.ports)
        assert.strictEqual(result.written.length, 1)
        assert.deepStrictEqual(result.closed, result.connected)
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("keeps the deadline when a live child closes stderr without starting an owned listener", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, stderrClosesAlive: true }), Effect.void, "50 millis")
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ConnectionFailed")
        assert.strictEqual(error.reason.stage, "handshake")
        assert.include(error.reason.hint, "No child exit was observed")
        assert.deepStrictEqual(result.connected, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("bounds missing procfs by the existing deadline when no exit event arrives", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(
          () => ({ held: false, missingProcfsAlive: true }),
          Effect.void,
          "50 millis"
        )
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ConnectionFailed")
        assert.include(error.reason.hint, "Cannot read Linux procfs")
        assert.include(error.reason.hint, "No child exit was observed")
        assert.include(error.reason.hint, "WebKit.layerAttach")
        assert.deepStrictEqual(result.connected, [])
        assert.deepStrictEqual(result.stopped, [0])
      }))

    it.effect("explains exec and attach for exits before ownership without diagnosing a fork", () =>
      Effect.gen(function*() {
        const result = yield* scriptedLaunch(() => ({ held: false, exitsBeforePolling: true }))
        assert(result.exit._tag === "Failure")
        const error = Option.getOrThrow(Exit.findErrorOption(result.exit))
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(1))
        assert.include(error.reason.hint, "exec MiniBrowser")
        assert.include(error.reason.hint, "WebKit.layerAttach")
        assert.notInclude(error.reason.hint, "Cannot read Linux procfs")
        assert.deepStrictEqual(result.connected, [])
      }))

    it.effect("distinguishes simultaneous children sharing the namespace TCP table", () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const loopback = new Uint32Array(new Uint8Array([127, 0, 0, 1]).buffer)[0]!.toString(16).toUpperCase().padStart(
          8,
          "0"
        )
        const procfs: FileSystem.FileSystem = {
          ...fs,
          readFileString: () =>
            Effect.succeed(
              `sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n`
                + `0: ${loopback}:C000 00000000:0000 0A 0:0 00:0 0 1000 0 111\n`
                // Other ports and connected sockets are not listeners for this endpoint.
                + `1: ${loopback}:C001 00000000:0000 0A 0:0 00:0 0 1000 0 222\n`
                + `2: ${loopback}:C000 00000000:0000 01 0:0 00:0 0 1000 0 222\n`
            ),
          readDirectory: () => Effect.succeed(["7"]),
          readLink: (path) => Effect.succeed(path === "/proc/10/fd/7" ? "socket:[111]" : "socket:[222]")
        }
        const [owner, other] = yield* Effect.all([
          WebKitAutomation.inspectorListener(10, 49152),
          WebKitAutomation.inspectorListener(20, 49152)
        ], { concurrency: 2 }).pipe(Effect.provideService(FileSystem.FileSystem, procfs), onPlatform("linux"))
        assert.strictEqual(owner, "111")
        assert.isUndefined(other)
      }))

    it.effect("runs fake ownership checks on a non-Linux host and restores its platform after failure", () =>
      Effect.gen(function*() {
        assert.strictEqual(process.platform, "darwin")
        const result = yield* ownershipAttempt("owned")
        assert.strictEqual(result.writes, 1)
        assert.strictEqual(process.platform, "darwin")
        yield* Effect.fail("expected failure").pipe(onPlatform("linux"), Effect.flip)
        assert.strictEqual(process.platform, "darwin")
      }).pipe(onPlatform("darwin")))

    it.effect("refuses ownership verification on unsupported operating systems with attach guidance", () =>
      Effect.gen(function*() {
        const error = yield* WebKitAutomation.start({ executablePath: "/unused/MiniBrowser" }).pipe(
          Effect.scoped,
          Effect.flip,
          onPlatform("darwin")
        )
        assert(error.reason._tag === "ConnectionFailed")
        assert.include(error.reason.hint, "requires Linux procfs")
        assert.include(error.reason.hint, "WebKit.layerAttach")
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
        const error = yield* Effect.scoped(
          WebKitAutomation.start({ executablePath: "/nowhere/MiniBrowser" }).pipe(onPlatform("linux"))
        ).pipe(
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
        const other = yield* Effect.scoped(
          WebKitAutomation.start({ executablePath: `${directory}/epiphany` }).pipe(onPlatform("linux"))
        ).pipe(
          Effect.flip
        )
        assert.deepInclude(other.reason, { _tag: "InvalidInput", input: "executablePath" })
        const headless = yield* Effect.scoped(
          WebKitAutomation.start({ executablePath: `${directory}/MiniBrowser`, headless: true }).pipe(
            onPlatform("linux")
          )
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
          assert.include(
            JSON.stringify(error.reason),
            process.platform === "linux" ? "never answered" : "requires Linux procfs"
          )
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
