// Opt-in in-memory transforms: no browser source or installed Playwright files are changed on disk.
import { registerHooks } from "node:module"
const hooks = new URL("./query-hooks.ts", import.meta.url).href
const patches = [
  ["/protocol/Transport.ts", [
    ["return decoder.decode(bytes)", "return queryProfile.sync(\"utf8.decode\", () => decoder.decode(bytes))"],
    ["try: () => frame(chunk)", "try: () => { queryProfile.chunk(chunk.length); return frame(chunk) }"]
  ]],
  ["/internal/protocolClient.ts", [
    ["envelope = JSON.parse(message)", "envelope = queryProfile.sync(\"JSON.parse\", () => JSON.parse(message))"],
    [
      "return (input) => Effect.succeed(input as A)",
      "return (input) => queryProfile.effect(`validationSkipped:${method}`, Effect.succeed(input as A))"
    ],
    [
      "decode(input).pipe(Effect.mapError",
      "queryProfile.effect(`validation:${method}`, decode(input)).pipe(Effect.mapError"
    ]
  ]],
  ["/internal/cdpAdapter/evaluation.ts", [
    [
      "return toRemoteValue(serialized, documentOf)",
      "return queryProfile.sync(\"toRemoteValue\", () => toRemoteValue(serialized, documentOf))"
    ]
  ]],
  ["/internal/evaluation.ts", [
    ["Serialization.fromRemote(value)", "queryProfile.sync(\"fromRemote\", () => Serialization.fromRemote(value))"]
  ]]
]
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    const patch = patches.find(([suffix]) => url.endsWith(suffix))
    if (patch) {
      let source = result.source.toString()
      for (const [before, after] of patch[1]) {
        if (source.split(before).length !== 2) throw new Error(`Expected one instrumentation anchor: ${before}`)
        source = source.replace(before, after)
      }
      return {
        ...result,
        source: `import * as queryProfile from ${JSON.stringify(hooks)};\n${source}\n${
          url.endsWith("/internal/cdpAdapter/evaluation.ts")
            ? "export { toRemoteValue as queryProfileToRemoteValue };"
            : ""
        }`
      }
    }
    if (url.endsWith("/playwright-core/lib/coreBundle.js")) {
      let source = result.source.toString()
      const key = "globalThis[Symbol.for(\"strider.queryProfile\")]"
      const serialize = "return serializeAsCallArgument(value, (value2) => ({ fallThrough: value2 }));"
      if (source.split(serialize).length !== 3) throw new Error("Pinned Playwright utility serializer anchor changed")
      source = source.replaceAll(
        serialize,
        `const started = performance.now(); try { ${serialize} } finally { globalThis.__pwSerializeMs = performance.now() - started; }`
      )
      const before =
        "return returnByValue ? parseEvaluationResultValue(remoteObject.value) : createHandle(utilityScript._context, remoteObject);"
      if (source.split(before).length !== 2) throw new Error("Pinned Playwright result anchor changed")
      source = source.replace(
        before,
        `return returnByValue ? ${key}.sync("pw.fromRemote", () => parseEvaluationResultValue(remoteObject.value)) : createHandle(utilityScript._context, remoteObject);`
      )
      // Limit transport instrumentation to the server's browser pipe transport, not the in-process API channel.
      const start = source.indexOf("// packages/playwright-core/src/server/pipeTransport.ts")
      const end = source.indexOf("// packages/playwright-core/src/server/transport.ts", start)
      if (start < 0 || end < 0) throw new Error("Pinned Playwright pipe anchors changed")
      const section = source.slice(start, end)
        .replace(
          "this._pipeWrite.write(JSON.stringify(message));",
          `${key}.out(message); this._pipeWrite.write(JSON.stringify(message));`
        )
        .replaceAll("JSON.parse(message)", `${key}.parse(message)`)
        .replaceAll("JSON.parse(message2)", `${key}.parse(message2)`)
      return { ...result, source: source.slice(0, start) + section + source.slice(end) }
    }
    return result
  }
})
