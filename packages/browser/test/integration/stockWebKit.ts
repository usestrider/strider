/**
 * Stock WebKit for the integration tests (review 22, candidate 7): WebKitGTK's MiniBrowser (`browsers.ts`), which
 * has no headless mode (QUIRKS.md, Q202), on an X server of its own, with its remote inspector on a free port. Both
 * stop with the scope.
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

/**
 * The MiniBrowser showing `urls`, a tab each, and its inspector server's endpoint, `http://127.0.0.1:port`, once
 * its list names them all. The process is returned too, for a test that ends it.
 */
export const startMiniBrowser = Effect.fnUntraced(function*(...urls: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-webkitgtk-" })
  // Xvfb picks a display no other server has, and writes its number to the descriptor named
  const xvfb = yield* Launch.spawn(
    webkitgtk.xvfb,
    ["-displayfd", "2", "-screen", "0", "1280x800x24", "-nolisten", "tcp"],
    dir,
    {}
  )
  const display = Option.getOrThrowWith(
    yield* xvfb.stderrLine(/^(\d+)$/),
    () => new Error("Xvfb exited before it named its display")
  )[1]!
  const port = yield* freePort
  const endpoint = `http://127.0.0.1:${port}`
  // Scripts may open windows, so a test can have the browser open a page after the layer attached
  const args = [`--profile-dir=${dir}/profile`, "--javascript-can-open-windows-automatically=true", ...urls]
  const browser = yield* Launch.spawn(webkitgtk.executable, args, dir, {
    env: {
      DISPLAY: `:${display}`,
      GDK_BACKEND: "x11",
      WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${port}`,
      // The XDG directories in the temporary one too, so nothing is shared between tests
      XDG_DATA_HOME: `${dir}/data`,
      XDG_CACHE_HOME: `${dir}/cache`,
      XDG_CONFIG_HOME: `${dir}/config`
    }
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const listed = yield* Effect.promise(() => fetch(`${endpoint}/`).then((response) => response.text(), () => ""))
    if (WebKitStockTransport.pagesOf(listed).length >= urls.length) return { endpoint, process: browser.handle }
    yield* Effect.sleep("100 millis")
  }
  return yield* Effect.die(new Error(`The MiniBrowser's inspector at ${endpoint} listed no page`))
})
