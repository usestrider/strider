/**
 * Stock WebKit for the integration tests: WebKitGTK's MiniBrowser (`browsers.ts`), which
 * has no headless mode (QUIRKS.md, Q202), on an X server of its own, with its remote inspector on a free port. Both
 * stop with the scope. In automation mode, its inspector server is the socket WebKit's WebDriver speaks.
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as net from "node:net"
import * as Launch from "../../src/internal/launch.ts"
import * as WebKitStockTransport from "../../src/internal/webkitStockTransport.ts"
import { webkitgtk } from "./browsers.ts"

/** A port nothing listens on now. */
const freePort = Effect.callback<number>((resume) => {
  const server = net.createServer()
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port
    server.close(() => resume(Effect.succeed(port)))
  })
})

/** An X server of its own, on a display it picks (`-displayfd`), for the scope: its display's number. */
export const startXvfb = Effect.fnUntraced(function*(dir: string, screen = "1280x800x24") {
  const xvfb = yield* Launch.spawn(
    webkitgtk.xvfb,
    ["-displayfd", "2", "-screen", "0", screen, "-nolisten", "tcp"],
    dir,
    {}
  )
  return Option.getOrThrowWith(
    yield* xvfb.stderrLine(/^(\d+)$/),
    () => new Error("Xvfb exited before it named its display")
  )[1]!
})

/** The MiniBrowser's environment: its display, and XDG directories in the temporary one, shared with no test. */
const environment = (dir: string, display: string, inspector: Record<string, string>) => ({
  DISPLAY: `:${display}`,
  GDK_BACKEND: "x11",
  XDG_DATA_HOME: `${dir}/data`,
  XDG_CACHE_HOME: `${dir}/cache`,
  XDG_CONFIG_HOME: `${dir}/config`,
  ...inspector
})

/**
 * The MiniBrowser showing `urls`, a tab each, and its inspector server's endpoint, `http://127.0.0.1:port`, once
 * its list names them all. The process is returned too, for a test that ends it.
 */
export const startMiniBrowser = Effect.fnUntraced(function*(...urls: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-webkitgtk-" })
  const display = yield* startXvfb(dir)
  const port = yield* freePort
  const endpoint = `http://127.0.0.1:${port}`
  // Scripts may open windows, so a test can have the browser open a page after the layer attached
  const args = [`--profile-dir=${dir}/profile`, "--javascript-can-open-windows-automatically=true", ...urls]
  const browser = yield* Launch.spawn(webkitgtk.executable, args, dir, {
    env: environment(dir, display, { WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${port}` })
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const listed = yield* Effect.promise(() => fetch(`${endpoint}/`).then((response) => response.text(), () => ""))
    if (WebKitStockTransport.pagesOf(listed).length >= urls.length) return { endpoint, process: browser.handle }
    yield* Effect.sleep("100 millis")
  }
  return yield* Effect.die(new Error(`The MiniBrowser's inspector at ${endpoint} listed no page`))
})

/**
 * The MiniBrowser in automation mode, with its inspector server's socket on a free port
 * (`WEBKIT_INSPECTOR_SERVER`), once it listens: its port, and its process.
 */
export const startMiniBrowserForAutomation = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-webkitgtk-" })
  const display = yield* startXvfb(dir)
  const port = yield* freePort
  const browser = yield* Launch.spawn(webkitgtk.executable, ["--automation"], dir, {
    env: environment(dir, display, { WEBKIT_INSPECTOR_SERVER: `127.0.0.1:${port}` })
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const listening = yield* Effect.callback<boolean>((resume) => {
      const socket = net.connect(port, "127.0.0.1")
      socket.once("connect", () => {
        socket.destroy()
        resume(Effect.succeed(true))
      })
      socket.once("error", () => resume(Effect.succeed(false)))
    })
    if (listening) return { port, process: browser.handle }
    yield* Effect.sleep("100 millis")
  }
  return yield* Effect.die(new Error(`The MiniBrowser's inspector socket on ${port} never listened`))
})

/**
 * An X server for the scope, which this process's environment names (`DISPLAY`), so a browser `WebKit.layer`
 * launches opens its window there, as a program's would.
 */
export const useXvfb = Effect.fnUntraced(function*(screen?: string) {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-xvfb-" })
  const display = yield* startXvfb(dir, screen)
  const before = { display: process.env["DISPLAY"], backend: process.env["GDK_BACKEND"] }
  process.env["DISPLAY"] = `:${display}`
  process.env["GDK_BACKEND"] = "x11"
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (before.display === undefined) delete process.env["DISPLAY"]
      else process.env["DISPLAY"] = before.display
      if (before.backend === undefined) delete process.env["GDK_BACKEND"]
      else process.env["GDK_BACKEND"] = before.backend
    })
  )
})
