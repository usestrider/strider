/**
 * A launch's `defaultContext` options, through every backend's public API: one launch per backend, whose default
 * context is configured at launch. The rule: launch options reach the default context's startup page and the pages
 * opened in it later. Each option is sampled where the capability table says the backend has it; one it lacks is
 * left out of the launch, which would fail, and its absence checked against the table. A creation-only option the
 * backend can't set at launch is refused before the browser starts, so that case costs no launch.
 */
import { assert, describe, it, layer } from "@effect/vitest"
import { Browser, Download, type Page, UserContext } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { supports } from "./capabilities.ts"

const timeout = 60_000

/** The options a backend's launch samples, as its capability table names them. */
export type Sampled = "bypassCSP" | "interception.auth" | "downloads" | "acceptInsecureCerts"

const sampledOptions: ReadonlyArray<Sampled> = ["bypassCSP", "interception.auth", "downloads", "acceptInsecureCerts"]

class Site extends Context.Service<Site, {
  readonly origin: string
  readonly secure: string
  readonly downloads: string
  readonly sampled: ReadonlyArray<Sampled>
}>()("slice/launchedDefaultContext/Site") {}

const listen = <S extends net.Server>(server: S) =>
  Effect.acquireRelease(
    Effect.callback<S>((resume) => void server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))),
    (server) =>
      Effect.callback<void>((resume) => {
        ;(server as unknown as http.Server).closeAllConnections()
        server.close(() => resume(Effect.void))
      })
  ).pipe(Effect.map((server) => (server.address() as net.AddressInfo).port))

const page = (title: string) => `<title>${title}</title>`

/** A plain HTTP site: a page, one under a policy that forbids scripts, one behind Basic credentials, and a file. */
const plain = listen(http.createServer((request, response) => {
  if (request.url === "/csp") {
    response.writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'none'" })
    response.end(`${page("blocked")}<script>document.title = "ran"</script>`)
  } else if (request.url === "/secret") {
    if (request.headers.authorization === `Basic ${Buffer.from("strider:secret").toString("base64")}`) {
      response.writeHead(200, { "content-type": "text/html" })
      response.end(page("authorized"))
    } else {
      response.writeHead(401, { "content-type": "text/html", "www-authenticate": `Basic realm="strider"` })
      response.end(page("unauthorized"))
    }
  } else if (request.url === "/download") {
    response.writeHead(200, { "content-type": "text/plain", "content-disposition": "attachment; filename=hello.txt" })
    response.end("hello, download")
  } else {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(`${page("hello")}<p data-qa="greeting">hi</p><a href="/download" download>Export</a>`)
  }
}))

const certificate = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "../../fixtures/client-certificates", name))

/** An HTTPS site signed by a test CA no browser trusts. */
const secure = listen(https.createServer({ key: certificate("server-key.pem"), cert: certificate("server.pem") }, (
  _request,
  response
) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end(page("secure"))
}))

const title = (page: Page.Page) => page.evaluateInMainWorld(() => document.title)

/** The title of `url` in `page`, or undefined if it didn't load. */
const load = Effect.fnUntraced(function*(page: Page.Page, url: string) {
  const loaded = yield* page.goto(url).pipe(Effect.exit)
  return Exit.isFailure(loaded) ? undefined : yield* title(page)
})

/**
 * @param launch The backend's launch layer, with these options as its `defaultContext`.
 * @param sampled The options this backend's launch sets; the rest are checked as absent from its capability table.
 */
export const launchedDefaultContext = (
  name: string,
  launch: (defaultContext: UserContext.Options) => Layer.Layer<Browser.Browser, unknown>,
  sampled: ReadonlyArray<Sampled>
) =>
  describe(`${name} launched default context options`, () => {
    const options = (origin: string, downloads: string): UserContext.Options => ({
      // Every backend has this one, which Strider applies itself
      testIdAttribute: "data-qa",
      ...(sampled.includes("bypassCSP") ? { bypassCSP: true } : {}),
      ...(sampled.includes("interception.auth")
        ? { httpCredentials: { origin, username: "strider", password: Redacted.make("secret") } }
        : {}),
      ...(sampled.includes("downloads") ? { downloads: { directory: downloads } } : {}),
      ...(sampled.includes("acceptInsecureCerts") ? { acceptInsecureCerts: true } : {})
    })
    const backend = Layer.unwrap(Effect.gen(function*() {
      const origin = `http://127.0.0.1:${yield* plain}`
      const secureOrigin = `https://127.0.0.1:${yield* secure}`
      const downloads = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-launch-downloads-"))),
        (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
      )
      return Layer.merge(
        launch(options(origin, downloads)),
        Layer.succeed(Site)({ origin, secure: secureOrigin, downloads, sampled })
      )
    }))

    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("applies them to the startup page and to pages opened in the default context later", () =>
        Effect.gen(function*() {
          const site = yield* Site
          for (const option of sampledOptions) {
            // A backend that has the option samples it, and one that lacks it leaves it out
            assert.strictEqual(yield* supports(option), site.sampled.includes(option), option)
          }
          const context = yield* (yield* Browser.Browser).defaultContext.control
          const [startup] = yield* context.pages.waitFor((pages) => pages.length > 0)
          const opened = yield* context.newPage
          for (const each of [startup!, opened]) {
            assert.strictEqual(yield* load(each, `${site.origin}/`), "hello")
            assert.strictEqual(yield* each.getByTestId("greeting").readText, "hi")
            if (site.sampled.includes("bypassCSP")) {
              assert.strictEqual(yield* load(each, `${site.origin}/csp`), "ran")
            }
            if (site.sampled.includes("interception.auth")) {
              assert.strictEqual(yield* load(each, `${site.origin}/secret`), "authorized")
            }
            if (site.sampled.includes("acceptInsecureCerts")) {
              assert.strictEqual(yield* load(each, `${site.secure}/`), "secure")
            }
          }
          // A context of its own keeps the browser's defaults
          const other = yield* Browser.newPage()
          if (site.sampled.includes("bypassCSP")) assert.strictEqual(yield* load(other, `${site.origin}/csp`), "blocked")
          if (site.sampled.includes("acceptInsecureCerts")) assert.isUndefined(yield* load(other, `${site.secure}/`))
        }).pipe(Effect.scoped), timeout)

      it.effect("writes the default context's downloads to the directory it names", () =>
        Effect.gen(function*() {
          const site = yield* Site
          if (!site.sampled.includes("downloads")) return
          const context = yield* (yield* Browser.Browser).defaultContext.control
          const page = yield* context.newPage
          yield* page.goto(`${site.origin}/`)
          const download = yield* Download.next(page)
          yield* page.getByText("Export").click()
          const file = yield* download
          yield* file.finished
          const written = fs.readdirSync(site.downloads)
          assert.isAbove(written.length, 0)
          assert.include(written.map((each) => fs.readFileSync(path.join(site.downloads, each), "utf8")), "hello, download")
        }).pipe(Effect.scoped), timeout)
    })

    it.effect("refuses a creation-only option the backend can't set at launch", () =>
      Effect.gen(function*() {
        const error = yield* Layer.build(launch({ proxy: { server: "http://127.0.0.1:9" } })).pipe(Effect.flip)
        assert(UserContext.isUserContextError(error), String(error))
        assert.strictEqual(error.reason._tag, "Unsupported")
        assert.deepInclude(error.reason, { capability: "userContexts.proxy" })
      }).pipe(Effect.scoped), timeout)
  })
