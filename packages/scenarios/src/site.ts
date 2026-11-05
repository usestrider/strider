/**
 * The local site both libraries' scenarios run against: one server, a page per scenario, and the pages the
 * measurements load. Nothing is sent anywhere else.
 */
import * as http from "node:http"
import type { AddressInfo } from "node:net"

export interface Site {
  readonly origin: string
  readonly close: () => Promise<void>
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

// A 1×1 PNG
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

/** What a page reads about the browser that runs it. */
const tells = `<script>
window.tells = (async () => {
  // A console argument whose stack is read when a CDP client has Runtime.enable on, which serializes it
  let runtimeEnabled = false
  const probe = new Error("probe")
  Object.defineProperty(probe, "stack", { get() { runtimeEnabled = true; return "" } })
  console.debug(probe)
  await new Promise((resolve) => setTimeout(resolve, 100))
  // Globals the page didn't make: the window's own names that a fresh frame's window hasn't
  const frame = document.createElement("iframe")
  document.body.append(frame)
  const fresh = new Set(Object.getOwnPropertyNames(frame.contentWindow))
  const added = Object.getOwnPropertyNames(window).filter((name) => !fresh.has(name) && name !== "tells")
  frame.remove()
  const gl = document.createElement("canvas").getContext("webgl")
  const debug = gl && gl.getExtension("WEBGL_debug_renderer_info")
  let notifications = "unknown"
  try { notifications = (await navigator.permissions.query({ name: "notifications" })).state } catch {}
  return {
    "navigator.webdriver": navigator.webdriver,
    "userAgent says HeadlessChrome": /HeadlessChrome/.test(navigator.userAgent),
    "Runtime.enable observed": runtimeEnabled,
    "window.chrome": typeof window.chrome,
    "window.chrome.runtime": typeof window.chrome?.runtime,
    "navigator.plugins.length": navigator.plugins.length,
    "navigator.languages": navigator.languages.join(","),
    "outer size": window.outerWidth + "×" + window.outerHeight,
    "inner size": window.innerWidth + "×" + window.innerHeight,
    "screen size": screen.width + "×" + screen.height,
    "Notification.permission / query": (typeof Notification === "undefined" ? "none" : Notification.permission) + " / " + notifications,
    "WebGL renderer": debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "none",
    "globals added": added.join(", ") || "none"
  }
})()
</script>`

export const responseBody = (size: number): Buffer =>
  Buffer.from(Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >>> 8)) & 255))

const bodies = new Map([4096, 4 * 1024 * 1024].map((size) => [size, responseBody(size)]))

const routes: Record<
  string,
  (
    url: URL,
    request: http.IncomingMessage
  ) => { status?: number; type?: string; headers?: Record<string, string>; body: string | Buffer; delay?: number }
> = {
  "/benchmark/body": (url) => ({
    type: "application/octet-stream",
    body: bodies.get(Number(url.searchParams.get("size"))) ?? Buffer.alloc(0)
  }),
  "/benchmark": () => ({
    body: page(
      "Benchmark",
      `<h1>Benchmark</h1><label>Name <input></label><button onclick="document.querySelector('#count').textContent = String(Number(document.querySelector('#count').textContent) + 1)">Increment</button><p id="count">0</p>`
    )
  }),
  // The README's program: a heading, and a button that shows a message
  "/": () => ({
    body: page(
      "Shop",
      `<h1>Shop</h1><button onclick="document.querySelector('#out').textContent = 'Added to cart'">Add to cart</button><p id="out"></p>`
    )
  }),
  // A login whose session the next context reuses
  "/login": () => ({
    body: page(
      "Sign in",
      `<form method="post" action="/session"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>`
    )
  }),
  "/session": () => ({
    status: 303,
    headers: { location: "/welcome", "set-cookie": "session=s3cr3t; Path=/; HttpOnly; SameSite=Lax" },
    body: ""
  }),
  "/welcome": (_, request) => ({
    body: page(
      "Welcome",
      request.headers.cookie?.includes("session=s3cr3t")
        ? `<h1>Welcome</h1><script>localStorage.setItem("theme", "dark")</script>`
        : `<h1>Signed out</h1>`
    )
  }),
  "/account": (_, request) => ({
    body: page(
      "Account",
      `<h1>${
        request.headers.cookie?.includes("session=s3cr3t") ? "Signed in" : "Signed out"
      }</h1><p id="theme"></p><script>document.querySelector("#theme").textContent = "theme: " + localStorage.getItem("theme")</script>`
    )
  }),
  // A popup with a dialog inside it
  "/connect": () => ({
    body: page("Connect", `<button onclick="window.open('/consent')">Connect account</button>`)
  }),
  "/consent": () => ({
    body: page(
      "Consent",
      `<button onclick="if (confirm('Allow access?')) document.querySelector('#out').textContent = 'Allowed'">Allow</button><p id="out"></p>`
    )
  }),
  // A page whose analytics a route blocks
  "/tracked": () => ({
    body: page(
      "Tracked",
      `<p id="out">waiting</p><script src="/analytics/track.js" onload="out.textContent = 'analytics loaded'" onerror="out.textContent = 'analytics blocked'"></script>`
    )
  }),
  "/analytics/track.js": () => ({ type: "text/javascript", body: "window.tracked = true" }),
  // A file upload
  "/upload": () => ({
    body: page(
      "Upload",
      `<label>Receipt <input type="file"></label><p id="out"></p><script>document.querySelector("input").onchange = (e) => { const f = e.target.files[0]; out.textContent = f.name + ":" + f.size }</script>`
    )
  }),
  // A response's body, from a click
  "/cart": () => ({
    body: page(
      "Cart",
      `<button onclick="fetch('/api/cart', { method: 'POST', body: '{&quot;sku&quot;:&quot;tea&quot;}' }).then((r) => r.json()).then((cart) => out.textContent = cart.items.length + ' items')">Add to cart</button><p id="out"></p>`
    )
  }),
  "/api/cart": () => ({ type: "application/json", body: JSON.stringify({ items: [{ sku: "tea", quantity: 1 }] }) }),
  // A navigation a click causes
  "/home": () => ({ body: page("Home", `<a href="/orders">Orders</a>`) }),
  "/orders": () => ({ body: page("Orders", `<h1>Orders</h1>`), delay: 50 }),
  // A page whose traffic a HAR records and replays
  "/report": () => ({
    body: page(
      "Report",
      `<p id="out">loading</p><script>fetch("/api/report").then((r) => r.json()).then((report) => out.textContent = report.total + " sold")</script>`
    )
  }),
  "/api/report": () => ({ type: "application/json", body: JSON.stringify({ total: 42 }) }),
  // Q82: a heavy page, animating, whose #ready appears after `after` milliseconds
  "/heavy": (url) => ({
    body: page(
      "Heavy",
      `<div id="grid"></div><script>
const grid = document.querySelector("#grid")
for (let i = 0; i < 3000; i++) { const cell = document.createElement("span"); cell.textContent = i; grid.append(cell) }
const cells = grid.children
const frame = (t) => { for (let i = 0; i < 200; i++) cells[(Math.floor(t) + i * 13) % cells.length].style.opacity = String((i % 10) / 10); requestAnimationFrame(frame) }
requestAnimationFrame(frame)
setTimeout(() => { const ready = document.createElement("p"); ready.id = "ready"; ready.textContent = "Ready"; document.body.append(ready) }, ${
        Number(url.searchParams.get("after") ?? "3000")
      })
</script>`
    )
  }),
  // Q103: a page with `n` images
  "/many": (url) => ({
    body: page(
      "Many",
      Array.from(
        { length: Number(url.searchParams.get("n") ?? "200") },
        (_, i) => `<img src="/img/${i}.png" width="1" height="1">`
      )
        .join("")
    )
  }),
  // What a page sees of the library driving it
  "/tells": () => ({ body: page("Tells", tells) })
}

const respond = (request: http.IncomingMessage, response: http.ServerResponse) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (url.pathname.startsWith("/img/")) {
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" })
    response.end(pixel)
    return
  }
  const route = routes[url.pathname]
  if (route === undefined) {
    response.writeHead(404, { "content-type": "text/plain" })
    response.end("not found")
    return
  }
  // Read the request's body before answering, as a server does
  request.resume()
  request.on("end", () => {
    const answer = route(url, request)
    setTimeout(() => {
      response.writeHead(answer.status ?? 200, {
        "content-type": answer.type ?? "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...answer.headers
      })
      response.end(answer.body)
    }, answer.delay ?? 0)
  })
}

export const start = (): Promise<Site> =>
  new Promise((resolve) => {
    const server = http.createServer(respond)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
