import { transformScenarios } from "./session-profile-config.ts"
// Run canonical scenarios with opt-in in-memory attribution. Keep baseline runs loader-free.
import { registerHooks } from "node:module"
const hooks = new URL("./session-profile-hooks.ts", import.meta.url).href
const installed = new Set()
const replace = (source, before, after, count = 1) => {
  if (source.split(before).length !== count + 1) throw new Error(`Instrumentation anchor changed: ${before}`)
  return source.replaceAll(before, after)
}
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    let source = result.source?.toString()
    if (url.endsWith("/scenarios/src/runner.ts")) {
      source = replace(source, "normalize(await run())", "normalize(await sessionProfile.scenario(run, expected))")
    } else if (url.endsWith("/scenarios/src/scenarios.ts")) {
      source = transformScenarios(source)
    } else if (url.endsWith("/internal/protocolClient.ts")) {
      source = replace(
        source,
        "envelope = JSON.parse(message)",
        "envelope = JSON.parse(sessionProfile.incoming(message))"
      )
      for (const parameter of ["params", "encoded"]) {
        const anchor = `transport.send(wire.encode(entry.id, method, ${parameter}, state.key))`
        source = replace(
          source,
          anchor,
          `Effect.suspend(() => transport.send(sessionProfile.outgoing(wire.encode(entry.id, method, ${parameter}, state.key))))`
        )
      }
    } else if (url.endsWith("/playwright-core/lib/coreBundle.js")) {
      const start = source.indexOf("// packages/playwright-core/src/server/pipeTransport.ts")
      const end = source.indexOf("// packages/playwright-core/src/server/transport.ts", start)
      if (start < 0 || end < 0) throw new Error("Playwright pipe anchors changed")
      const key = "globalThis[Symbol.for(\"strider.sessionProfile\")]"
      let section = source.slice(start, end)
      section = replace(
        section,
        "this._pipeWrite.write(JSON.stringify(message));",
        `${key}.out(message); this._pipeWrite.write(JSON.stringify(message));`
      )
      for (const name of ["message", "message2"]) {
        section = replace(section, `JSON.parse(${name})`, `${key}.parse(${name})`)
      }
      source = source.slice(0, start) + section + source.slice(end)
      installed.add("playwright")
      return { ...result, source }
    } else return result
    installed.add(url)
    return { ...result, source: `import * as sessionProfile from ${JSON.stringify(hooks)};\n${source}` }
  }
})
process.on("exit", () => process.stderr.write(`Session profile modules: ${JSON.stringify([...installed])}\n`))
