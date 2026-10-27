/**
 * `strider browsers`, without a browser: where it looks, and what it reports about a machine made of
 * scripts in a temporary directory, which print a version as a browser does.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Browsers from "../src/internal/browsers.ts"
import * as Cli from "../src/internal/cli.ts"

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

    it.effect("looks for WebKit's MiniBrowser where its packages put it, on Linux only", () =>
      Effect.sync(() => {
        const linux = Browsers.webkitCandidates("linux", { HOME: "/home/a", USER: "a" }).map((candidate) =>
          candidate.path
        )
        assert.include(linux, "/usr/libexec/webkitgtk-6.0/MiniBrowser")
        assert.include(linux, "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser")
        assert.include(linux, "/usr/lib/wpe-webkit-2.0/MiniBrowser")
        assert.include(linux, "/home/a/.nix-profile/libexec/webkitgtk-6.0/MiniBrowser")
        assert.include(linux, "/etc/profiles/per-user/a/libexec/webkitgtk-6.0/MiniBrowser")
        assert.deepStrictEqual(Browsers.webkitCandidates("darwin", { HOME: "/Users/a" }), [])
      }))

    it.effect("reports each browser once, by the path found first, with its version", () =>
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
        // A Nix profile's MiniBrowser, which leads to a store path that names its version; it's never run
        const store = `${root}/store/abc-webkitgtk-2.54.1+abi=6.0/libexec/webkitgtk-6.0`
        yield* fs.makeDirectory(store, { recursive: true })
        yield* browser(`${store}/MiniBrowser`, "never asked")
        yield* fs.makeDirectory(`${root}/.nix-profile/libexec`, { recursive: true })
        yield* fs.symlink(store, `${root}/.nix-profile/libexec/webkitgtk-6.0`)

        // Only what this machine of scripts has: the real one's own browsers are left out
        const found = (yield* Browsers.find("linux", { PATH: `${root}/bin`, HOME: root })).filter((browser) =>
          browser.path.startsWith(root)
        )
        const real = yield* fs.realPath(`${root}/store/chromium`)
        const miniBrowser = yield* fs.realPath(`${root}/.nix-profile/libexec/webkitgtk-6.0/MiniBrowser`)
        assert.deepStrictEqual(found, [
          {
            backend: "chromium",
            path: `${root}/bin/chromium`,
            resolved: Option.some(real),
            foundBy: "PATH",
            version: Option.some("Chromium 155.0.8059.79")
          },
          {
            backend: "firefox",
            path: `${root}/bin/firefox-nightly`,
            resolved: Option.none(),
            foundBy: "PATH",
            version: Option.some("Mozilla Firefox 160.0a1")
          },
          {
            backend: "webkit",
            path: `${root}/.nix-profile/libexec/webkitgtk-6.0/MiniBrowser`,
            resolved: Option.some(miniBrowser),
            foundBy: "installer",
            version: Option.some("WebKitGTK 2.54.1")
          }
        ])

        const text = Cli.render(found)
        assert.include(text, `  ${root}/bin/chromium\n    Chromium 155.0.8059.79 · on PATH · leads to ${real}`)
        assert.include(text, `Firefox.layer\n  ${root}/bin/firefox-nightly`)
        assert.include(
          text,
          `WebKit.layer\n  ${root}/.nix-profile/libexec/webkitgtk-6.0/MiniBrowser\n    WebKitGTK 2.54.1 · where its installer or package puts it`
        )
      }))

    it.effect("says when it finds nothing", () =>
      Effect.sync(() => {
        const text = Cli.render([])
        assert.include(text, "Chromium.layer\n  none found")
        assert.include(text, "WebKit.layer\n  none found; WebKitGTK's and WPE's packages put a MiniBrowser")
      }))
  })
})
