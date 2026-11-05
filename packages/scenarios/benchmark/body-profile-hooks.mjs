// Opt-in attribution only. Exact-site transforms preserve protocol arguments and ordering.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { registerHooks } from "node:module"

const events = []
const sources = {}
globalThis.__bodyTrace = (name, data = {}) => events.push({ name, at: performance.now(), ...data })
const mark = (name) => `globalThis.__bodyTrace(${JSON.stringify(name)});`
const rules = [
  ["/src/benchmarks/bin.ts", [
    [
      "const started = yield* Effect.sync(() => performance.now())",
      `const started = yield* Effect.sync(() => { ${mark("strider.start")} return performance.now() })`
    ],
    ["entry.verify(value)", `${mark("strider.end")} entry.verify(value)`],
    [
      "const sample = await elapsed(() => entry.playwright(page, site.origin))",
      `${mark("playwright.start")} const sample = await elapsed(() => entry.playwright(page, site.origin)); ${
        mark("playwright.end")
      }`
    ]
  ]],
  ["/internal/networkResponse.ts", [
    [
      "yield* collect(found, \"NetworkResponse.next\", limit)",
      `${mark("collection.start")} yield* collect(found, "NetworkResponse.next", limit); ${mark("collection.ready")}`
    ],
    [
      "const bytes = yield* runtime.model.adapter.responseBody(response.hop).pipe(",
      `${mark("body.adapter.start")} const bytes = yield* runtime.model.adapter.responseBody(response.hop).pipe(`
    ],
    [
      "const message = new Captured(response, bytes, undefined)",
      `${mark("body.adapter.end")} const message = new Captured(response, bytes, undefined)`
    ],
    [
      "const body = yield* Effect.provideContext(decoder(message), context)",
      `${mark("decoder.start")} const body = yield* Effect.provideContext(decoder(message), context); ${
        mark("decoder.end")
      }`
    ]
  ]],
  ["/internal/cdpAdapter/network.ts", [
    [
      "const { body, base64Encoded } = yield* Kit.protocol(",
      `${mark("body.protocol.start")} const { body, base64Encoded } = yield* Kit.protocol(`
    ],
    [
      "return yield* Kit.bodyBytes(body, base64Encoded, \"Network.getResponseBody\")",
      `globalThis.__bodyTrace("body.protocol.end", { characters: body.length, base64Encoded }); const decoded = yield* Kit.bodyBytes(body, base64Encoded, "Network.getResponseBody"); ${
        mark("body.decode.end")
      } return decoded`
    ]
  ]],
  ["/playwright-core/lib/coreBundle.js", [
    [
      "const response2 = await session.send(\"Network.getResponseBody\", { requestId: interceptable._requestId });",
      `${
        mark("pw.body.protocol.start")
      } const response2 = await session.send("Network.getResponseBody", { requestId: interceptable._requestId }); globalThis.__bodyTrace("pw.body.protocol.end", { characters: response2.body.length, base64Encoded: response2.base64Encoded });`
    ]
  ]]
]
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    const rule = rules.find(([suffix]) => url.endsWith(suffix))
    if (!rule) return result
    let source = String(result.source)
    sources[url] = createHash("sha256").update(source).digest("hex")
    for (const [before, after] of rule[1]) {
      if (source.split(before).length !== 2) {
        throw new Error(`Body profiler needs exactly one site in ${url}: ${before}`)
      }
      source = source.replace(before, after)
    }
    return { ...result, source }
  }
})
process.on("exit", () => {
  const output = process.argv[process.argv.indexOf("--output") + 1]
  if (!output?.endsWith(".json")) throw new Error("Body profiler requires an explicit --output JSON path")
  const missingSources = rules.map(([suffix]) => suffix).filter((suffix) =>
    !Object.keys(sources).some((url) => url.endsWith(suffix))
  )
  if (missingSources.length > 0) {
    process.stderr.write(`Missing body profiler sources: ${missingSources.join(", ")}\n`)
    process.exitCode = 1
  }
  fs.writeFileSync(
    output.replace(/\.json$/, ".phases.json"),
    JSON.stringify(
      {
        diagnosticOnly: true,
        missingSources,
        node: process.version,
        loaderHash: createHash("sha256").update(fs.readFileSync(import.meta.filename)).digest("hex"),
        sources,
        events
      },
      null,
      2
    )
  )
})
