/**
 * The launchers, without a browser: the executable each accepts (an absolute path, and nothing looked up), the
 * arguments and profiles it passes, how it fails, and WebKit's revision check. The integration tests launch the real browsers.
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
import * as WebKitLauncher from "../src/internal/webkitLauncher.ts"
import { pins } from "./integration/pins.ts"

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
    }
  )
})

describe("WebKit launcher", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("is pinned to the build the adapter is generated from", () =>
      Effect.sync(() => {
        assert.strictEqual(pins.webkit.revision, WebKitLauncher.build.revision)
      }))

    it.effect("fails with ExecutableNotFound for a path that doesn't exist", () =>
      Effect.gen(function*() {
        const error = yield* WebKitLauncher.launch({ executablePath: "/nowhere/pw_run.sh" }).pipe(Effect.flip)
        assert(error.reason._tag === "ExecutableNotFound")
        assert.deepStrictEqual(error.reason.searched, ["/nowhere/pw_run.sh"])
      }))

    it.effect("passes the inspector pipe and the profile", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(WebKitLauncher.argsFor({}, "/p"), [
          "--inspector-pipe",
          "--headless",
          "--user-data-dir=/p"
        ])
      }))

    it.effect("fails with IncompatibleRevision for a build whose protocol differs, or that has none", () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
        yield* fs.writeFileString(`${directory}/pw_run.sh`, "#!/bin/sh\nexit 1\n")
        const missing = yield* WebKitLauncher.launch({ executablePath: `${directory}/pw_run.sh` }).pipe(Effect.flip)
        assert(missing.reason._tag === "IncompatibleRevision")
        assert.strictEqual(missing.reason.revision, "unknown")
        yield* fs.writeFileString(`${directory}/protocol.json`, "[]")
        const other = yield* WebKitLauncher.launch({ executablePath: `${directory}/pw_run.sh` }).pipe(Effect.flip)
        assert(other.reason._tag === "IncompatibleRevision")
        assert.match(other.reason.revision, /^protocol\.json [0-9a-f]{12}$/)
      }))
  })
})
