import * as fs from "node:fs"
import * as http from "node:http"
import * as path from "node:path"
import { verifyFixture } from "./helpers.ts"

/** Original static assets plus the test files' inline HTML, on an ordinary local HTTP origin. */
export const inputSite = async () => {
  const root = verifyFixture("playwright")
  const pages = new Map<string, string>()
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url!, "http://localhost").pathname
    const inline = pages.get(pathname)
    if (inline !== undefined) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(inline)
    } else if (["/empty.html", "/input/textarea.html", "/input/mouse-helper.js"].includes(pathname)) {
      response.writeHead(200, {
        "content-type": pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8"
      })
        .end(fs.readFileSync(path.join(root, pathname)))
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("No fixture server address")
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    render: (html: string) => {
      const pathname = `/inline-${pages.size}.html`
      pages.set(pathname, html)
      return origin + pathname
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error))
        server.closeAllConnections()
      })
  }
}

/** Upstream's five animation-frame observation window, not a wall-clock sleep. */
export const frames = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
