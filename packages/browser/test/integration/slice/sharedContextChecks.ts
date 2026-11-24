/** The shared context's own check: what a case leaves on an origin its page held earlier, or in a frame, is found. */
import { assert, describe, layer } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { createServer } from "node:http"
import { site } from "../adapter/harness.ts"
import * as SharedContext from "./sharedContext.ts"

const timeout = 60_000
const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

export const sharedContextChecks = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} shared context`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((it) => {
      it.effect(
        "replaces the shared context when revisiting an origin redirects elsewhere",
        () =>
          Effect.gen(function*() {
            const { crossSite } = yield* site
            const server = yield* Effect.acquireRelease(
              Effect.callback<ReturnType<typeof createServer>>((resume) => {
                const server = createServer((request, response) => {
                  if (request.url === "/") {
                    response.writeHead(302, { location: `${crossSite}/fixture` })
                    response.end()
                  } else {
                    response.writeHead(200, { "content-type": "text/html" })
                    response.end("<p>storage origin</p>")
                  }
                })
                server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
              }),
              (server) =>
                Effect.callback<void>((resume) => {
                  server.closeAllConnections()
                  server.close(() => resume(Effect.void))
                })
            )
            const address = server.address()
            assert(address !== null && typeof address !== "string")
            const origin = `http://127.0.0.1:${address.port}`
            const shared = yield* SharedContext.Shared
            const before = yield* shared.current
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* SharedContext.newPage
              yield* page.goto(`${origin}/write`, { waitUntil: "load" })
              yield* page.evaluateInMainWorld(() => localStorage.setItem("redirected-origin", "left"))
              yield* page.goto(`${crossSite}/fixture`)
            }))
            const left = yield* shared.settle
            const after = yield* shared.current
            const read = yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* SharedContext.newPage
              yield* page.goto(`${origin}/read`, { waitUntil: "load" })
              return yield* page.evaluateInMainWorld(() => {
                const value = localStorage.getItem("redirected-origin")
                localStorage.clear()
                return value
              })
            }))
            yield* shared.settle
            assert.notStrictEqual(
              after,
              before,
              `redirect was accepted as a storage read; next case read ${JSON.stringify(read)}; leftovers: ${
                left.join("; ")
              }`
            )
            assert.isNull(read)
          }),
        timeout
      )

      const leaves = Effect.fnUntraced(
        function*(source: "previous document" | "cross-origin frame" | "service worker") {
          const { origin, crossSite } = yield* site
          const shared = yield* SharedContext.Shared
          // Where the case leaves it, and the page that reads it back from the same partition
          const at = source === "cross-origin frame" ? crossSite : origin
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            if (source === "cross-origin frame") {
              const child = fixtureUrl(crossSite, `<script>localStorage.setItem("left", "1")</script>`)
              yield* page.goto(fixtureUrl(origin, `<iframe src="${child}"></iframe>`), { waitUntil: "load" })
            } else if (source === "previous document") {
              yield* page.goto(fixtureUrl(origin, `<script>localStorage.setItem("left", "1")</script>`), {
                waitUntil: "load"
              })
              yield* page.goto(fixtureUrl(crossSite, "<p>second</p>"))
            } else {
              yield* page.goto(fixtureUrl(origin, "<p>register</p>"), { waitUntil: "load" })
              yield* page.evaluateInMainWorld(async () => {
                await navigator.serviceWorker.register("/sw.js")
                await navigator.serviceWorker.ready
              })
              yield* page.goto(fixtureUrl(crossSite, "<p>second</p>"))
            }
          }))
          const left = yield* shared.settle
          // Read back, and clear, from a page of the same partition in whichever context the next case gets
          const read = yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const reader = source === "service worker"
              ? `<script>navigator.serviceWorker.getRegistrations().then(async (all) => { window.found = all.length; await Promise.all(all.map((each) => each.unregister())) })</script>`
              : `<script>window.found = localStorage.getItem("left"); localStorage.clear()</script>`
            if (source === "cross-origin frame") {
              yield* page.goto(
                fixtureUrl(
                  origin,
                  `<script>addEventListener("message", (event) => { window.found = event.data })</script><iframe src="${
                    fixtureUrl(
                      at,
                      `<script>parent.postMessage(localStorage.getItem("left"), "*"); localStorage.clear()</script>`
                    )
                  }"></iframe>`
                ),
                { waitUntil: "load" }
              )
            } else yield* page.goto(fixtureUrl(at, reader), { waitUntil: "load" })
            yield* Effect.sleep("200 millis")
            return yield* page.evaluateInMainWorld(() => Reflect.get(window, "found") ?? null)
          }))
          yield* shared.settle
          assert.isNotEmpty(
            left,
            `the shared context accepted ${source} state; the next case read ${JSON.stringify(read)}`
          )
          assert.match(left.join("; "), source === "service worker" ? /worker/ : /localStorage/)
          assert.include([null, 0], read as never, `the next case read ${JSON.stringify(read)}`)
        }
      )

      for (const source of ["previous document", "cross-origin frame", "service worker"] as const) {
        it.effect(`rejects ${source} state left in the shared context, and replaces it`, () => leaves(source), timeout)
      }
    })
  })
