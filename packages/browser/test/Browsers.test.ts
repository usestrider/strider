/**
 * `strider browsers`, without a browser (review 11): where it looks, and what it reports about a machine made of
 * scripts in a temporary directory, which print a version as a browser does.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Browsers from "../src/internal/browsers.ts"
import * as Cli from "../src/internal/cli.ts"
import { build } from "../src/internal/webkitBuild.ts"

const vendored = `${import.meta.dirname}/../../tools/codegen/protocols/webkit/source/protocol.json`

describe("strider browsers", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("looks on PATH under each command name, in PATH's order, and only in absolute directories", () =>
      Effect.sync(() => {
        const found = Browsers.pathCandidates("linux", { PATH: "/a:relative:/b:/a" })
        assert.deepStrictEqual(found.slice(0, 2), [
          { backend: "chromium", path: "/a/chromium", foundBy: "PATH" },
          { backend: "chromium", path: "/a/chromium-browser", foundBy: "PATH" }
        ])
        assert.isTrue(found.every((candidate) => candidate.path.startsWith("/a/") || candidate.path.startsWith("/b/")))
        assert.strictEqual(
          found.length,
          2 * (Browsers.commandNames.chromium.length + Browsers.commandNames.firefox.length)
        )
        assert.include(
          Browsers.pathCandidates("win32", { PATH: "C:\\Tools;D:\\Bin" }).map((candidate) => candidate.path),
          "C:\\Tools\\firefox.exe"
        )
      }))

    it.effect("knows where vendors' installers put their browsers, with Linux's Canary and Dev told apart", () =>
      Effect.sync(() => {
        const linux = Browsers.installerCandidates("linux", {}).map((candidate) => candidate.path)
        assert.include(linux, "/opt/google/chrome-canary/chrome")
        assert.include(linux, "/opt/google/chrome-unstable/chrome")
        assert.include(linux, "/opt/microsoft/msedge/msedge")
        assert.include(
          Browsers.installerCandidates("darwin", {}).map((candidate) => candidate.path),
          "/Applications/Firefox Nightly.app/Contents/MacOS/firefox"
        )
        assert.include(
          Browsers.installerCandidates("win32", { LOCALAPPDATA: "C:\\L" }).map((candidate) => candidate.path),
          "C:\\L\\Google\\Chrome SxS\\Application\\chrome.exe"
        )
      }))

    it.effect("finds Playwright's cache where its installer puts it, and its WebKit and Chromium builds", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          Browsers.playwrightCache("linux", { PLAYWRIGHT_BROWSERS_PATH: "/browsers", HOME: "/home/a" }),
          Option.some("/browsers")
        )
        assert.deepStrictEqual(
          Browsers.playwrightCache("linux", { HOME: "/home/a" }),
          Option.some("/home/a/.cache/ms-playwright")
        )
        assert.deepStrictEqual(
          Browsers.playwrightCache("darwin", { HOME: "/Users/a" }),
          Option.some("/Users/a/Library/Caches/ms-playwright")
        )
        assert.deepStrictEqual(Browsers.playwrightCache("linux", {}), Option.none())
        assert.deepStrictEqual(Browsers.playwrightCandidates("win32", "C:\\pw", "webkit-2359"), [
          { backend: "webkit", path: "C:\\pw\\webkit-2359\\Playwright.exe", foundBy: "playwright" }
        ])
        assert.deepStrictEqual(
          Browsers.playwrightCandidates("linux", "/pw", "chromium-1243").map((candidate) => candidate.path),
          ["/pw/chromium-1243/chrome-linux64/chrome", "/pw/chromium-1243/chrome-linux/chrome"]
        )
        assert.deepStrictEqual(Browsers.playwrightCandidates("linux", "/pw", "chromium_headless_shell-1243"), [])
        assert.deepStrictEqual(Browsers.playwrightCandidates("linux", "/pw", "ffmpeg-1011"), [])
      }))

    it.effect("reports each browser once, by the path found first, with its version and the build check", () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        // Real, so a temporary directory behind a link (macOS's /var) doesn't read as a link itself
        const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "strider-browsers-" }))
        const browser = (path: string, version: string) =>
          Effect.andThen(
            fs.writeFileString(path, `#!/bin/sh\necho "${version}"\n`),
            fs.chmod(path, 0o755)
          )
        // PATH: a profile's links, two of them to one Chromium; a directory named like a browser
        yield* fs.makeDirectory(`${root}/store`)
        yield* fs.makeDirectory(`${root}/bin`)
        yield* browser(`${root}/store/chromium`, "Chromium 155.0.8059.79")
        yield* fs.symlink(`${root}/store/chromium`, `${root}/bin/chromium`)
        yield* fs.symlink(`${root}/store/chromium`, `${root}/bin/chromium-browser`)
        yield* fs.makeDirectory(`${root}/bin/firefox`)
        yield* browser(`${root}/bin/firefox-nightly`, "Mozilla Firefox 160.0a1")
        // Playwright's cache: the build the adapter needs, and another
        for (const revision of [build.revision, "2311"]) {
          yield* fs.makeDirectory(`${root}/pw/webkit-${revision}`, { recursive: true })
          yield* browser(`${root}/pw/webkit-${revision}/pw_run.sh`, "never asked")
        }
        yield* fs.copyFile(vendored, `${root}/pw/webkit-${build.revision}/protocol.json`)
        yield* fs.writeFileString(`${root}/pw/webkit-2311/protocol.json`, "{}")

        const found = yield* Browsers.find("linux", { PATH: `${root}/bin`, PLAYWRIGHT_BROWSERS_PATH: `${root}/pw` })
        const real = yield* fs.realPath(`${root}/store/chromium`)
        assert.deepStrictEqual(found, [
          {
            backend: "chromium",
            path: `${root}/bin/chromium`,
            resolved: Option.some(real),
            foundBy: "PATH",
            version: Option.some("Chromium 155.0.8059.79"),
            matchesAdapter: Option.none()
          },
          {
            backend: "firefox",
            path: `${root}/bin/firefox-nightly`,
            resolved: Option.none(),
            foundBy: "PATH",
            version: Option.some("Mozilla Firefox 160.0a1"),
            matchesAdapter: Option.none()
          },
          {
            backend: "webkit",
            path: `${root}/pw/webkit-2311/pw_run.sh`,
            resolved: Option.none(),
            foundBy: "playwright",
            version: Option.some("Playwright WebKit build 2311"),
            matchesAdapter: Option.some(false)
          },
          {
            backend: "webkit",
            path: `${root}/pw/webkit-${build.revision}/pw_run.sh`,
            resolved: Option.none(),
            foundBy: "playwright",
            version: Option.some(`Playwright WebKit build ${build.revision}`),
            matchesAdapter: Option.some(true)
          }
        ])

        const text = Cli.render(found, Option.some(`${root}/pw`))
        assert.include(text, `  ${root}/bin/chromium\n    Chromium 155.0.8059.79 · on PATH · leads to ${real}`)
        assert.include(text, `Firefox.layer\n  ${root}/bin/firefox-nightly`)
        assert.include(text, `not build ${build.revision}, which the WebKit adapter needs, so WebKit.layer refuses it`)
        assert.include(text, "the build the WebKit adapter needs")
      }))

    it.effect("says when it finds nothing", () =>
      Effect.sync(() => {
        const text = Cli.render([], Option.none())
        assert.include(text, "Chromium.layer\n  none found")
        assert.include(text, "WebKit.layer\n  none found; Playwright's installer")
      }))
  })
})
