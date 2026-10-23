/**
 * What the adapter conformance suite needs: a local site, a sink that records facts and waits for them, and a
 * backend to run against.
 */

import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import { createHash } from "node:crypto"
import * as http from "node:http"
import type * as net from "node:net"
import type * as Browser from "../../../src/Browser.ts"
import type * as Adapter from "../../../src/internal/adapter.ts"

// ── The site ──

/** One request the site served. */
export interface Served {
  readonly method: string
  readonly path: string
  readonly headers: http.IncomingHttpHeaders
}

export interface Site {
  /** `http://127.0.0.1:port`. */
  readonly origin: string
  /** The same server under another site, for out-of-process frames: `http://localhost:port`. */
  readonly crossSite: string
  readonly served: ReadonlyArray<Served>
}

type Route = (request: http.IncomingMessage, response: http.ServerResponse, site: Site) => void

const html = (response: http.ServerResponse, body: string, status = 200) => {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" })
  response.end(body)
}

const routes: Record<string, Route> = {
  // Any page: its HTML is the `html` parameter
  "/fixture": (request, response) =>
    html(response, new URL(request.url ?? "/", "http://site").searchParams.get("html") ?? ""),
  // An error page: a commit with a status of 404
  "/missing": (_request, response) => html(response, `<title>missing</title><p>No such page</p>`, 404),
  "/204": (_request, response) => {
    response.writeHead(204)
    response.end()
  },
  "/download": (_request, response) => {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": "attachment; filename=hello.txt"
    })
    response.end("hello, download")
  },
  "/redirect": (_request, response) => {
    response.writeHead(302, { location: "/landed" })
    response.end()
  },
  "/frames": (_request, response, site) =>
    html(
      response,
      `<title>frames</title><iframe src="/child"></iframe><iframe src="${site.crossSite}/child"></iframe>`
    ),
  "/child": (request, response) => html(response, `<title>child</title><p>child of ${request.headers.host}</p>`),
  "/worker.js": (_request, response) => {
    response.writeHead(200, { "content-type": "text/javascript" })
    response.end(`console.log("from the worker"); postMessage("ready")`)
  },
  "/worker": (_request, response) =>
    html(response, `<title>worker</title><script>const w = new Worker("/worker.js"); w.onmessage = () => {}</script>`),
  "/init": (_request, response) =>
    html(response, `<title>init</title><script>window.seenByAuthor = typeof window.fromInit</script>`),
  "/console": (_request, response) =>
    html(
      response,
      `<title>console</title><script>console.log("hello", 42); console.error("bad"); setTimeout(() => { throw new TypeError("thrown here") })</script>`
    ),
  "/form": (_request, response) =>
    html(
      response,
      `<title>form</title><button id="b" onclick="window.clicked = (window.clicked ?? 0) + 1">Go</button><input id="t"><input id="f" type="file" multiple>`
    ),
  "/headers": (request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(request.headers))
  },
  "/json": (_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "x-test": "yes" })
    response.end(`{"hello":"world"}`)
  },
  "/fetching": (_request, response) =>
    html(
      response,
      `<title>fetching</title><script>window.fetched = fetch("/json").then((r) => r.text()).catch((e) => "failed: " + e.message)</script>`
    ),
  "/cookie": (_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "set-cookie": "flavor=oat; Path=/" })
    response.end("<title>cookie</title>")
  },
  "/socket": (_request, response) =>
    html(
      response,
      `<title>socket</title><script>const s = new WebSocket("ws://" + location.host + "/ws"); s.onopen = () => s.send("ping"); s.onmessage = (e) => { window.echo = e.data; s.close() }</script>`
    ),
  "/cached.js": (_request, response) => {
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=3600" })
    response.end(`window.cachedLoaded = (window.cachedLoaded ?? 0) + 1`)
  },
  "/cache": (_request, response) => html(response, `<title>cache</title><script src="/cached.js"></script>`),
  "/sw.js": (_request, response) => {
    response.writeHead(200, { "content-type": "text/javascript" })
    response.end(
      `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === "/from-sw") event.respondWith(new Response("made by the worker"))
})`
    )
  },
  "/sw": (_request, response) =>
    html(
      response,
      `<title>sw</title><script>window.controlled = navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then(() => navigator.serviceWorker.controller ? true : new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true))))</script>`
    ),
  "/beforeunload": (_request, response) =>
    html(
      response,
      `<title>beforeunload</title><script>window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "" })</script>`
    )
}

// A WebSocket that echoes text frames, enough for one test.
const upgrade = (request: http.IncomingMessage, socket: net.Socket) => {
  const key = request.headers["sec-websocket-key"]
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  socket.on("data", (data: Buffer) => {
    const opcode = data[0]! & 0x0f
    if (opcode === 8) return socket.end()
    const length = data[1]! & 0x7f
    const mask = data.subarray(2, 6)
    const payload = Buffer.from(data.subarray(6, 6 + length).map((byte, i) => byte ^ mask[i % 4]!))
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
  })
}

/** Serves the site for the scope. */
export const site: Effect.Effect<Site, never, Scope.Scope> = Effect.acquireRelease(
  Effect.callback<{ server: http.Server; site: Site }>((resume) => {
    const served: Array<Served> = []
    let siteRef: Site
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://site")
      served.push({ method: request.method ?? "GET", path: url.pathname + url.search, headers: request.headers })
      const route = routes[url.pathname]
      if (route !== undefined) return route(request, response, siteRef)
      html(response, `<title>${url.pathname}</title><p>${url.pathname}</p>`)
    })
    server.on("upgrade", upgrade)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo
      siteRef = { origin: `http://127.0.0.1:${port}`, crossSite: `http://localhost:${port}`, served }
      resume(Effect.succeed({ server, site: siteRef }))
    })
  }),
  ({ server }) =>
    Effect.callback<void>((resume) => {
      server.closeAllConnections()
      server.close(() => resume(Effect.void))
    })
).pipe(Effect.map(({ site }) => site))

// ── Facts ──

export interface Recorder {
  readonly sink: Adapter.Sink
  readonly facts: ReadonlyArray<Adapter.Fact>
  /** Waits for a fact that matches, from the first fact recorded on. */
  readonly next: <F extends Adapter.Fact>(
    predicate: (fact: Adapter.Fact) => fact is F,
    timeout?: number
  ) => Effect.Effect<F>
  /** Waits for a fact of a tag, matching `where`. */
  readonly when: <T extends Adapter.Fact["_tag"]>(
    tag: T,
    where?: (fact: Extract<Adapter.Fact, { _tag: T }>) => boolean
  ) => Effect.Effect<Extract<Adapter.Fact, { _tag: T }>>
  /** Every fact of a tag so far. */
  readonly all: <T extends Adapter.Fact["_tag"]>(tag: T) => ReadonlyArray<Extract<Adapter.Fact, { _tag: T }>>
}

export const makeRecorder = (): Recorder => {
  const facts: Array<Adapter.Fact> = []
  const waiters = new Set<() => void>()
  const next = <F extends Adapter.Fact>(predicate: (fact: Adapter.Fact) => fact is F, timeout = 10_000) =>
    Effect.callback<F>((resume) => {
      const check = () => {
        const found = facts.find(predicate)
        if (found === undefined) return false
        waiters.delete(waiter)
        resume(Effect.succeed(found))
        return true
      }
      const waiter = () => void check()
      if (check()) return
      waiters.add(waiter)
      return Effect.sync(() => waiters.delete(waiter))
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.die(
            new Error(`No matching fact within ${timeout} ms. Facts: ${facts.map((fact) => fact._tag).join(", ")}`)
          )
      })
    )
  return {
    facts,
    sink: (fact) =>
      Effect.sync(() => {
        facts.push(fact)
        for (const waiter of Array.from(waiters)) waiter()
      }),
    next,
    when: (tag, where) => next((fact): fact is any => fact._tag === tag && (where === undefined || where(fact as any))),
    all: (tag) => facts.filter((fact) => fact._tag === tag) as any
  }
}

// ── Backends ──

export interface Backend {
  readonly name: string
  /** Launches the browser and connects the adapter, for the scope; `kill` kills the browser outright. */
  readonly connect: (
    sink: Adapter.Sink
  ) => Effect.Effect<
    { readonly adapter: Adapter.AdapterConnection; readonly kill: Effect.Effect<void> },
    Browser.BrowserError,
    Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Socket.WebSocketConstructor
  >
}

export const json = (value: Adapter.RemoteValue): unknown => {
  switch (value.type) {
    case "undefined":
      return undefined
    case "null":
      return null
    case "string":
    case "boolean":
    case "bigint":
    case "date":
      return value.value
    case "number":
      return typeof value.value === "number" ? value.value : Number(value.value)
    case "array":
    case "set":
      return (value.value ?? []).map(json)
    case "object":
    case "map":
      return Object.fromEntries(
        (value.value ?? []).map(([key, item]) => [typeof key === "string" ? key : String(json(key)), json(item)])
      )
    default:
      return value.type
  }
}
