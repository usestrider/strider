/**
 * The launchers, without a browser: the executable each accepts (an absolute path, and nothing looked up), the
 * arguments and profiles it passes, and how it fails. The integration tests launch the real browsers.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
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
})
